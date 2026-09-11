/**
 * Boligmappa — dokumentasjon rett inn i eiendommens mappe.
 *
 * Verifisert mot sandkassen 2026-09-11. Det som er PRØVD og virker står med
 * tall; det som ikke er prøvd står som åpent. Ingenting her er gjettet.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Tre tjenester, tre verter — og det var den dyre oppdagelsen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jobs API   `staging-jobs.boligmappa.no/api/v1`      jobber og filkobling
 * Proff API  `staging-proff-api.boligmappa.no/v1`     eiendom, prosjekt, kunde
 * Auth       `testauth.boligmappa.no/auth/realms/…`   Keycloak
 *
 * Alt jeg først prøvde gikk mot proff-api og fikk 403 «Missing Authentication
 * Token». Det er AWS API Gateway sitt språk for RUTEN FINNES IKKE, ikke for
 * manglende token — og jeg leste det som et autentiseringsproblem i en time.
 * Jobs-endepunktene ligger på en annen vert. Får du 403 med den meldingen:
 * sjekk verten før du sjekker tokenet.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Innlogging: password grant i sandkassen, authorization code i produksjon
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Boligmappa støtter tre OAuth-flyter, og valget er ikke fritt:
 *
 * - `client_credentials` er SPERRET til Onboarding-API-et. Keycloak svarer
 *   «Client not enabled to retrieve service account». Det er ikke en glipp,
 *   det står i dokumentasjonen.
 * - `authorization_code` er den de peker på for Proff/Jobs — men klienten vår
 *   har ingen redirect-URI registrert ennå, så flyten kan ikke starte:
 *   `Invalid parameter: redirect_uri` på hver eneste adresse vi prøvde.
 * - `password` virker i dag med testbrukeren de sendte. Token varer 30 min,
 *   refresh 24 t.
 *
 * DERFOR: password-grant er sandkassevei og A/B, ikke produksjon. Den dagen
 * redirecten er registrert byttes `token()` til authorization code — resten av
 * fila er uendret. Passord skal ALDRI ligge i appen; i produksjon logger
 * montøren inn hos Boligmappa og vi lever på refresh-tokenet.
 */

export type BoligmappaOppsett = {
  tokenUrl: string
  jobsBase: string
  klientId: string
  klientHemmelighet: string
}

export type Jobb = {
  jobNumber: number
  boligmappaNumber: string
  propertyAddress?: string | null
  propertyOwnerName?: string | null
  organizationNumber?: string | null
  organizationName?: string | null
  title?: string | null
  description?: string | null
  jobDate?: string | null
  status?: string | null
}

export type Side<T> = { pageNumber: number; pageSize: number; totalPages: number; totalRecords: number; jobs: T[] }

/** Feil fra Boligmappa er alltid `{success:false, code, message:{en,no}}`. */
export type BmFeil = { ok: false; feil: string; kode?: string; status: number }
export type BmOk<T> = { ok: true; verdi: T }
export type BmSvar<T> = BmOk<T> | BmFeil

export class BoligmappaKlient {
  private token: { verdi: string; utloper: number } | null = null

  constructor(private oppsett: BoligmappaOppsett) {}

