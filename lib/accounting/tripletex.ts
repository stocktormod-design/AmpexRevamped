import type {
  AdapterResultat, FakturautkastUt, Fakturastatus, KundeUt, Regnskapsadapter,
} from './adapter'
import { MVA_TRIPLETEX } from './adapter'
import type { MvaType } from '../invoicing'

/**
 * Tripletex-adapter — adapter nummer to, samme kontrakt som Fiken.
 *
 * ⚠ KJØRER IKKE I APPEN. Consumer- og employee-token er nøkler til hele
 * regnskapet og skal aldri ligge på en montørtelefon. Modulen er skrevet uten
 * React Native-avhengigheter, slik at den kan kjøre i en Supabase Edge Function
 * eller i Ampex Desktop.
 *
 * Domenet mappes slik:
 *
 *   Ampex «fakturautkast»  →  Tripletex ORDRE (`POST /order`).
 *   Tripletex har ikke fakturautkast; ordren ER utkastet, og mennesket
 *   utsteder fakturaen fra ordren (`PUT /order/{id}/:invoice`) — i Tripletex
 *   sitt eget grensesnitt eller via `fakturerOrdre()` under. Det er samme
 *   mønster som Fiken-utkastet: Ampex lager, mennesket utsteder.
 *
 * Tre ting som er lette å gjøre feil, og som koster penger:
 *
 * 1. **Beløp er KRONER med desimaler**, ikke øre som hos Fiken. `24.9` er 24,90.
 * 2. **MVA angis som VatType-objekt med `id`**, ikke som kode. Kodene våre
 *    ('3', '31', '32', '5') er Tripletex sine `number`-verdier; ID-ene slås opp
 *    én gang per økt via `/ledger/vatType` og caches.
 * 3. **Sesjonen er tidsbegrenset.** Session-token lages med utløpsdato, og all
 *    trafikk går som Basic auth med brukernavn `0` og token som passord.
 */

export type TripletexKonfig = {
  consumerToken: string
  employeeToken: string
  /** `https://api-test.tripletex.tech/v2` i sandkassa, `https://tripletex.no/v2` i produksjon. */
  baseUrl?: string
  /** Allerede opprettet session-token (hopper over `:create`). */
  sessionToken?: string
  fetchImpl?: typeof fetch
}

export const TRIPLETEX_TEST = 'https://api-test.tripletex.tech/v2'
export const TRIPLETEX_PROD = 'https://tripletex.no/v2'

type TlxSvar<T> = { value: T }
type TlxListe<T> = { values: T[]; fullResultSize?: number }
type TlxKunde = { id: number; name: string; organizationNumber?: string | null; email?: string | null }
type TlxVat = { id: number; number: string; name?: string; percentage?: number }
type TlxOrdre = {
  id: number
  isClosed?: boolean
  orderLines?: { amountExcludingVatCurrency?: number; description?: string }[]
  preliminaryInvoice?: { id: number } | null
}
type TlxProsjekt = { id: number; name: string; number?: string | null }
type TlxAktivitet = { id: number; name: string }
type TlxProdukt = { id: number; name: string; number?: string | null; elNumber?: string | null }
type TlxTimeføring = { id: number; hours: number; date: string; chargeableHours?: number }
type TlxEnhet = { id: number; name: string; nameShort?: string | null }

export type ProsjektUt = {
  navn: string
  /** Vårt ordrenummer/prosjektnummer — brukes som Tripletex «number» så det kan finnes igjen. */
  nummer: string
  kundeEksternId: string
  startDato: Date
  beskrivelse?: string | null
  /** Adressen jobben utføres på — Tripletex har eget felt for Boligmappa-adresse. */
  adresse?: { gate?: string | null; postnummer?: string | null; poststed?: string | null } | null
}

export type VareUt = {
  /** Varenummer i regnskapet — el-nummer der vi har det, ellers vår egen ID. */
  nummer: string
  navn: string
  enhet: string
  salgsprisOre: number
  kostprisOre?: number | null
  mva: MvaType
}

export type TimeUt = {
  /** Tripletex employee-ID. Hentes fra `hvemErJeg()` for tokenets ansatt. */
  ansattEksternId: string
  aktivitetNavn: string
  prosjektEksternId?: string | null
  dato: Date
  timer: number
  kommentar?: string | null
}

