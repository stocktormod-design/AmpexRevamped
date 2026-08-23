// GENERERT AV tools/bygg-regnskap-funksjon.ts — IKKE REDIGER.
// Kilden er lib/accounting/fiken.ts. Endrer du den, kjør `npm run bygg:regnskap` på nytt,
// ellers deployer vi et annet regnestykke enn det appen viser.

import type {
  AdapterResultat, FakturautkastUt, Fakturastatus, KundeUt, Regnskapsadapter,
} from './adapter.ts'
import { MVA_FIKEN } from './adapter.ts'

/**
 * Fiken-adapter — adapter nummer én.
 *
 * ⚠ KJØRER IKKE I APPEN. Et personlig Fiken-token eller en OAuth-refresh er en
 * nøkkel til hele regnskapet; den skal aldri ligge på en montørtelefon. Denne
 * modulen er skrevet uten React Native-avhengigheter slik at den kan kjøre i en
 * Supabase Edge Function eller i Ampex Desktop. Appen skriver til lokal SQLite,
 * og synken plukker det opp.
 *
 * To ting fra spesifikasjonen som er lette å gjøre feil, og som koster penger:
 *
 * 1. **Alle beløp er øre som heltall.** `net: 25000` er 250,00 kr. Sendes kroner,
 *    blir fakturaen 100× for lav.
 * 2. **MVA-koden er engelsk.** HIGH/MEDIUM/LOW/EXEMPT — ikke våre norske navn.
 *
 * Fiken svarer på POST med `201` og en `Location`-header; ID-en er siste
 * segment. Det er ingen ID i responsbodyen.
 */