  /**
   * SANDKASSE: bytter brukernavn/passord mot et token. Tokenet caches til 60 s
   * før utløp — Keycloak gir 1800 s, og å hente nytt per kall er både tregt og
   * støy i loggene deres.
   */
  async loggInn(brukernavn: string, passord: string): Promise<BmSvar<void>> {
    const kropp = new URLSearchParams({
      grant_type: 'password',
      client_id: this.oppsett.klientId,
      client_secret: this.oppsett.klientHemmelighet,
      username: brukernavn,
      password: passord,
      scope: 'openid',
    })
    const r = await fetch(this.oppsett.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: kropp.toString(),
    })
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
    if (!r.ok || typeof j.access_token !== 'string') {
      return { ok: false, status: r.status, feil: String(j.error_description ?? j.error ?? 'ukjent innloggingsfeil') }
    }
    const levetid = typeof j.expires_in === 'number' ? j.expires_in : 1800
    this.token = { verdi: j.access_token, utloper: Date.now() + (levetid - 60) * 1000 }
    return { ok: true, verdi: undefined }
  }

  private async kall<T>(sti: string, init?: RequestInit): Promise<BmSvar<T>> {
    if (!this.token || Date.now() > this.token.utloper) {
      return { ok: false, status: 401, feil: 'ikke innlogget, eller tokenet er utløpt' }
    }
    const r = await fetch(`${this.oppsett.jobsBase}${sti}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token.verdi}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    const tekst = await r.text()
    if (!r.ok) {
      // Deres egne feil er JSON med tospråklig melding; gatewayens er flat tekst.
      try {
        const j = JSON.parse(tekst) as { code?: string; message?: { no?: string; en?: string } | string }
        const m = typeof j.message === 'string' ? j.message : (j.message?.no ?? j.message?.en)
        return { ok: false, status: r.status, kode: j.code, feil: m ?? tekst.slice(0, 200) }
      } catch {
        return { ok: false, status: r.status, feil: tekst.slice(0, 200) }
      }
    }
    return { ok: true, verdi: (tekst ? JSON.parse(tekst) : null) as T }
  }

  /** Jobber firmaet har lagt inn. Sidevis — 12 rader i sandkassen 2026-09-11. */
  async jobber(side = 1, sideStorrelse = 10): Promise<BmSvar<Side<Jobb>>> {
    const r = await this.kall<Side<Jobb>>(`/jobs?pageNumber=${side}&pageSize=${sideStorrelse}`)
    if (!r.ok) return r
    return { ok: true, verdi: { ...r.verdi, jobs: r.verdi.jobs.map(j => ({ ...j, jobNumber: Number(j.jobNumber) })) } }
  }

  /**
   * Én jobb med alle felter.
   *
   * TO FELLER, begge målt 2026-09-11 og begge verdt å vite:
   *
   * 1. Enkeltjobben er pakket i `{success, response}`. LISTA er ikke pakket —
   *    den kommer flat som `{pageNumber, jobs:[…]}`. Samme API, to konvolutter.
   * 2. `jobNumber` er STRENG her («2443925») og TALL i lista (2443925).
   *    Sammenligner du med === over de to, får du alltid usant.
   *
   * Begge normaliseres her, så resten av appen slipper å vite det.
   */
  async jobb(jobbNummer: number): Promise<BmSvar<Jobb>> {
    const r = await this.kall<{ success?: boolean; response?: Jobb } | Jobb>(`/jobs/${jobbNummer}`)
    if (!r.ok) return r
    const rå = (r.verdi && typeof r.verdi === 'object' && 'response' in r.verdi
      ? (r.verdi as { response: Jobb }).response
      : r.verdi) as Jobb
    return { ok: true, verdi: { ...rå, jobNumber: Number(rå.jobNumber) } }
  }

  /**
   * Oppretter jobben på eiendommen. `boligmappaNumber` bestemmer HVILKEN
   * eiendom — det er nøkkelen, ikke adressen. Adressematching mot matrikkelen
   * er derfor ikke vårt problem så lenge vi har nummeret.
   */
  opprettJobb(inn: {
    boligmappaNumber: string
    organizationNumber: number
    title: string
    initialDescription: string
    description?: string
    jobDate?: string
    status?: string
    origin?: string
    professionTypes?: number[]
    files?: number[]
  }): Promise<BmSvar<Jobb>> {
    return this.kall('/jobs', { method: 'POST', body: JSON.stringify(inn) })
  }

  /**
   * Kobler ALLEREDE OPPLASTEDE filer til jobben. Merk: tar fil-ID-er, ikke
   * innhold. Selve opplastingen skjer i en tjeneste som ikke står i noen
   * publisert spesifikasjon — portalen laster rett til en S3-bøtte
   * (`staging-boligmappa-documents`) og registrerer fila etterpå. Det er det
   * ENE spørsmålet som står igjen til Boligmappa, og det er stilt.
   */
  koblFiler(jobbNummer: number, filIder: number[]): Promise<BmSvar<unknown>> {
    return this.kall(`/jobs/${jobbNummer}/files`, { method: 'POST', body: JSON.stringify({ files: filIder }) })
  }
}
