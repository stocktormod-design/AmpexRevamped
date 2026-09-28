// GENERERT AV tools/bygg-regnskap-funksjon.ts — IKKE REDIGER.
// Kilden er lib/accounting/fiken.ts. Endrer du den, kjør `npm run bygg:regnskap` på nytt,
// ellers deployer vi et annet regnestykke enn det appen viser.

import type {
  AdapterResultat, FakturautkastUt, Fakturastatus, KundeUt, Regnskapsadapter,
} from './adapter.ts'
import { MVA_FIKEN } from './adapter.ts'
import type { ProsjektUt, TimeUt, VareUt } from './tripletex.ts'

/**
 * Fiken-adapter — skrevet mot spesifikasjonen `api.fiken.no/api/v2/docs/swagger.yaml`
 * (lastet ned 2026-09-14), etter at første utgave viste seg å sende felt som
 * ikke finnes: utkastlinjer heter `description`, `unitPrice` (øre per enhet) og
 * `quantity`, ikke `text`/`net`/`gross`. Verifiseres ende til ende med
 * `npm run verify:fiken` mot et Fiken-testforetak.
 *
 * ⚠ KJØRER IKKE I APPEN. Et personlig Fiken-token eller en OAuth-refresh er en
 * nøkkel til hele regnskapet; den skal aldri ligge på en montørtelefon. Modulen
 * er uten React Native-avhengigheter og kjører i en Supabase Edge Function
 * eller i Ampex Kontor.
 *
 * ── Det som koster penger å gjøre feil ─────────────────────────────────────
 *
 * 1. **Alle beløp er øre som heltall.** `unitPrice: 2490` er 24,90 kr. Sendes
 *    kroner, blir fakturaen 100× for lav.
 * 2. **MVA-koden er engelsk.** HIGH/MEDIUM/LOW/EXEMPT — se `MVA_FIKEN`.
 * 3. **`unitPrice` er per enhet, netto.** Grunnlaget vårt har `enhetsprisOre`
 *    og `antall`; rabatt sendes som `discount` i prosent, aldri bakt inn.
 *
 * ── Fiken-egenheter ────────────────────────────────────────────────────────
 *
 * - POST svarer `201` med `Location`; ID-en er siste segment. Ingen body.
 * - Én samtidig forespørsel, og Fiken bremser over fire i sekundet. Alt går
 *   gjennom `serielt()`, og hver HTTP-forespørsel gjennom `pause()`.
 * - Ingen sandkasse: testes mot et foretak «som ikke er i
 *   Brønnøysundregistrene», der `company.testCompany === true`.
 * - Personer under Timeføring kan ikke opprettes over API-et — se
 *   `synkTimebruker`.
 * - Tredjeparter MÅ bruke OAuth2 mot kundens konto. Fikens vilkår sier rett ut
 *   at personlig token i en tredjepartsapp kan gi øyeblikkelig stengt API — så
 *   personlig token er for utvikling og for kunder som kobler seg til sin egen
 *   konto selv. Adapteren bryr seg ikke om hvilken av delene tokenet kom fra.
 */

