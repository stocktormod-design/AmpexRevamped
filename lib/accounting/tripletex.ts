import type {
  AdapterResultat, FakturautkastUt, Fakturastatus, KundeUt, Regnskapsadapter,
} from './adapter'
import { MVA_TRIPLETEX } from './adapter'

/**
 * Tripletex-adapter — adapter nummer to.
 *
 * ⚠ KJØRER IKKE I APPEN. Samme regel som Fiken: en `employeeToken` er en nøkkel
 * til hele regnskapet og skal aldri ligge på en montørtelefon. Modulen er
 * skrevet uten React Native-avhengigheter slik at den kan kjøre i en Supabase
 * Edge Function eller i Ampex Kontor.
 *
 * ── Tre ting som skiller seg fra Fiken, og som er dyre å gjøre feil ─────────
 *
 * 1. **BELØPENE ER KRONER MED DESIMALER, IKKE ØRE.** Dette er speilvendt av
 *    Fiken, og det er den farligste forskjellen i hele fila. Ampex regner i øre
 *    som heltall hele veien (`lib/invoicing.ts`); sendes `nettoOre` rått til
 *    Tripletex blir fakturaen **100× for høy**. Derfor går hvert eneste beløp
 *    gjennom `tilKroner()` — ingen inline-divisjon noe sted.
 *
 * 2. **Det finnes ikke noe «fakturautkast».** Tripletex' modell er at man lager
 *    en ORDRE, og at ordren senere faktureres (`PUT /order/{id}/:invoice`).
 *    En ordre som ikke er fakturert ER utkastet. Det passer prinsippet i
 *    `adapter.ts` presist: Ampex utsteder aldri en faktura, vi lager grunnlaget
 *    og et menneske trykker. Vi kaller derfor ALDRI `:invoice` herfra.
 *
 * 3. **Autentiseringen er to steg.** `consumerToken` + `employeeToken` byttes
 *    inn i en tidsbegrenset SESJONSTOKEN, og det er den som brukes — som Basic
 *    auth med `companyId:sessionToken`. Tokenet caches til utløp; uten caching
 *    ville hver eneste operasjon kostet et ekstra rundtur-kall.
 *
 * MVA sendes som `vatType.id` (3 = 25 %, 31 = 15 %, 32 = 12 %, 5 = fritatt) —
 * se `MVA_TRIPLETEX` i adapter.ts. Tripletex regner selv ut mva-beløpet fra
 * satsen; vi sender netto per linje og lar regnskapet være fasit på øret. Vårt
 * eget `mvaOre` er til visning i appen, ikke noe vi presser på regnskapet.
 */

export type TripletexKonfig = {
  /** Fra API 2.0-registreringen. Identifiserer Ampex som integrasjon. */
  consumerToken: string
  /** Firmaets eget token, laget av en ansatt i Tripletex. */
  employeeToken: string
  /**
   * Firma-ID i Basic auth. `0` betyr «firmaet tokenet tilhører», som er riktig
   * for alle andre enn regnskapsførere som jobber på tvers av klienter.
   */
  companyId?: string
  /**
   * Test: `https://api-test.tripletex.tech/v2` (standard — tokens fra test
   * virker IKKE i produksjon, og omvendt).
   * Produksjon: `https://tripletex.no/v2`.
   */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Sesjonstokenets levetid i dager. Tripletex tillater maks 30. */
  sesjonsdager?: number
}

const TEST_BASE = 'https://api-test.tripletex.tech/v2'

/**
 * Øre (heltall) → kroner (desimaltall), som Tripletex vil ha det.
 *
 * Egen funksjon og ikke `/100` på kallstedet, med vilje: en manglende divisjon
 * ett sted er en faktura som er hundre ganger for høy, og den feilen skal ikke
 * kunne oppstå ved at noen glemmer den i én av fem linjer.
 */
function tilKroner(ore: number): number {
  return Math.round(ore) / 100
}

