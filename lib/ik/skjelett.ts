/**
 * Startskjelettet for et internkontrollsystem i en elvirksomhet.
 * Ren data, ingen database. Selvtestes i `npm run verify:ik-skjelett`.
 *
 * **Dette er et utgangspunkt, ikke en fasit.** Ampex kjenner ikke firmaets
 * arbeid, og et IK-system som er skrevet av noen andre er nettopp den døde
 * permen forskriften er ment å hindre. Skjelettet gir punktene og hjemmelen;
 * formålet og rutinen må firmaet skrive selv.
 *
 * **Skjelettet har ingen ferdigskrevne formål** (17. september). Det hadde det
 * før, og et punkt som åpnet med en setning Ampex hadde skrevet så ferdig ut —
 * så det ble stående, og da eide ingen i firmaet det. Nå er feltet tomt, og
 * flata ber deg opprette det. `hint` står igjen som hjelpetekst ved siden av
 * skrivefeltet; den lagres aldri som innhold.
 *
 * ── Hva som MÅ være skriftlig ────────────────────────────────────────────
 *
 * Internkontrollforskriften § 5 andre ledd har åtte punkter. Tredje ledd sier
 * at den skriftlige dokumentasjonen minst skal omfatte **nr. 4 til nr. 8**.
 * De fem er merket `maaVaereSkriftlig`, og det er dem som teller når kontoret
 * skal vite om systemet er komplett.
 *
 * Nr. 1–3 er like bindende, men trenger ikke stå på papir. De er med likevel,
 * fordi et system der de mangler helt er et system ingen har tenkt gjennom.
 *
 * ── Hjemmelshenvisningene ────────────────────────────────────────────────
 *
 * Henvisningene til internkontrollforskriften § 5 er presise. De el-faglige
 * punktene har bare navnet på forskriften og INGEN paragraf, med vilje: en feil
 * paragrafhenvisning i et IK-system er verre enn ingen, og faglig ansvarlig er
 * den som skal slå den opp i gjeldende forskrift. Feltet er fritekst nettopp
 * derfor.
 */

export type IkGruppe = 'hms' | 'elfag' | 'dokumentasjon'

export type IkSkjelettpunkt = {
  nummer: string
  tittel: string
  gruppe: IkGruppe
  /** Tom streng når vi ikke er sikre nok til å oppgi paragraf. */
  hjemmel: string
  /** Hjelpetekst til den som skal skrive rutinen. Lagres ikke som innhold. */
  hint: string
  /**
   * Forslag til punkter under kapittelet — bare TITLER, aldri tekst. Ett
   * trykk oppretter punktet; rutinene skriver firmaet selv. Dette er
   * mellomveien mellom NIKs ferdigskrevne perm (som ingen eier) og et tomt
   * kapittel (som ingen kommer i gang med).
   */
  forslag: string[]
  /** Krever forskriften at dette står skriftlig? */
  maaVaereSkriftlig: boolean
  /** Måneder mellom hver gjennomgang. */
  intervallMnd: number
}

export const IK_GRUPPENAVN: Record<IkGruppe, string> = {
  hms: 'Helse, miljø og sikkerhet',
  elfag: 'Elektrofaglig',
  dokumentasjon: 'Dokumentasjon og oppbevaring',
}

