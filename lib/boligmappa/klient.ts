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
 * - `authorization_code` er den de peker på for Proff/Jobs. DELVIS rettet
 *   2026-09-15: `ampex://oauth` er nå registrert på `ampex-staging` og gir en
 *   ekte innloggingsside. `http://localhost:8081` (lokal utvikling) er IKKE
 *   registrert ennå — samme `Invalid parameter: redirect_uri` som før.
 * - `password` virker i dag med testbrukeren de sendte. Token varer 30 min,
 *   refresh 24 t.
 *
 * DERFOR: password-grant er sandkassevei og A/B, ikke produksjon. Den dagen
 * BEGGE redirect-URI-ene er registrert byttes `token()` til authorization
 * code — resten av fila er uendret. Passord skal ALDRI ligge i appen; i
 * produksjon logger montøren inn hos Boligmappa og vi lever på
 * refresh-tokenet.
 */

export type BoligmappaOppsett = {
  tokenUrl: string
  jobsBase: string
  /** Proff API. Eiendomsoppslag, plant og filopplasting bor her — ikke på jobs. */
  proffBase: string
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

  private kall<T>(sti: string, init?: RequestInit): Promise<BmSvar<T>> {
    return this.kallBase(this.oppsett.jobsBase, sti, init)
  }

  private async kallBase<T>(base: string, sti: string, init?: RequestInit): Promise<BmSvar<T>> {
    if (!this.token || Date.now() > this.token.utloper) {
      return { ok: false, status: 401, feil: 'ikke innlogget, eller tokenet er utløpt' }
    }
    const r = await fetch(`${base}${sti}`, {
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
   *
   * Svaret er IKKE en hel jobb, bare `{jobNumber, version}` — og det er pakket
   * i `{success, response}` slik enkeltjobben er. Pakken fjernes her; leste du
   * `jobNumber` rett av svaret før, fikk du `undefined`.
   *
   * `PROPERTY_NOT_FOUND` herfra betyr at eiendommen ikke finnes i MILJØET du
   * står i, ikke at forespørselen er feil. Se `gater`/`adresser`/`eiendommer`.
   */
  async opprettJobb(inn: {
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
  }): Promise<BmSvar<{ jobNumber: number; version?: number }>> {
    type Svar = { jobNumber: number; version?: number }
    const r = await this.kall<{ success?: boolean; response?: Svar } | Svar>('/jobs', {
      method: 'POST',
      body: JSON.stringify(inn),
    })
    if (!r.ok) return r
    const v = r.verdi
    const rå = (v && typeof v === 'object' && 'response' in v ? (v as { response: Svar }).response : v) as Svar
    return { ok: true, verdi: { ...rå, jobNumber: Number(rå.jobNumber) } }
  }

  /**
   * Kobler ALLEREDE OPPLASTEDE filer til jobben. Merk: tar fil-ID-er, ikke
   * innhold — bekreftet på nytt 2026-09-15 mot Jobs API sin egen publiserte
   * swagger (`/v1/jobs/{jobNumber}/files` har fortsatt kun `{files:int64[]}`
   * som body). Selve opplastingen skjer i en tjeneste som ikke står i noen
   * publisert spesifikasjon vi har fått lest — portalen laster rett til en
   * S3-bøtte (`staging-boligmappa-documents`) og registrerer fila etterpå.
   * Shaibal viste til en Stoplight-side («POST Create File», professional-apis)
   * som rendres med JavaScript og ikke lot seg lese automatisk; spurt om et
   * konkret curl-eksempel i stedet. Se docs/BOLIGMAPPA.md.
   */
  koblFiler(jobbNummer: number, filIder: number[]): Promise<BmSvar<unknown>> {
    return this.kall(`/jobs/${jobbNummer}/files`, { method: 'POST', body: JSON.stringify({ files: filIder }) })
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Proff API: eiendom → plant → fil
  //
  // Dette er veien filene faktisk går, og den bor på en ANNEN vert enn jobbene.
  // Mellomleddet heter «plant» — et arbeidsrom firmaet får på eiendommen — og
  // står ikke nevnt noe sted i Jobs-API-et. Uten plant finnes det ingen fil-ID
  // å koble til jobben, og `koblFiler` over har ingenting å gjøre.
  //
  // Full kjede:
  //   gater(q) → adresser(gateId) → eiendommer(adresseId) → boligmappaNumber
  //   → opprettPlant(nr) → filMetadata(nr, …) → {id, uploadLink}
  //   → lastOppInnhold(uploadLink, …) → koblFiler(jobb, [id])
  //
  // Svarene fra proff-api er ALLTID pakket i `{success, response}` — i motsetning
  // til jobblista, som kommer flat. Pakken fjernes her.
  // ═════════════════════════════════════════════════════════════════════════

  private async kallProff<T>(sti: string, init?: RequestInit): Promise<BmSvar<T>> {
    const r = await this.kallBase<{ success?: boolean; response?: T } | T>(this.oppsett.proffBase, sti, init)
    if (!r.ok) return r
    const v = r.verdi
    const utpakket = v && typeof v === 'object' && 'response' in v ? (v as { response: T }).response : (v as T)
    return { ok: true, verdi: utpakket }
  }

  /** Gater som matcher navnet. `id` er «knr-gatenr», f.eks. «301-15449». */
  gater(sok: string, side = 1, sideStorrelse = 10): Promise<BmSvar<Gate[]>> {
    const q = new URLSearchParams({ q: sok, page: String(side), pagesize: String(sideStorrelse) })
    return this.kallProff<Gate[]>(`/search/streets?${q}`)
  }

  /** Adressene i gata. `id` er gate-id + husnummer, f.eks. «301-15449-1-A». */
  adresser(gateId: string, side = 1, sideStorrelse = 20): Promise<BmSvar<Adresse[]>> {
    const q = new URLSearchParams({ page: String(side), pagesize: String(sideStorrelse) })
    return this.kallProff<Adresse[]>(`/streets/${encodeURIComponent(gateId)}/addresses?${q}`)
  }

  /**
   * Eiendommene på adressen — her ligger `boligmappaNumber`.
   *
   * Merk: denne ene bruker markørpaginering, ikke sidetall som de to over.
   */
  eiendommer(adresseId: string, grense = 20, markor?: string): Promise<BmSvar<Eiendom[]>> {
    const q = new URLSearchParams({ limit: String(grense) })
    if (markor) q.set('cursor', markor)
    return this.kallProff<Eiendom[]>(`/addresses/${encodeURIComponent(adresseId)}/properties?${q}`)
  }

  /**
   * Arbeidsrommet firmaet får på eiendommen.
   *
   * MERK: dokumentasjonen lover at den er idempotent («returns the existing
   * one»). Det stemmer ikke — finnes plantet, svarer den `409
   * PLANT_ALREADY_EXISTS`. Bruk `sikrePlant` med mindre du faktisk vil vite
   * forskjellen.
   */
  opprettPlant(boligmappaNummer: string): Promise<BmSvar<Plant>> {
    return this.kallProff<Plant>('/plants', {
      method: 'POST',
      body: JSON.stringify({ boligmappaNumber: boligmappaNummer }),
    })
  }

  /** Som `opprettPlant`, men «finnes fra før» er et greit utfall, ikke en feil. */
  async sikrePlant(boligmappaNummer: string): Promise<BmSvar<Plant | null>> {
    const r = await this.opprettPlant(boligmappaNummer)
    if (r.ok || r.kode === 'PLANT_ALREADY_EXISTS') return { ok: true, verdi: r.ok ? r.verdi : null }
    return r
  }

  /**
   * Steg 1 av 2: meld inn fila. Innholdet følger IKKE med her — svaret gir deg
   * `id` (den fil-ID-en jobben vil ha) og `uploadLink` til å legge bytesene på.
   * Fila teller ikke som lastet opp før steg 2 også er gjort.
   *
   * `uploadLink`/`downloadLink` er skrivebeskyttet og ignoreres ved POST.
   *
   * `documentType` MÅ være med. Utelates den, svarer API-et `INVALID_REQUEST`
   * uten å si hvilket felt som mangler — det kostet fire forsøk å finne. Alt
   * annet enn `fileName`/`title`/`documentType` er valgfritt (målt: uten
   * `orderNumber`, `chapterTags` og `description` går fint), og `name`/`tagName`
   * inne i objektene trengs ikke — bare `id`.
   */
  filMetadata(boligmappaNummer: string, meta: FilMetadata): Promise<BmSvar<OpprettetFil>> {
    return this.kallProff<OpprettetFil>(`/plants/${encodeURIComponent(boligmappaNummer)}/files`, {
      method: 'POST',
      body: JSON.stringify({ id: 0, uploadLink: '', downloadLink: '', ...meta }),
    })
  }

  /**
   * Steg 2 av 2: selve bytesene, PUT rett på `uploadLink`.
   *
   * Lenken er forhåndssignert og bærer sin egen autorisasjon — `Authorization`
   * skal IKKE med, den gjør at S3 avviser signaturen.
   */
  async lastOppInnhold(uploadLink: string, innhold: ArrayBuffer | Uint8Array, mime = 'application/pdf'): Promise<BmSvar<void>> {
    const r = await fetch(uploadLink, {
      method: 'PUT',
      headers: { 'content-type': mime },
      body: innhold as BodyInit,
    })
    if (!r.ok) return { ok: false, status: r.status, feil: (await r.text().catch(() => '')).slice(0, 200) || 'opplasting avvist' }
    return { ok: true, verdi: undefined }
  }

  /** Filene som ligger på eiendommens plant. Brukes til å bekrefte opplastingen. */
  plantFiler(boligmappaNummer: string): Promise<BmSvar<OpprettetFil[]>> {
    return this.kallProff<OpprettetFil[]>(`/plants/${encodeURIComponent(boligmappaNummer)}/files`)
  }
}

export type Gate = {
  id: string
  streetNumber: number
  streetName: string
  postalCode: string
  postalPlace: string
  municipalityNumber: number
  municipalityName: string
}

export type Adresse = {
  id: string
  houseNumber: number
  houseSubNumber?: string | null
  streetName: string
  postalCode: string
  postalPlace: string
}

export type Eiendom = {
  propertyType: string
  unitNumber?: string | null
  mainBuildingNumber?: number | null
  boligmappaNumber: string
  address?: Adresse | null
}

export type Plant = {
  boligmappaNumber: string
  plantId: number
  createdDate?: string
  type?: string
}

export type FilMetadata = {
  fileName: string
  title: string
  /** PÅKREVD. Utelatt gir `INVALID_REQUEST`. 0 = Udefinert. */
  documentType: { id: number }
  description?: string
  orderNumber?: string
  isVisibleInBoligmappa?: boolean
  /** Kapittel i mappa. 4 = «Samsvarserklæringer og garantibevis». */
  chapterTags?: { id: number }[]
  /** 1 = Elektriker. */
  professionType?: { id: number }
  rooms?: { id: number }[]
}

export type OpprettetFil = {
  id: number
  fileName: string
  title?: string
  uploadLink?: string | null
  downloadLink?: string | null
}