export type FikenKonfig = {
  /** Firmaslug fra Fiken, f.eks. `elektro-as1`. */
  companySlug: string
  /** Personlig API-token eller OAuth access token. */
  token: string
  /** Inntektskonto for salg. 3000 = avgiftspliktig salgsinntekt. */
  inntektskonto?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

const BASE = 'https://api.fiken.no/api/v2'

function sisteSegment(location: string | null): string | null {
  if (!location) return null
  const rene = location.split('?')[0].replace(/\/+$/, '')
  const del = rene.split('/').pop()
  return del || null
}

export class FikenAdapter implements Regnskapsadapter {
  readonly system = 'fiken' as const
  readonly navn = 'Fiken'

  private readonly slug: string
  private readonly token: string
  private readonly konto: string
  private readonly base: string
  private readonly hent: typeof fetch

  constructor(konfig: FikenKonfig) {
    this.slug = konfig.companySlug
    this.token = konfig.token
    this.konto = konfig.inntektskonto ?? '3000'
    this.base = konfig.baseUrl ?? BASE
    this.hent = konfig.fetchImpl ?? fetch
  }

  private async kall(sti: string, init?: RequestInit): Promise<Response> {
    return this.hent(`${this.base}/companies/${this.slug}${sti}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  }

  /**
   * Fiken tåler **én samtidig forespørsel**; brudd kan gi utestengelse. Derfor
   * serialiseres alt gjennom denne kjeden i stedet for å stole på at
   * kallstedene husker det.
   */
  private ko: Promise<unknown> = Promise.resolve()
  private serielt<T>(jobb: () => Promise<T>): Promise<T> {
    const neste = this.ko.then(jobb, jobb)
    this.ko = neste.catch(() => undefined)
    return neste
  }

  private async feilTekst(res: Response): Promise<string> {
    const tekst = await res.text().catch(() => '')
    return `Fiken ${res.status}: ${tekst.slice(0, 400) || res.statusText}`
  }

  /** 429 og 5xx er forbigående; 4xx ellers er vår feil og blir ikke bedre av å prøves igjen. */
  private kanProves(status: number): boolean {
    return status === 429 || status >= 500
  }

  async synkKunde(kunde: KundeUt): Promise<AdapterResultat<string>> {
    return this.serielt(async () => {
      try {
        // Finn først. Uten dette lages en ny kontakt for hver faktura, og
        // kunderegisteret i Fiken fylles med duplikater av samme person.
        const sok = await this.kall(`/contacts?name=${encodeURIComponent(kunde.navn)}&pageSize=25`)
        if (sok.ok) {
          const treff = (await sok.json()) as { contactId: number; name: string; organizationNumber?: string }[]
          const eksakt = treff.find(k =>
            (kunde.orgNr && k.organizationNumber === kunde.orgNr)
            || k.name.trim().toLowerCase() === kunde.navn.trim().toLowerCase(),
          )
          if (eksakt) return { ok: true as const, verdi: String(eksakt.contactId) }
        }

        const body: Record<string, unknown> = {
          name: kunde.navn,
          customer: true,
          email: kunde.epost ?? undefined,
          phoneNumber: kunde.telefon ?? undefined,
          organizationNumber: kunde.erBedrift ? kunde.orgNr ?? undefined : undefined,
        }
        if (kunde.adresse || kunde.postnummer || kunde.poststed) {
          body.address = {
            streetAddress: kunde.adresse ?? undefined,
            postalCode: kunde.postnummer ?? undefined,
            city: kunde.poststed ?? undefined,
            country: 'Norge',
          }
        }
        const res = await this.kall('/contacts', { method: 'POST', body: JSON.stringify(body) })
        if (!res.ok) {
          return { ok: false as const, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
        }
        const id = sisteSegment(res.headers.get('Location'))
        if (!id) return { ok: false as const, feil: 'Fiken svarte uten Location-header', kanProvesIgjen: true }
        return { ok: true as const, verdi: id }
      } catch (e) {
        return { ok: false as const, feil: `Nettverksfeil mot Fiken: ${String(e)}`, kanProvesIgjen: true }
      }
    })
  }

  async opprettFakturautkast(utkast: FakturautkastUt): Promise<AdapterResultat<string>> {
    return this.serielt(async () => {
      if (utkast.grunnlag.linjer.length === 0) {
        return { ok: false as const, feil: 'Ingen fakturerbare linjer på ordren', kanProvesIgjen: false }
      }
      try {
        const body = {
          type: 'invoice',
          issueDate: utkast.dato.toISOString().slice(0, 10),
          daysUntilDueDate: utkast.forfallsdager,
          customerId: Number(utkast.kundeEksternId),
          invoiceText: utkast.ordreTekst ?? undefined,
          ourReference: utkast.ordrenummer ? `Ordre ${utkast.ordrenummer}` : undefined,
          lines: utkast.grunnlag.linjer.map(l => ({
            // Fiken kutter på 200 tegn og avviser lengre tekst.
            text: l.beskrivelse.slice(0, 200),
            vatType: MVA_FIKEN[l.mva],
            incomeAccount: this.konto,
            net: l.nettoOre,
            gross: l.bruttoOre,
          })),
        }
        const res = await this.kall('/invoices/drafts', { method: 'POST', body: JSON.stringify(body) })
        if (!res.ok) {
          return { ok: false as const, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
        }
        const id = sisteSegment(res.headers.get('Location'))
        if (!id) return { ok: false as const, feil: 'Fiken svarte uten Location-header', kanProvesIgjen: true }
        return { ok: true as const, verdi: id }
      } catch (e) {
        return { ok: false as const, feil: `Nettverksfeil mot Fiken: ${String(e)}`, kanProvesIgjen: true }
      }
    })
  }

  async hentFakturastatus(eksternId: string): Promise<AdapterResultat<Fakturastatus>> {
    return this.serielt(async () => {
      try {
        const res = await this.kall(`/invoices/${encodeURIComponent(eksternId)}`)
        if (res.status === 404) return { ok: true as const, verdi: 'utkast' as Fakturastatus }
        if (!res.ok) {
          return { ok: false as const, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
        }
        const f = (await res.json()) as { sent?: boolean; settled?: boolean; dueDate?: string; creditNote?: boolean }
        if (f.creditNote) return { ok: true as const, verdi: 'kreditert' as Fakturastatus }
        if (f.settled) return { ok: true as const, verdi: 'betalt' as Fakturastatus }
        if (f.dueDate && new Date(f.dueDate) < new Date()) return { ok: true as const, verdi: 'forfalt' as Fakturastatus }
        if (f.sent) return { ok: true as const, verdi: 'sendt' as Fakturastatus }
        return { ok: true as const, verdi: 'utkast' as Fakturastatus }
      } catch (e) {
        return { ok: false as const, feil: `Nettverksfeil mot Fiken: ${String(e)}`, kanProvesIgjen: true }
      }
    })
  }
}