export const IK_SKJELETT: IkSkjelettpunkt[] = [
  // ── Det som må være skriftlig: § 5 andre ledd nr. 4–8 ───────────────────
  {
    nummer: '1',
    tittel: 'Mål for helse, miljø og sikkerhet',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 4',
    hint: 'Skriv få og konkrete mål. «Ingen strømgjennomgang» er et mål. «Vi tar HMS på alvor» er ikke.',
    forslag: ['Mål for skader og ulykker', 'Mål for sykefravær', 'Mål for elsikkerhet i utført arbeid', 'Mål for ytre miljø'],
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },
  {
    nummer: '2',
    tittel: 'Organisasjon, ansvar og myndighet',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 5',
    hint: 'Navngi daglig leder, faglig ansvarlig og verneombud. Si hva hver av dem faktisk bestemmer over.',
    forslag: ['Daglig leder', 'Faglig ansvarlig', 'Verneombud', 'Stedfortreder for faglig ansvarlig', 'Ansvar på byggeplass'],
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },
  {
    nummer: '3',
    tittel: 'Kartlegging av farer og risikovurdering',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 6',
    hint: 'Ta utgangspunkt i arbeidet dere faktisk gjør: AUS, arbeid i høyden, trange rom, asbest i eldre bygg. Knytt risikovurderingsskjemaet til dette punktet.',
    forslag: ['Arbeid i tavle', 'Arbeid under spenning (AUS)', 'Arbeid i høyden', 'Arbeid i trange rom', 'Graving og kabel i grunn', 'Asbest og eldre bygg', 'Alenearbeid', 'Kjøring og transport'],
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },
  {
    nummer: '4',
    tittel: 'Avvik: avdekke, rette opp og forebygge',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 7',
    hint: 'Beskriv hvordan et avvik meldes, hvem som behandler det, og hvordan man vet at det er lukket. Dette punktet er selve motoren i et levende IK-system.',
    forslag: ['Melde avvik', 'Behandle og lukke avvik', 'Nestenulykker og strømgjennomgang', 'Feil funnet av DLE', 'Kundeklager'],
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },
  {
    nummer: '5',
    tittel: 'Systematisk gjennomgang av internkontrollen',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 8',
    hint: 'Sett en fast dato i året. Skriv hvem som deltar og hva som skal vurderes. Gjennomgangsdatoen på hvert punkt her i Ampex er verktøyet, ikke rutinen.',
    forslag: ['Årlig gjennomgang', 'Vernerunde', 'Oppfølging av tiltak'],
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },

  // ── Bindende, men ikke krav om skriftlighet: nr. 1–3 ────────────────────
  {
    nummer: '6',
    tittel: 'Oversikt over lover og forskrifter',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 1',
    hint: 'List forskriftene dere faktisk bruker og hvor de finnes. Lovdata-lenker er nok.',
    forslag: ['Internkontrollforskriften', 'FEL og NEK 400', 'FSE', 'FEK', 'Arbeidsmiljøloven', 'Byggherreforskriften'],
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '7',
    tittel: 'Kompetanse og opplæring',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 2',
    hint: 'Beskriv hvordan nyansatte og lærlinger settes inn i rutinene, og hvordan repetisjon av førstehjelp og AUS holdes ved like.',
    forslag: ['Nyansatte og innleide', 'Lærlinger', 'FSE årlig repetisjon', 'Førstehjelp', 'Kurs og sertifikater', 'Instruert personell'],
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '8',
    tittel: 'Arbeidstakernes medvirkning',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 3',
    hint: 'Beskriv hvor medvirkningen skjer: vernerunder, personalmøter, innspill på avvik.',
    forslag: ['Vernerunder', 'Personalmøter', 'Innspill på avvik og rutiner'],
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },

  // ── Elektrofaglig. Hjemmel må fylles inn av faglig ansvarlig ────────────
  {
    nummer: '9',
    tittel: 'Faglig ansvarlig og kvalifikasjoner',
    gruppe: 'elfag',
    hjemmel: '',
    hint: 'Se forskrift om elektroforetak og kvalifikasjonskrav (FEK). Skriv hvem som er faglig ansvarlig, hva registreringen i Elvirksomhetsregisteret dekker, og hvordan stedfortreder er ordnet. Slå opp paragrafen i gjeldende forskrift.',
    forslag: ['Faglig ansvarlig', 'Registrering i Elvirksomhetsregisteret', 'Stedfortreder', 'Kvalifikasjoner per virkeområde'],
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '10',
    tittel: 'Sluttkontroll før anlegget tas i bruk',
    gruppe: 'elfag',
    hjemmel: '',
    hint: 'Beskriv hva som måles, hvem som utfører kontrollen og hva som skjer ved funn. Knytt sluttkontrollskjemaet til dette punktet.',
    forslag: ['Målinger ved sluttkontroll', 'Hvem utfører sluttkontroll', 'Funn ved sluttkontroll', 'Sluttkontroll ved endring i eksisterende anlegg'],
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '11',
    tittel: 'Erklæring om samsvar',
    gruppe: 'elfag',
    hjemmel: '',
    hint: 'Beskriv når erklæringen utstedes, hvem som signerer den, og hvordan den kommer fram til eier. Knytt samsvarserklæringen til dette punktet.',
    forslag: ['Når erklæringen utstedes', 'Hvem signerer', 'Overlevering til eier'],
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '12',
    tittel: 'Dokumentasjon som overleveres eier',
    gruppe: 'elfag',
    hjemmel: '',
    hint: 'List hva pakken inneholder: kursfortegnelse, samsvarserklæring, sluttkontroll, utstyrsdokumentasjon. Ampex bygger denne pakken automatisk fra ordren.',
    forslag: ['Innhold i dokumentasjonspakken', 'Kursfortegnelse', 'Utstyrsdokumentasjon', 'Boligmappa og digital overlevering'],
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '13',
    tittel: 'Måleinstrumenter og verktøy',
    gruppe: 'elfag',
    hjemmel: '',
    hint: 'Skriv hvilke instrumenter firmaet har, hvor ofte de kalibreres, og hvem som følger opp. Et måleinstrument uten gyldig kalibrering gjør sluttkontrollen verdiløs.',
    forslag: ['Liste over instrumenter', 'Kalibrering', 'Kontroll av verneutstyr', 'Stiger og fallsikring'],
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },

  // ── Oppbevaring ────────────────────────────────────────────────────────
  {
    nummer: '14',
    tittel: 'Oppbevaring av dokumentasjon',
    gruppe: 'dokumentasjon',
    hjemmel: '',
    hint: 'Skriv hvor lenge dere oppbevarer, og hvor. Oppbevaringstiden firmaet har satt i Ampex står under Firma, og arkivpakken bygges per ordre.',
    forslag: ['Oppbevaringstid', 'Hvor dokumentasjonen ligger', 'Sletting etter frist'],
    maaVaereSkriftlig: false,
    intervallMnd: 24,
  },
]