/** Base64 uten Node-avhengighet — `btoa` finnes i Deno, nettleser og Node 16+. */
function base64(s: string): string {
  if (typeof btoa === 'function') return btoa(s)
  return (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
    .Buffer!.from(s, 'utf-8').toString('base64')
}

function isoDato(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export class TripletexAdapter implements Regnskapsadapter {
  readonly system = 'tripletex' as const
  readonly navn = 'Tripletex'

  private readonly consumerToken: string
  private readonly employeeToken: string
  private readonly companyId: string
  private readonly base: string
  private readonly hent: typeof fetch
  private readonly sesjonsdager: number

  /** Cachet sesjonstoken. Fornyes når det er utløpt eller mangler. */
  private sesjon: { token: string; utloper: Date } | null = null

  constructor(konfig: TripletexKonfig) {
    this.consumerToken = konfig.consumerToken
    this.employeeToken = konfig.employeeToken
    this.companyId = konfig.companyId ?? '0'
    this.base = konfig.baseUrl ?? TEST_BASE
    this.hent = konfig.fetchImpl ?? fetch
    this.sesjonsdager = konfig.sesjonsdager ?? 7
  }

  /**
   * Tripletex rate-limiter per sesjon. Samme serialisering som Fiken-adapteren
   * — kallstedene skal ikke måtte huske det.
   */
  private ko: Promise<unknown> = Promise.resolve()
  private serielt<T>(jobb: () => Promise<T>): Promise<T> {
    const neste = this.ko.then(jobb, jobb)
    this.ko = neste.catch(() => undefined)
    return neste
  }

  private async feilTekst(res: Response): Promise<string> {
    const tekst = await res.text().catch(() => '')
    return `Tripletex ${res.status}: ${tekst.slice(0, 400) || res.statusText}`
  }

  /** 429 og 5xx er forbigående; 4xx ellers er vår feil og blir ikke bedre av å prøves igjen. */
  private kanProves(status: number): boolean {
    return status === 429 || status >= 500
  }

  /**
   * Bytter de to langtidstokenene inn i en sesjonstoken.
   *
   * Fornyes ti minutter FØR utløp, ikke på utløpstidspunktet: et kall som
   * starter like før midnatt skal ikke feile fordi tokenet gikk ut mens
   * forespørselen var underveis.
   */
  private async sesjonstoken(): Promise<string> {
    const naa = new Date()
    if (this.sesjon && this.sesjon.utloper.getTime() - naa.getTime() > 10 * 60_000) {
      return this.sesjon.token
    }

    const utloper = new Date(naa.getTime() + this.sesjonsdager * 86_400_000)
    const url = `${this.base}/token/session/:create`
      + `?consumerToken=${encodeURIComponent(this.consumerToken)}`
      + `&employeeToken=${encodeURIComponent(this.employeeToken)}`
      + `&expirationDate=${isoDato(utloper)}`

    const res = await this.hent(url, { method: 'PUT' })
    if (!res.ok) throw new Error(await this.feilTekst(res))

    const svar = (await res.json()) as { value?: { token?: string; expirationDate?: string } }
    const token = svar.value?.token
    if (!token) throw new Error('Tripletex svarte uten sesjonstoken')

    this.sesjon = {
      token,
      utloper: svar.value?.expirationDate ? new Date(svar.value.expirationDate) : utloper,
    }
    return token
  }

  private async kall(sti: string, init?: RequestInit): Promise<Response> {
    const token = await this.sesjonstoken()
    return this.hent(`${this.base}${sti}`, {
      ...init,
      headers: {
        Authorization: `Basic ${base64(`${this.companyId}:${token}`)}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  }

  async synkKunde(kunde: KundeUt): Promise<AdapterResultat<string>> {
    return this.serielt(async () => {
      try {
        // Finn først — samme grunn som i Fiken-adapteren: uten dette lages en ny
        // kunde per faktura, og duplikater i kunderegisteret betyr faktura til
        // feil part. Organisasjonsnummeret er den harde nøkkelen; navn er
        // reserven for privatkunder som ikke har et.
        if (kunde.erBedrift && kunde.orgNr) {
          const res = await this.kall(`/customer?organizationNumber=${encodeURIComponent(kunde.orgNr)}&count=10`)
          if (res.ok) {
            const treff = (await res.json()) as { values?: { id: number; organizationNumber?: string }[] }
            const eksakt = treff.values?.find(k => k.organizationNumber === kunde.orgNr)
            if (eksakt) return { ok: true as const, verdi: String(eksakt.id) }
          }
        } else {
          const res = await this.kall(`/customer?name=${encodeURIComponent(kunde.navn)}&count=25`)
          if (res.ok) {
            const treff = (await res.json()) as { values?: { id: number; name: string }[] }
            const eksakt = treff.values?.find(
              k => k.name.trim().toLowerCase() === kunde.navn.trim().toLowerCase(),
            )
            if (eksakt) return { ok: true as const, verdi: String(eksakt.id) }
          }
        }

        const body: Record<string, unknown> = {
          name: kunde.navn,
          isCustomer: true,
          isSupplier: false,
          email: kunde.epost ?? undefined,
          phoneNumber: kunde.telefon ?? undefined,
          organizationNumber: kunde.erBedrift ? kunde.orgNr ?? undefined : undefined,
          isPrivateIndividual: !kunde.erBedrift,
        }
        if (kunde.adresse || kunde.postnummer || kunde.poststed) {
          body.postalAddress = {
            addressLine1: kunde.adresse ?? undefined,
            postalCode: kunde.postnummer ?? undefined,
            city: kunde.poststed ?? undefined,
          }
        }

        const res = await this.kall('/customer', { method: 'POST', body: JSON.stringify(body) })
        if (!res.ok) {
          return { ok: false as const, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
        }
        // I motsetning til Fiken svarer Tripletex med objektet i bodyen — ingen
        // Location-header å plukke ID fra.
        const laget = (await res.json()) as { value?: { id?: number } }
        const id = laget.value?.id
        if (id == null) return { ok: false as const, feil: 'Tripletex svarte uten kunde-ID', kanProvesIgjen: true }
        return { ok: true as const, verdi: String(id) }
      } catch (e) {
        return { ok: false as const, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
      }
    })
  }

  /**
   * Lager en ORDRE i Tripletex — som er det Tripletex kaller et fakturautkast.
   *
   * Ordren faktureres ALDRI herfra. `PUT /order/{id}/:invoice` er handlingen som
   * gjør den til en ekte faktura med nummer, og den skal et menneske gjøre inne
   * i Tripletex. Se prinsippet øverst i `adapter.ts`.
   *
   * Linjene sendes med `count: 1` og hele linjebeløpet som enhetspris. Antallet
   * står allerede i beskrivelsen fra `lib/invoicing.ts`, og å sende det som
   * `count` ville betydd at Tripletex ganger opp på nytt — samme tall to steder
   * er ett sted for mye når det handler om penger.
   */
  async opprettFakturautkast(utkast: FakturautkastUt): Promise<AdapterResultat<string>> {
    return this.serielt(async () => {
      if (utkast.grunnlag.linjer.length === 0) {
        return { ok: false as const, feil: 'Ingen fakturerbare linjer på ordren', kanProvesIgjen: false }
      }
      try {
        const ordreBody = {
          customer: { id: Number(utkast.kundeEksternId) },
          orderDate: isoDato(utkast.dato),
          deliveryDate: isoDato(utkast.dato),
          invoicesDueIn: utkast.forfallsdager,
          invoicesDueInType: 'DAYS',
          ourContact: undefined,
          reference: utkast.ordrenummer ? `Ordre ${utkast.ordrenummer}` : undefined,
          orderLineSorting: 'ID',
          // Fri tekst øverst — typisk adressen jobben ble utført på.
          ...(utkast.ordreTekst ? { comment: utkast.ordreTekst } : {}),
        }

        const res = await this.kall('/order', { method: 'POST', body: JSON.stringify(ordreBody) })
        if (!res.ok) {
          return { ok: false as const, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
        }
        const laget = (await res.json()) as { value?: { id?: number } }
        const ordreId = laget.value?.id
        if (ordreId == null) {
          return { ok: false as const, feil: 'Tripletex svarte uten ordre-ID', kanProvesIgjen: true }
        }

        // Linjene legges på etterpå. Tripletex tar imot dem i bulk, og det er
        // ETT kall — feiler det, står ordren igjen tom og kan ryddes, i stedet
        // for at halve fakturaen ligger der.
        const linjer = utkast.grunnlag.linjer.map(l => ({
          order: { id: ordreId },
          description: l.beskrivelse.slice(0, 250),
          count: 1,
          unitPriceExcludingVatCurrency: tilKroner(l.nettoOre),
          vatType: { id: Number(MVA_TRIPLETEX[l.mva]) },
        }))

        const linjeRes = await this.kall('/order/orderline/list', {
          method: 'POST',
          body: JSON.stringify(linjer),
        })
        if (!linjeRes.ok) {
          return {
            ok: false as const,
            feil: `Ordren ble opprettet (${ordreId}), men linjene feilet: ${await this.feilTekst(linjeRes)}`,
            kanProvesIgjen: this.kanProves(linjeRes.status),
          }
        }

        return { ok: true as const, verdi: String(ordreId) }
      } catch (e) {
        return { ok: false as const, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
      }
    })
  }

  /**
   * Status på ordren/fakturaen.
   *
   * `eksternId` er ordre-ID-en fra `opprettFakturautkast`. Er ordren ikke
   * fakturert ennå, har den ingen faktura — og da er svaret `utkast`, som er
   * hele poenget med at vi lager ordrer og ikke fakturaer.
   */
  async hentFakturastatus(eksternId: string): Promise<AdapterResultat<Fakturastatus>> {
    return this.serielt(async () => {
      try {
        const res = await this.kall(`/order/${encodeURIComponent(eksternId)}`)
        if (res.status === 404) return { ok: true as const, verdi: 'ukjent' as Fakturastatus }
        if (!res.ok) {
          return { ok: false as const, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
        }
        const o = (await res.json()) as { value?: { isClosed?: boolean; invoice?: { id?: number } } }
        const fakturaId = o.value?.invoice?.id
        if (fakturaId == null) return { ok: true as const, verdi: 'utkast' as Fakturastatus }

        const fRes = await this.kall(`/invoice/${fakturaId}`)
        if (!fRes.ok) {
          return { ok: false as const, feil: await this.feilTekst(fRes), kanProvesIgjen: this.kanProves(fRes.status) }
        }
        const f = (await fRes.json()) as {
          value?: { amountOutstanding?: number; isCreditNote?: boolean; invoiceDueDate?: string }
        }
        const v = f.value ?? {}
        if (v.isCreditNote) return { ok: true as const, verdi: 'kreditert' as Fakturastatus }
        // `amountOutstanding === 0` er betalt. Feltet er kroner, som alt annet her.
        if (v.amountOutstanding === 0) return { ok: true as const, verdi: 'betalt' as Fakturastatus }
        if (v.invoiceDueDate && new Date(v.invoiceDueDate) < new Date()) {
          return { ok: true as const, verdi: 'forfalt' as Fakturastatus }
        }
        return { ok: true as const, verdi: 'sendt' as Fakturastatus }
      } catch (e) {
        return { ok: false as const, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
      }
    })
  }
}