export type FikenKonfig = {
  /** Firmaslug fra Fiken, f.eks. `ampex-test`. Står i adresselinja: fiken.no/foretak/<slug>/… */
  companySlug: string
  /** Personlig API-token eller OAuth access token. */
  token: string
  /** Inntektskonto for salg. 3000 = avgiftspliktig salgsinntekt. */
  inntektskonto?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export const FIKEN_BASE = 'https://api.fiken.no/api/v2'

/** Fiken bremser over fire forespørsler i sekundet. 250 ms mellom hver start holder oss under. */
const MIN_MS_MELLOM_KALL = 250

/** Utkastene har egen ID-serie; prefikset skiller dem fra faktura-ID-er i `hentFakturastatus`. */
const UTKAST = 'utkast:'

function sisteSegment(location: string | null): string | null {
  if (!location) return null
  const rene = location.split('?')[0].replace(/\/+$/, '')
  const del = rene.split('/').pop()
  return del || null
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

type Kontakt = { contactId: number; name: string; organizationNumber?: string; memberNumberString?: string; customer?: boolean }
type Produkt = { productId: number; name: string; productNumber?: string; active: boolean }
type Prosjekt = { projectId: number; number: string; name: string }
type Aktivitet = { activityId: number; name: string; hourlyRate?: number; archived?: boolean }
type Timebruker = { timeUserId: number; name: string; email?: string }
type Utkast = { draftId: number; net?: number; gross?: number; issueDate?: string; lines?: unknown[] }
type Faktura = {
  invoiceId: number; invoiceNumber?: number; dueDate?: string
  sale?: { settled?: boolean; outstandingBalance?: number; writeOff?: boolean }
  dispatches?: unknown[]; associatedCreditNotes?: number[]
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
    this.base = konfig.baseUrl ?? FIKEN_BASE
    this.hent = konfig.fetchImpl ?? fetch
  }

  // ── Rør ────────────────────────────────────────────────────────────────

  private sistKall = 0

  /** Venter til det er gått `MIN_MS_MELLOM_KALL` siden forrige forespørsel startet. */
  private async pause(): Promise<void> {
    const igjen = MIN_MS_MELLOM_KALL - (Date.now() - this.sistKall)
    if (igjen > 0) await new Promise(r => setTimeout(r, igjen))
    this.sistKall = Date.now()
  }

  private async kall(sti: string, init?: RequestInit): Promise<Response> {
    await this.pause()
    const url = sti.startsWith('/companies') || sti === '/user' ? `${this.base}${sti}` : `${this.base}/companies/${this.slug}${sti}`
    return this.hent(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
  }

  /** Fiken tåler én samtidig forespørsel; brudd kan gi utestengelse. */
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

  private kanProves(status: number): boolean {
    return status === 429 || status >= 500
  }

  private feil<T>(melding: string, kanProvesIgjen: boolean): AdapterResultat<T> {
    return { ok: false, feil: melding, kanProvesIgjen }
  }

  private async avvis<T>(res: Response): Promise<AdapterResultat<T>> {
    return this.feil(await this.feilTekst(res), this.kanProves(res.status))
  }

  /** GET som liste. Fiken paginerer med `page`/`pageSize`; vi ber om 100 og leser første side. */
  private async liste<T>(sti: string): Promise<AdapterResultat<T[]>> {
    const skille = sti.includes('?') ? '&' : '?'
    const res = await this.kall(`${sti}${skille}pageSize=100`)
    if (!res.ok) return this.avvis(res)
    return { ok: true, verdi: (await res.json()) as T[] }
  }

  /** POST som lager en rad og gir ID-en fra `Location`. */
  private async opprett(sti: string, body: unknown): Promise<AdapterResultat<string>> {
    const res = await this.kall(sti, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) return this.avvis(res)
    const id = sisteSegment(res.headers.get('Location'))
    if (!id) return this.feil('Fiken svarte uten Location-header', true)
    return { ok: true, verdi: id }
  }

  private trygt<T>(jobb: () => Promise<AdapterResultat<T>>): Promise<AdapterResultat<T>> {
    return this.serielt(async () => {
      try { return await jobb() } catch (e) { return this.feil<T>(`Nettverksfeil mot Fiken: ${String(e)}`, true) }
    })
  }

  // ── Hvem og hvor ───────────────────────────────────────────────────────

  async hvemErJeg(): Promise<AdapterResultat<{ navn: string; epost: string }>> {
    return this.trygt(async () => {
      const res = await this.kall('/user')
      if (!res.ok) return this.avvis(res)
      const u = (await res.json()) as { name?: string; email?: string }
      return { ok: true, verdi: { navn: u.name ?? '', epost: u.email ?? '' } }
    })
  }

  /** Foretaket tokenet peker på. `testForetak` er sperren i verify:fiken. */
  async hentForetak(): Promise<AdapterResultat<{ navn: string; slug: string; orgNr: string | null; testForetak: boolean; harApiTilgang: boolean }>> {
    return this.trygt(async () => {
      const res = await this.kall(`/companies/${this.slug}`)
      if (!res.ok) return this.avvis(res)
      const c = (await res.json()) as { name: string; slug: string; organizationNumber?: string; testCompany?: boolean; hasApiAccess?: boolean }
      return { ok: true, verdi: { navn: c.name, slug: c.slug, orgNr: c.organizationNumber ?? null, testForetak: !!c.testCompany, harApiTilgang: !!c.hasApiAccess } }
    })
  }

  // ── Kunde ──────────────────────────────────────────────────────────────

  /**
   * Idempotent i tre lag: vår lokale ID (`memberNumberString`), org.nr, og til
   * slutt eksakt navn. Uten dette lages en ny kontakt per faktura, og Fikens
   * kunderegister fylles med kopier av samme person.
   */
  async synkKunde(kunde: KundeUt): Promise<AdapterResultat<string>> {
    return this.trygt(async () => {
      const paaLokal = await this.liste<Kontakt>(`/contacts?memberNumberString=${encodeURIComponent(kunde.lokalId)}`)
      if (paaLokal.ok && paaLokal.verdi[0]) return { ok: true, verdi: String(paaLokal.verdi[0].contactId) }

      if (kunde.orgNr) {
        const paaOrg = await this.liste<Kontakt>(`/contacts?organizationNumber=${encodeURIComponent(kunde.orgNr)}`)
        if (paaOrg.ok && paaOrg.verdi[0]) return { ok: true, verdi: String(paaOrg.verdi[0].contactId) }
      }
      const paaNavn = await this.liste<Kontakt>(`/contacts?name=${encodeURIComponent(kunde.navn)}`)
      if (paaNavn.ok) {
        const eksakt = paaNavn.verdi.find(k => k.name.trim().toLowerCase() === kunde.navn.trim().toLowerCase())
        if (eksakt) return { ok: true, verdi: String(eksakt.contactId) }
      }

      const body: Record<string, unknown> = {
        name: kunde.navn,
        customer: true,
        memberNumberString: kunde.lokalId,
        email: kunde.epost ?? undefined,
        phoneNumber: kunde.telefon ?? undefined,
        organizationNumber: kunde.erBedrift ? kunde.orgNr ?? undefined : undefined,
      }
      if (kunde.adresse || kunde.postnummer || kunde.poststed) {
        // `country` er påkrevd i adressen, og feltet heter postCode, ikke postalCode.
        body.address = {
          streetAddress: kunde.adresse ?? undefined,
          postCode: kunde.postnummer ?? undefined,
          city: kunde.poststed ?? undefined,
          country: 'Norge',
        }
      }
      return this.opprett('/contacts', body)
    })
  }

  // ── Vare ───────────────────────────────────────────────────────────────

  /** Idempotent på `productNumber` (el-nummeret). Fiken har varekartotek, men ingen beholdning å synke. */
  async synkVare(v: VareUt): Promise<AdapterResultat<string>> {
    return this.trygt(async () => {
      const fra = await this.liste<Produkt>(`/products?productNumber=${encodeURIComponent(v.nummer)}`)
      if (fra.ok) {
        const treff = fra.verdi.find(p => p.productNumber === v.nummer)
        if (treff) return { ok: true, verdi: String(treff.productId) }
      }
      return this.opprett('/products', {
        name: v.navn,
        productNumber: v.nummer,
        unitPrice: v.salgsprisOre,
        incomeAccount: this.konto,
        vatType: MVA_FIKEN[v.mva],
        active: true,
      })
    })
  }

  // ── Prosjekt ───────────────────────────────────────────────────────────

  /** Idempotent på `number` (vårt ordre-/prosjektnummer). */
  async synkProsjekt(p: ProsjektUt): Promise<AdapterResultat<string>> {
    return this.trygt(async () => {
      const fra = await this.liste<Prosjekt>(`/projects?number=${encodeURIComponent(p.nummer)}`)
      if (fra.ok) {
        const treff = fra.verdi.find(x => x.number === p.nummer)
        if (treff) return { ok: true, verdi: String(treff.projectId) }
      }
      return this.opprett('/projects', {
        number: p.nummer,
        name: p.navn,
        description: p.beskrivelse ?? undefined,
        startDate: iso(p.startDato),
        contactId: Number(p.kundeEksternId),
      })
    })
  }

  // ── Timer ──────────────────────────────────────────────────────────────

  /** Aktivitetsnavnet er unikt i foretaket hos Fiken, så navnet ER nøkkelen. */
  async synkAktivitet(navn: string, timeprisOre?: number | null): Promise<AdapterResultat<string>> {
    return this.trygt(async () => {
      const fra = await this.liste<Aktivitet>(`/activities?name=${encodeURIComponent(navn)}`)
      if (fra.ok) {
        const treff = fra.verdi.find(a => a.name.trim().toLowerCase() === navn.trim().toLowerCase())
        if (treff) return { ok: true, verdi: String(treff.activityId) }
      }
      return this.opprett('/activities', {
        name: navn,
        hourlyRate: timeprisOre ?? undefined,
        billable: true,
      })
    })
  }

  /**
   * Timebrukeren er Fikens person som har jobbet — ikke Fiken-brukeren som
   * logger inn. Idempotent på e-post, ellers eksakt navn.
   *
   * ⚠ Fiken dokumenterer BARE `GET` på `/timeUsers` (swagger.yaml 2026-09-14).
   * Skjemaet `timeUserRequest` ligger i spesifikasjonen, men ingen sti peker på
   * det — personer legges inn i Fiken under Timeføring. Vi prøver POST likevel,
   * i tilfelle den finnes udokumentert, men tolker 404/405/501 som «finnes
   * ikke» og sier hva kontoret må gjøre, med navnene Fiken faktisk har. Uten
   * det ville montør nummer to fått «Fiken 405:» og ingen vei videre.
   *
   * Dette var usynlig i `verify:fiken` fordi testen synker den innloggede
   * brukeren, som alltid ligger i lista fra før.
   */
  async synkTimebruker(navn: string, epost?: string | null): Promise<AdapterResultat<string>> {
    return this.trygt(async () => {
      const fra = await this.finnTimebruker(navn, epost)
      if (fra) return { ok: true, verdi: fra }

      const res = await this.kall('/timeUsers', {
        method: 'POST',
        body: JSON.stringify({ name: navn, email: epost ?? undefined }),
      })
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        await res.text().catch(() => '')
        return this.feil(await this.timebrukerMangler(navn, epost), false)
      }
      if (!res.ok) return this.avvis(res)
      const id = sisteSegment(res.headers.get('Location'))
      if (id) return { ok: true, verdi: id }
      // Opprettet, men uten Location: slå opp på nytt heller enn å feile.
      const etterpaa = await this.finnTimebruker(navn, epost)
      if (etterpaa) return { ok: true, verdi: etterpaa }
      return this.feil('Fiken svarte uten Location-header', true)
    })
  }

  /** Oppslag uten køen — kalles fra jobber som alt står i den. `null` betyr «ikke i Fiken». */
  private async finnTimebruker(navn: string, epost?: string | null): Promise<string | null> {
    const lik = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
    if (epost) {
      const paaEpost = await this.liste<Timebruker>(`/timeUsers?email=${encodeURIComponent(epost)}`)
      if (paaEpost.ok) {
        // Eksakt, aldri «første i lista»: timene havner i lønn og på faktura,
        // og et løst treff ville bundet dem til feil person i stillhet.
        const treff = paaEpost.verdi.find(t => !!t.email && lik(t.email, epost))
        if (treff) return String(treff.timeUserId)
      }
    }
    // `name` er DELVIS treff hos Fiken: «Ola» gir også «Ola Nordmannsen». Derfor eksakt her.
    const paaNavn = await this.liste<Timebruker>(`/timeUsers?name=${encodeURIComponent(navn)}`)
    if (paaNavn.ok) {
      const treff = paaNavn.verdi.find(t => lik(t.name, navn))
      if (treff) return String(treff.timeUserId)
    }
    return null
  }

  /** Feilmeldingen kontoret kan handle på, med personene Fiken har i dag. */
  private async timebrukerMangler(navn: string, epost?: string | null): Promise<string> {
    const alle = await this.liste<Timebruker>('/timeUsers')
    const navnene = alle.ok ? alle.verdi.map(t => t.name).filter(Boolean) : []
    const finnes = navnene.length ? ` Fiken har i dag: ${navnene.join(', ')}.` : ''
    const med = epost ? ` (${epost})` : ''
    return `Fiken har ingen person «${navn}»${med} under Timeføring, og API-et kan ikke opprette personer. `
      + `Legg personen inn i Fiken med samme navn og e-post, og prøv igjen.${finnes}`
  }

  /** Én timeføring. `ansattEksternId` er en Fiken timeUserId (se `synkTimebruker`). */
  async foerTimer(t: TimeUt): Promise<AdapterResultat<string>> {
    return this.trygt(async () => {
      const aktivitet = await this.synkAktivitetUlaast(t.aktivitetNavn)
      if (!aktivitet.ok) return aktivitet
      return this.opprett('/timeEntries', {
        date: iso(t.dato),
        hours: t.timer,
        description: t.kommentar ?? undefined,
        activityId: Number(aktivitet.verdi),
        projectId: t.prosjektEksternId ? Number(t.prosjektEksternId) : undefined,
        timeUserId: Number(t.ansattEksternId),
      })
    })
  }

  /** Samme som `synkAktivitet`, men uten køen — kalles fra en jobb som alt står i den. */
  private async synkAktivitetUlaast(navn: string): Promise<AdapterResultat<string>> {
    const fra = await this.liste<Aktivitet>(`/activities?name=${encodeURIComponent(navn)}`)
    if (fra.ok) {
      const treff = fra.verdi.find(a => a.name.trim().toLowerCase() === navn.trim().toLowerCase())
      if (treff) return { ok: true, verdi: String(treff.activityId) }
    }
    return this.opprett('/activities', { name: navn, billable: true })
  }

  // ── Faktura ────────────────────────────────────────────────────────────

  /**
   * Fakturautkast, aldri faktura. Én linje per linje i grunnlaget, med
   * `unitPrice` = enhetspris netto i øre, `quantity` = antall og `discount` i
   * prosent. Linjer med varenummer knyttes til varen i Fiken når `vareIder`
   * har den — da får Fikens salgsrapport riktig vare, og inntektskontoen
   * følger varen.
   */
  async opprettFakturautkast(
    utkast: FakturautkastUt & { prosjektEksternId?: string | null; vareIder?: Record<string, string> },
  ): Promise<AdapterResultat<string>> {
    return this.trygt(async () => {
      if (utkast.grunnlag.linjer.length === 0) return this.feil('Ingen fakturerbare linjer på ordren', false)
      const body = {
        type: 'invoice',
        issueDate: iso(utkast.dato),
        daysUntilDueDate: utkast.forfallsdager,
        customerId: Number(utkast.kundeEksternId),
        projectId: utkast.prosjektEksternId ? Number(utkast.prosjektEksternId) : undefined,
        invoiceText: utkast.ordreTekst ?? undefined,
        ourReference: utkast.ordrenummer != null ? `Ordre ${utkast.ordrenummer}` : undefined,
        orderReference: utkast.ordrenummer != null ? String(utkast.ordrenummer) : undefined,
        lines: utkast.grunnlag.linjer.map(l => {
          const vareId = l.elnummer ? utkast.vareIder?.[l.elnummer] : undefined
          return {
            productId: vareId ? Number(vareId) : undefined,
            // Fiken kutter lange tekster; 200 tegn er trygt.
            description: l.beskrivelse.slice(0, 200),
            unitPrice: l.enhetsprisOre,
            quantity: l.antall,
            discount: l.rabattProsent && l.rabattProsent > 0 ? l.rabattProsent : undefined,
            vatType: MVA_FIKEN[l.mva],
            incomeAccount: this.konto,
          }
        }),
      }
      return this.opprett('/invoices/drafts', body)
    })
  }

  /** Utkastet slik Fiken regnet det — kontrollen på at øre og mva stemmer med vårt grunnlag. */
  async hentUtkast(utkastId: string): Promise<AdapterResultat<{ nettoOre: number; bruttoOre: number; antallLinjer: number }>> {
    return this.trygt(async () => {
      const res = await this.kall(`/invoices/drafts/${encodeURIComponent(utkastId)}`)
      if (!res.ok) return this.avvis(res)
      const u = (await res.json()) as Utkast
      return { ok: true, verdi: { nettoOre: u.net ?? 0, bruttoOre: u.gross ?? 0, antallLinjer: u.lines?.length ?? 0 } }
    })
  }

  /**
   * Lager faktura av utkastet. Dette er det ene kallet som UTSTEDER noe, og
   * det skal bare skje etter et menneskes trykk — aldri automatisk.
   */
  async fakturerUtkast(utkastId: string): Promise<AdapterResultat<string>> {
    return this.trygt(() => this.opprett(`/invoices/drafts/${encodeURIComponent(utkastId)}/createInvoice`, {}))
  }

  /**
   * Status. `utkast:<id>` er et utkast (finnes det, er det fortsatt utkast);
   * ellers en faktura-ID. Fikens faktura har ikke `sent`/`settled` selv —
   * betalingen ligger på `sale.settled`, utsendelsen i `dispatches`.
   */
  async hentFakturastatus(eksternId: string): Promise<AdapterResultat<Fakturastatus>> {
    return this.trygt(async () => {
      if (eksternId.startsWith(UTKAST)) {
        const res = await this.kall(`/invoices/drafts/${encodeURIComponent(eksternId.slice(UTKAST.length))}`)
        if (res.status === 404) return { ok: true, verdi: 'ukjent' }
        if (!res.ok) return this.avvis(res)
        return { ok: true, verdi: 'utkast' }
      }
      const res = await this.kall(`/invoices/${encodeURIComponent(eksternId)}`)
      if (res.status === 404) return { ok: true, verdi: 'ukjent' }
      if (!res.ok) return this.avvis(res)
      const f = (await res.json()) as Faktura
      if (f.associatedCreditNotes && f.associatedCreditNotes.length > 0) return { ok: true, verdi: 'kreditert' }
      if (f.sale?.settled) return { ok: true, verdi: 'betalt' }
      if (f.dueDate && new Date(f.dueDate) < new Date()) return { ok: true, verdi: 'forfalt' }
      if (f.dispatches && f.dispatches.length > 0) return { ok: true, verdi: 'sendt' }
      // Utstedt, men ikke sendt fra Fiken (kunden sender kanskje selv).
      return { ok: true, verdi: 'sendt' }
    })
  }
}