/** Er punktet forfalt til gjennomgang? */
export function erForfalt(
  sistGjennomgatt: string | null | undefined,
  intervallMnd: number,
  naa: Date,
): boolean {
  // Aldri gjennomgått teller ikke som forfalt: et punkt som nettopp ble skrevet
  // har ingen frist å bryte ennå. «Aldri gjennomgått» er sin egen tilstand, og
  // vises som det.
  if (!sistGjennomgatt) return false
  const frist = new Date(sistGjennomgatt)
  frist.setMonth(frist.getMonth() + intervallMnd)
  return frist.getTime() < naa.getTime()
}

/** Datoen punktet neste gang må ses på. null når det aldri er gjennomgått. */
export function nesteGjennomgang(
  sistGjennomgatt: string | null | undefined,
  intervallMnd: number,
): Date | null {
  if (!sistGjennomgatt) return null
  const d = new Date(sistGjennomgatt)
  d.setMonth(d.getMonth() + intervallMnd)
  return d
}

export type Fullstendighet = {
  /** Punkter forskriften krever skriftlig. */
  kreves: number
  /** Av dem: hvor mange er vedtatt med innhold. */
  pa_plass: number
  manglerInnhold: string[]
  ikkeVedtatt: string[]
}

/**
 * Hvor komplett er systemet, målt mot det forskriften krever skriftlig?
 *
 * Teller BARE punktene som må være skriftlige. Et firma som har skrevet
 * fjorten fine kapitler, men mangler avvikshåndteringen, har ikke et
 * internkontrollsystem — og en prosentandel som sier 93 % ville skjult det.
 */
export function fullstendighet(
  /**
   * `harRutine` og ikke en tekst: et punkt er et KAPITTEL, og under det kan det
   * ligge flere rutiner (se migrasjonen 20260823150000). Spørsmålet er om
   * kapittelet er skrevet i det hele tatt — ikke hvilken av rutinene som er
   * lengst. Kalleren avgjør hva som teller som skrevet, og det er riktig sted:
   * den vet om den ser på punktets egen tekst eller på rutinene under det.
   */
  punkter: { nummer: string; harRutine: boolean; status: string; maaVaereSkriftlig: boolean }[],
): Fullstendighet {
  const kreves = punkter.filter(p => p.maaVaereSkriftlig)
  const manglerInnhold = kreves.filter(p => !p.harRutine).map(p => p.nummer)
  const ikkeVedtatt = kreves
    .filter(p => p.harRutine && p.status !== 'vedtatt')
    .map(p => p.nummer)
  return {
    kreves: kreves.length,
    pa_plass: kreves.filter(p => p.harRutine && p.status === 'vedtatt').length,
    manglerInnhold,
    ikkeVedtatt,
  }
}

/** Er nummeret ett av dem forskriften krever skriftlig? */
export function maaVaereSkriftlig(nummer: string): boolean {
  return IK_SKJELETT.find(p => p.nummer === nummer)?.maaVaereSkriftlig ?? false
}