type TlxFaktura = {
  id: number
  invoiceNumber?: number
  invoiceDueDate?: string
  amountOutstanding?: number
  isCredited?: boolean
  isCreditNote?: boolean
  isCharged?: boolean
  orders?: { id: number }[]
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pluss(d: Date, dager: number): Date {
  const n = new Date(d)
  n.setUTCDate(n.getUTCDate() + dager)
  return n
}

/** Kroner fra øre, med to desimaler — Tripletex avviser ikke flere, men runder selv. */
export function kroner(ore: number): number {
  return Math.round(ore) / 100
}

/**
 * Base64 av en ASCII-streng. Skrevet for hånd med vilje: Node-globalen finnes ikke i
 * React Native, og `btoa` ikke i Node. Modulen skal kunne kjøre begge steder (Edge
 * Function, Ampex Desktop, selvtest). Node-globalen brøt dessuten `npm run typecheck`,
 * siden appens tsconfig ikke har @types/node. Tokenene er ASCII, så ingen UTF-8-håndtering
 * trengs. Verifisert bit-identisk mot Node på tomme, 1-, 2- og 3-modulo-lengder.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function base64Ascii(inn: string): string {
  let ut = ''
  for (let i = 0; i < inn.length; i += 3) {
    const c0 = inn.charCodeAt(i)
    const c1 = i + 1 < inn.length ? inn.charCodeAt(i + 1) : NaN
    const c2 = i + 2 < inn.length ? inn.charCodeAt(i + 2) : NaN
    ut += B64[c0 >> 2]
    ut += B64[((c0 & 3) << 4) | (Number.isNaN(c1) ? 0 : c1 >> 4)]
    ut += Number.isNaN(c1) ? '=' : B64[((c1 & 15) << 2) | (Number.isNaN(c2) ? 0 : c2 >> 6)]
    ut += Number.isNaN(c2) ? '=' : B64[c2 & 63]
  }
  return ut
}

export class TripletexAdapter implements Regnskapsadapter {
  readonly system = 'tripletex' as const
  readonly navn = 'Tripletex'

  private readonly consumer: string
  private readonly employee: string
  private readonly base: string
  private readonly hent: typeof fetch
  private session: string | null
  private vatIder: Map<string, number> | null = null

  constructor(konfig: TripletexKonfig) {
    this.consumer = konfig.consumerToken
    this.employee = konfig.employeeToken
    this.base = (konfig.baseUrl ?? TRIPLETEX_PROD).replace(/\/+$/, '')
    this.hent = konfig.fetchImpl ?? fetch
    this.session = konfig.sessionToken ?? null
  }

  // ── Økt ───────────────────────────────────────────────────────────────────

  /**
   * Lager session-token. Gyldig til midnatt på `expirationDate`; vi ber om i
   * morgen, så en økt aldri dør midt i en synk. Kalles automatisk ved første
   * behov, men kan kalles eksplisitt for å teste tilgangen.
   */
  async opprettOkt(): Promise<AdapterResultat<string>> {
    try {
      const utlop = iso(pluss(new Date(), 1))
      const url = `${this.base}/token/session/:create?consumerToken=${encodeURIComponent(this.consumer)}`
        + `&employeeToken=${encodeURIComponent(this.employee)}&expirationDate=${utlop}`
      const res = await this.hent(url, { method: 'PUT' })
      if (!res.ok) {
        return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      }
      const svar = (await res.json()) as TlxSvar<{ token: string }>
      if (!svar.value?.token) return { ok: false, feil: 'Tripletex svarte uten session-token', kanProvesIgjen: true }
      this.session = svar.value.token
      return { ok: true, verdi: this.session }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  private async sikreOkt(): Promise<AdapterResultat<string>> {
    if (this.session) return { ok: true, verdi: this.session }
    return this.opprettOkt()
  }

  private async kall(sti: string, init?: RequestInit): Promise<Response> {
    const okt = await this.sikreOkt()
    if (!okt.ok) throw new Error(okt.feil)
    // Basic auth: brukernavn «0» (= selskapet tokenet tilhører), passord = session-token.
    const auth = base64Ascii(`0:${okt.verdi}`)
    const res = await this.hent(`${this.base}${sti}`, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    // Utløpt økt: lag ny og prøv én gang til.
    if (res.status === 401 && this.session) {
      this.session = null
      const ny = await this.sikreOkt()
      if (!ny.ok) return res
      const auth2 = base64Ascii(`0:${ny.verdi}`)
      return this.hent(`${this.base}${sti}`, {
        ...init,
        headers: { Authorization: `Basic ${auth2}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      })
    }
    return res
  }

  private async feilTekst(res: Response): Promise<string> {
    const tekst = await res.text().catch(() => '')
    // Tripletex legger feilen i {"status":422,"message":"…","validationMessages":[…]}.
    let melding = tekst
    try {
      const j = JSON.parse(tekst) as { message?: string; validationMessages?: { field?: string; message?: string }[] }
      const v = (j.validationMessages ?? []).map(m => `${m.field ?? ''}: ${m.message ?? ''}`).join('; ')
      melding = [j.message, v].filter(Boolean).join(' — ')
    } catch { /* ikke JSON */ }
    return `Tripletex ${res.status}: ${melding.slice(0, 400) || res.statusText}`
  }

  /** 429 og 5xx er forbigående; 4xx ellers er vår feil og blir ikke bedre av å prøves igjen. */
  private kanProves(status: number): boolean {
    return status === 429 || status >= 500
  }

  // ── MVA ───────────────────────────────────────────────────────────────────

  /** number → id for MVA-typene vi bruker. Slås opp én gang og caches på adapteren. */
  private async vatId(kode: string): Promise<number> {
    if (!this.vatIder) {
      const res = await this.kall('/ledger/vatType?fields=id,number,name,percentage&count=200')
      if (!res.ok) throw new Error(await this.feilTekst(res))
      const liste = (await res.json()) as TlxListe<TlxVat>
      this.vatIder = new Map(liste.values.map(v => [String(v.number), v.id]))
    }
    const id = this.vatIder.get(kode)
    if (id == null) throw new Error(`Tripletex mangler MVA-type med nummer ${kode}`)
    return id
  }

  // ── Hvem er jeg (ansatt-ID for timeføring) ────────────────────────────────

  async hvemErJeg(): Promise<AdapterResultat<{ ansattId: string; selskapId: string }>> {
    try {
      const res = await this.kall('/token/session/>whoAmI?fields=employeeId,companyId')
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const v = ((await res.json()) as TlxSvar<{ employeeId: number; companyId: number }>).value
      return { ok: true, verdi: { ansattId: String(v.employeeId), selskapId: String(v.companyId) } }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  // ── Prosjekt ──────────────────────────────────────────────────────────────

  /** Ett Tripletex-prosjekt per Ampex-ordre/prosjekt. Idempotent på `nummer`. */
  async synkProsjekt(p: ProsjektUt): Promise<AdapterResultat<string>> {
    try {
      const sok = await this.kall(`/project?number=${encodeURIComponent(p.nummer)}&fields=id,name,number&count=10`)
      if (sok.ok) {
        const treff = ((await sok.json()) as TlxListe<TlxProsjekt>).values ?? []
        const eksakt = treff.find(x => String(x.number ?? '') === p.nummer)
        if (eksakt) return { ok: true, verdi: String(eksakt.id) }
      }
      const meg = await this.hvemErJeg()
      if (!meg.ok) return meg
      const body: Record<string, unknown> = {
        name: p.navn,
        number: p.nummer,
        description: p.beskrivelse ?? undefined,
        projectManager: { id: Number(meg.verdi.ansattId) },
        customer: { id: Number(p.kundeEksternId) },
        startDate: iso(p.startDato),
        isInternal: false,
        boligmappaAddress: p.adresse ? {
          addressLine1: p.adresse.gate ?? undefined,
          postalCode: p.adresse.postnummer ?? undefined,
          city: p.adresse.poststed ?? undefined,
        } : undefined,
      }
      const res = await this.kall('/project', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const v = ((await res.json()) as TlxSvar<TlxProsjekt>).value
      if (!v?.id) return { ok: false, feil: 'Tripletex svarte uten prosjekt-ID', kanProvesIgjen: true }
      return { ok: true, verdi: String(v.id) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  // ── Aktivitet (timeføring) ────────────────────────────────────────────────

  private aktiviteter = new Map<string, number>()

  /**
   * Finner (eller oppretter) en fakturerbar aktivitet med dette navnet som kan brukes på
   * timeføring. Med prosjekt spørres `/activity/>forTimeSheet` — en aktivitet som ikke er
   * tilgjengelig for prosjektet avvises av Tripletex («Aktiviteten kan ikke benyttes»).
   * Nye aktiviteter opprettes som PROJECT_GENERAL_ACTIVITY: gyldig på alle prosjekter.
   */
  async synkAktivitet(navn: string, timeprisOre?: number | null, prosjektEksternId?: string | null): Promise<AdapterResultat<string>> {
    const nøkkel = `${prosjektEksternId ?? ''}|${navn.trim().toLowerCase()}`
    const cached = this.aktiviteter.get(nøkkel)
    if (cached) return { ok: true, verdi: String(cached) }
    try {
      const sti = prosjektEksternId
        ? `/activity/>forTimeSheet?projectId=${encodeURIComponent(prosjektEksternId)}&fields=id,name&count=200`
        : `/activity?name=${encodeURIComponent(navn)}&isInactive=false&fields=id,name&count=50`
      const sok = await this.kall(sti)
      if (sok.ok) {
        const treff = ((await sok.json()) as TlxListe<TlxAktivitet>).values ?? []
        const eksakt = treff.find(a => a.name.trim().toLowerCase() === navn.trim().toLowerCase())
        if (eksakt) { this.aktiviteter.set(nøkkel, eksakt.id); return { ok: true, verdi: String(eksakt.id) } }
      }
      const body = {
        name: navn,
        activityType: 'PROJECT_GENERAL_ACTIVITY',
        isChargeable: true,
        rate: timeprisOre != null ? kroner(timeprisOre) : undefined,
      }
      const res = await this.kall('/activity', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const v = ((await res.json()) as TlxSvar<TlxAktivitet>).value
      if (!v?.id) return { ok: false, feil: 'Tripletex svarte uten aktivitet-ID', kanProvesIgjen: true }
      this.aktiviteter.set(nøkkel, v.id)
      return { ok: true, verdi: String(v.id) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

  /** Én timeføring → én TimesheetEntry. Returnerer entry-ID. */
  async foerTimer(t: TimeUt): Promise<AdapterResultat<string>> {
    const akt = await this.synkAktivitet(t.aktivitetNavn, null, t.prosjektEksternId)
    if (!akt.ok) return akt
    try {
      const body = {
        employee: { id: Number(t.ansattEksternId) },
        activity: { id: Number(akt.verdi) },
        project: t.prosjektEksternId ? { id: Number(t.prosjektEksternId) } : undefined,
        date: iso(t.dato),
        hours: t.timer,
        comment: t.kommentar ?? undefined,
      }
      const res = await this.kall('/timesheet/entry', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const v = ((await res.json()) as TlxSvar<TlxTimeføring>).value
      if (!v?.id) return { ok: false, feil: 'Tripletex svarte uten timeførings-ID', kanProvesIgjen: true }
      return { ok: true, verdi: String(v.id) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  /** Timer ført på et prosjekt i et datointervall — for å verifisere at synken traff. */
  async hentTimer(prosjektEksternId: string, fra: Date, til: Date): Promise<AdapterResultat<{ id: string; timer: number; dato: string }[]>> {
    try {
      // Tripletex: dateFrom inklusiv, dateTo EKSKLUSIV → én dag etter `til`.
      const res = await this.kall(`/timesheet/entry?projectId=${encodeURIComponent(prosjektEksternId)}&dateFrom=${iso(fra)}&dateTo=${iso(pluss(til, 1))}&fields=id,hours,date&count=1000`)
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const v = ((await res.json()) as TlxListe<TlxTimeføring>).values ?? []
      return { ok: true, verdi: v.map(x => ({ id: String(x.id), timer: x.hours, dato: x.date })) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  // ── Vare (materiell) ─────────────────────────────────────────────────────

  private enheter: Map<string, number> | null = null

  private async enhetId(navn: string): Promise<number | undefined> {
    if (!this.enheter) {
      const res = await this.kall('/product/unit?fields=id,name,nameShort&count=200')
      if (!res.ok) return undefined
      const v = ((await res.json()) as TlxListe<TlxEnhet>).values ?? []
      this.enheter = new Map()
      for (const e of v) {
        this.enheter.set(e.name.trim().toLowerCase(), e.id)
        if (e.nameShort) this.enheter.set(e.nameShort.trim().toLowerCase(), e.id)
      }
    }
    return this.enheter.get(navn.trim().toLowerCase())
  }

  /** Speiler en vare til Tripletex' produktregister. Idempotent på `nummer`. */
  async synkVare(v: VareUt): Promise<AdapterResultat<string>> {
    try {
      const sok = await this.kall(`/product?number=${encodeURIComponent(v.nummer)}&fields=id,name,number&count=10`)
      if (sok.ok) {
        const treff = ((await sok.json()) as TlxListe<TlxProdukt>).values ?? []
        const eksakt = treff.find(p => String(p.number ?? '') === v.nummer)
        if (eksakt) return { ok: true, verdi: String(eksakt.id) }
      }
      const enhet = await this.enhetId(v.enhet)
      const body = {
        name: v.navn,
        number: v.nummer,
        priceExcludingVatCurrency: kroner(v.salgsprisOre),
        costExcludingVatCurrency: v.kostprisOre != null ? kroner(v.kostprisOre) : undefined,
        vatType: { id: await this.vatId(MVA_TRIPLETEX[v.mva]) },
        productUnit: enhet ? { id: enhet } : undefined,
      }
      const res = await this.kall('/product', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const p = ((await res.json()) as TlxSvar<TlxProdukt>).value
      if (!p?.id) return { ok: false, feil: 'Tripletex svarte uten produkt-ID', kanProvesIgjen: true }
      return { ok: true, verdi: String(p.id) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  // ── Kunde ─────────────────────────────────────────────────────────────────

  async synkKunde(kunde: KundeUt): Promise<AdapterResultat<string>> {
    try {
      // Finn først — ellers får kunderegisteret én kopi per faktura.
      const sok = kunde.erBedrift && kunde.orgNr
        ? `/customer?organizationNumber=${encodeURIComponent(kunde.orgNr)}&fields=id,name,organizationNumber&count=25`
        : `/customer?customerName=${encodeURIComponent(kunde.navn)}&fields=id,name,organizationNumber&count=25`
      const res1 = await this.kall(sok)
      if (res1.ok) {
        const treff = ((await res1.json()) as TlxListe<TlxKunde>).values ?? []
        const eksakt = treff.find(k =>
          (kunde.orgNr && k.organizationNumber === kunde.orgNr)
          || k.name.trim().toLowerCase() === kunde.navn.trim().toLowerCase(),
        )
        if (eksakt) return { ok: true, verdi: String(eksakt.id) }
      }

      const body: Record<string, unknown> = {
        name: kunde.navn,
        isPrivateIndividual: !kunde.erBedrift,
        organizationNumber: kunde.erBedrift ? kunde.orgNr ?? undefined : undefined,
        email: kunde.epost ?? undefined,
        invoiceEmail: kunde.epost ?? undefined,
        phoneNumberMobile: kunde.telefon ?? undefined,
        // Tripletex skiller postadresse og besøksadresse; vi har én.
        postalAddress: (kunde.adresse || kunde.postnummer || kunde.poststed) ? {
          addressLine1: kunde.adresse ?? undefined,
          postalCode: kunde.postnummer ?? undefined,
          city: kunde.poststed ?? undefined,
        } : undefined,
      }
      const res = await this.kall('/customer', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const svar = (await res.json()) as TlxSvar<TlxKunde>
      if (!svar.value?.id) return { ok: false, feil: 'Tripletex svarte uten kunde-ID', kanProvesIgjen: true }
      return { ok: true, verdi: String(svar.value.id) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  // ── Utkast = ordre ────────────────────────────────────────────────────────

  /**
   * Lager en ORDRE med linjene fra fakturagrunnlaget. Returnerer ordre-ID.
   * Utsteder aldri faktura. Linjene sendes som antall × enhetspris − rabatt%,
   * så fakturaen ser ut som tilbudet; nettosummen kontrolleres mot vår egen
   * (øre-avrundet én gang) og avvik over 1 øre per linje rapporteres som feil,
   * ikke skjules.
   */
  async opprettFakturautkast(
    utkast: FakturautkastUt,
    ekstra: { prosjektEksternId?: string | null; produktIdForElnummer?: Map<string, string> } = {},
  ): Promise<AdapterResultat<string>> {
    if (utkast.grunnlag.linjer.length === 0) {
      return { ok: false, feil: 'Ingen fakturerbare linjer på ordren', kanProvesIgjen: false }
    }
    try {
      const orderLines = []
      for (const l of utkast.grunnlag.linjer) {
        // Materiell med kjent produkt i Tripletex knyttes til produktet — da får
        // regnskapet varestatistikk og lager, ikke bare en tekstlinje.
        const pid = l.elnummer ? ekstra.produktIdForElnummer?.get(l.elnummer) : undefined
        orderLines.push({
          product: pid ? { id: Number(pid) } : undefined,
          description: l.beskrivelse.slice(0, 500),
          count: l.antall,
          unitPriceExcludingVatCurrency: kroner(l.enhetsprisOre),
          discount: l.rabattProsent ?? 0,
          vatType: { id: await this.vatId(MVA_TRIPLETEX[l.mva]) },
        })
      }
      const body = {
        customer: { id: Number(utkast.kundeEksternId) },
        project: ekstra.prosjektEksternId ? { id: Number(ekstra.prosjektEksternId) } : undefined,
        orderDate: iso(utkast.dato),
        deliveryDate: iso(utkast.dato),
        invoicesDueIn: utkast.forfallsdager,
        invoicesDueInType: 'DAYS',
        reference: utkast.ordrenummer ? `Ampex ordre ${utkast.ordrenummer}` : undefined,
        invoiceComment: utkast.ordreTekst ?? undefined,
        orderLines,
      }
      const res = await this.kall('/order', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const svar = (await res.json()) as TlxSvar<TlxOrdre>
      const id = svar.value?.id
      if (!id) return { ok: false, feil: 'Tripletex svarte uten ordre-ID', kanProvesIgjen: true }

      // Kontroll: Tripletex sin nettosum per linje mot vår.
      const deres = svar.value.orderLines ?? []
      const avvik: string[] = []
      utkast.grunnlag.linjer.forEach((l, i) => {
        const d = deres[i]?.amountExcludingVatCurrency
        if (typeof d === 'number' && Math.abs(Math.round(d * 100) - l.nettoOre) > 1) {
          avvik.push(`«${l.beskrivelse.slice(0, 40)}»: vår ${kroner(l.nettoOre)} ≠ Tripletex ${d}`)
        }
      })
      if (avvik.length > 0) {
        return { ok: false, feil: `Ordre ${id} opprettet, men nettosum avviker: ${avvik.join(' | ')}`, kanProvesIgjen: false }
      }
      return { ok: true, verdi: String(id) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  /**
   * Utsteder faktura fra ordren. Dette er det menneskelige steget — kalles
   * bare fra et sted der noen har trykket «Fakturer», aldri automatisk.
   * Returnerer faktura-ID.
   */
  async fakturerOrdre(ordreId: string, fakturadato: Date = new Date(), sendTilKunde = false): Promise<AdapterResultat<string>> {
    try {
      const res = await this.kall(
        `/order/${encodeURIComponent(ordreId)}/:invoice?invoiceDate=${iso(fakturadato)}&sendToCustomer=${sendTilKunde}`,
        { method: 'PUT' },
      )
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const svar = (await res.json()) as TlxSvar<TlxFaktura>
      if (!svar.value?.id) return { ok: false, feil: 'Tripletex svarte uten faktura-ID', kanProvesIgjen: true }
      return { ok: true, verdi: String(svar.value.id) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  /**
   * Registrerer betaling på en faktura (sandkasse/test og manuelle innbetalinger).
   * `betalingstypeId` = Tripletex paymentType (f.eks. bank); hentes med `betalingstyper()`.
   */
  async registrerBetaling(fakturaId: string, belopOre: number, betalingstypeId: string, dato: Date = new Date()): Promise<AdapterResultat<true>> {
    try {
      const res = await this.kall(
        `/invoice/${encodeURIComponent(fakturaId)}/:payment?paymentDate=${iso(dato)}&paymentTypeId=${encodeURIComponent(betalingstypeId)}&paidAmount=${kroner(belopOre)}`,
        { method: 'PUT' },
      )
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      return { ok: true, verdi: true }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  async betalingstyper(): Promise<AdapterResultat<{ id: string; navn: string }[]>> {
    try {
      const res = await this.kall('/invoice/paymentType?fields=id,description&count=50')
      if (!res.ok) return { ok: false, feil: await this.feilTekst(res), kanProvesIgjen: this.kanProves(res.status) }
      const v = ((await res.json()) as TlxListe<{ id: number; description?: string }>).values ?? []
      return { ok: true, verdi: v.map(x => ({ id: String(x.id), navn: x.description ?? '' })) }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  /** Faktura-ID og utestående for ordren, om den er fakturert. */
  async hentFakturaForOrdre(ordreId: string): Promise<AdapterResultat<{ fakturaId: string; utestaendeOre: number } | null>> {
    try {
      const o = await this.kall(`/order/${encodeURIComponent(ordreId)}?fields=id,orderDate`)
      if (!o.ok) return { ok: false, feil: await this.feilTekst(o), kanProvesIgjen: this.kanProves(o.status) }
      const ordre = (await o.json()) as TlxSvar<{ orderDate?: string }>
      const fra = ordre.value.orderDate ?? iso(pluss(new Date(), -365))
      const f = await this.kall(`/invoice?invoiceDateFrom=${fra}&invoiceDateTo=${iso(pluss(new Date(), 1))}&count=1000&fields=id,amountOutstanding,isCreditNote,orders(id)`)
      if (!f.ok) return { ok: false, feil: await this.feilTekst(f), kanProvesIgjen: this.kanProves(f.status) }
      const min = (((await f.json()) as TlxListe<TlxFaktura>).values ?? []).find(x => !x.isCreditNote && (x.orders ?? []).some(r => String(r.id) === String(ordreId)))
      return { ok: true, verdi: min ? { fakturaId: String(min.id), utestaendeOre: Math.round((min.amountOutstanding ?? 0) * 100) } : null }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /**
   * `eksternId` er ORDRE-ID-en fra `opprettFakturautkast`. Er ordren fakturert,
   * finnes en faktura som peker på den; da leses status derfra.
   */
  async hentFakturastatus(eksternId: string): Promise<AdapterResultat<Fakturastatus>> {
    try {
      const o = await this.kall(`/order/${encodeURIComponent(eksternId)}?fields=id,isClosed,orderDate`)
      if (o.status === 404) return { ok: true, verdi: 'ukjent' }
      if (!o.ok) return { ok: false, feil: await this.feilTekst(o), kanProvesIgjen: this.kanProves(o.status) }
      const ordre = (await o.json()) as TlxSvar<TlxOrdre & { orderDate?: string }>

      // Fakturasøket krever datointervall; ordredato og fram til i dag dekker alt.
      const fra = ordre.value.orderDate ?? iso(pluss(new Date(), -365))
      const til = iso(pluss(new Date(), 1))
      const f = await this.kall(
        `/invoice?invoiceDateFrom=${fra}&invoiceDateTo=${til}&count=1000`
        + `&fields=id,invoiceNumber,invoiceDueDate,amountOutstanding,isCredited,isCreditNote,isCharged,orders(id)`,
      )
      if (!f.ok) return { ok: false, feil: await this.feilTekst(f), kanProvesIgjen: this.kanProves(f.status) }
      const fakturaer = ((await f.json()) as TlxListe<TlxFaktura>).values ?? []
      const min = fakturaer.find(x => !x.isCreditNote && (x.orders ?? []).some(r => String(r.id) === String(eksternId)))
      if (!min) return { ok: true, verdi: 'utkast' }
      if (min.isCredited) return { ok: true, verdi: 'kreditert' }
      if ((min.amountOutstanding ?? 0) === 0) return { ok: true, verdi: 'betalt' }
      if (min.invoiceDueDate && new Date(min.invoiceDueDate) < new Date()) return { ok: true, verdi: 'forfalt' }
      return { ok: true, verdi: 'sendt' }
    } catch (e) {
      return { ok: false, feil: `Nettverksfeil mot Tripletex: ${String(e)}`, kanProvesIgjen: true }
    }
  }
}
