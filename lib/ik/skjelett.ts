/**
 * Startskjelettet for et internkontrollsystem i en elvirksomhet.
 * Ren data, ingen database. Selvtestes i `npm run verify:ik-skjelett`.
 *
 * **Dette er et utgangspunkt, ikke en fasit.** Ampex kjenner ikke firmaets
 * arbeid, og et IK-system som er skrevet av noen andre er nettopp den døde
 * permen forskriften er ment å hindre. Skjelettet gir punktene og formålet;
 * rutinen må firmaet skrive selv.
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
  /** Hva punktet skal sikre. Endres sjelden. */
  formal: string
  /** Hjelpetekst til den som skal skrive rutinen. Lagres ikke som innhold. */
  hint: string
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
    formal: 'Firmaet skal ha uttalte mål for HMS-arbeidet, så det er noe å måle mot.',
    hint: 'Skriv få og konkrete mål. «Ingen strømgjennomgang» er et mål. «Vi tar HMS på alvor» er ikke.',
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },
  {
    nummer: '2',
    tittel: 'Organisasjon, ansvar og myndighet',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 5',
    formal: 'Hvem som har ansvar for hva skal være avklart før noe går galt, ikke etterpå.',
    hint: 'Navngi daglig leder, faglig ansvarlig og verneombud. Si hva hver av dem faktisk bestemmer over.',
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },
  {
    nummer: '3',
    tittel: 'Kartlegging av farer og risikovurdering',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 6',
    formal: 'Farene i arbeidet skal kartlegges, risikoen vurderes, og tiltak planlegges.',
    hint: 'Ta utgangspunkt i arbeidet dere faktisk gjør: AUS, arbeid i høyden, trange rom, asbest i eldre bygg. Knytt risikovurderingsskjemaet til dette punktet.',
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },
  {
    nummer: '4',
    tittel: 'Avvik: avdekke, rette opp og forebygge',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 7',
    formal: 'Det skal finnes en rutine for hva som skjer når noe går galt eller nesten går galt.',
    hint: 'Beskriv hvordan et avvik meldes, hvem som behandler det, og hvordan man vet at det er lukket. Dette punktet er selve motoren i et levende IK-system.',
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },
  {
    nummer: '5',
    tittel: 'Systematisk gjennomgang av internkontrollen',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 8',
    formal: 'Systemet skal gjennomgås jevnlig for å se om det virker som forutsatt.',
    hint: 'Sett en fast dato i året. Skriv hvem som deltar og hva som skal vurderes. Gjennomgangsdatoen på hvert punkt her i Ampex er verktøyet, ikke rutinen.',
    maaVaereSkriftlig: true,
    intervallMnd: 12,
  },

  // ── Bindende, men ikke krav om skriftlighet: nr. 1–3 ────────────────────
  {
    nummer: '6',
    tittel: 'Oversikt over lover og forskrifter',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 1',
    formal: 'Regelverket som gjelder arbeidet skal være tilgjengelig, og de viktigste kravene kjent.',
    hint: 'List forskriftene dere faktisk bruker og hvor de finnes. Lovdata-lenker er nok.',
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '7',
    tittel: 'Kompetanse og opplæring',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 2',
    formal: 'De ansatte skal ha kunnskapen som trengs, og få vite om endringer.',
    hint: 'Beskriv hvordan nyansatte og lærlinger settes inn i rutinene, og hvordan repetisjon av førstehjelp og AUS holdes ved like.',
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '8',
    tittel: 'Arbeidstakernes medvirkning',
    gruppe: 'hms',
    hjemmel: 'Internkontrollforskriften § 5 andre ledd nr. 3',
    formal: 'De som gjør jobben skal være med på å utforme rutinene de skal følge.',
    hint: 'Beskriv hvor medvirkningen skjer: vernerunder, personalmøter, innspill på avvik.',
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },

  // ── Elektrofaglig. Hjemmel må fylles inn av faglig ansvarlig ────────────
  {
    nummer: '9',
    tittel: 'Faglig ansvarlig og kvalifikasjoner',
    gruppe: 'elfag',
    hjemmel: '',
    formal: 'Virksomheten skal være registrert og ha en faglig ansvarlig med rett kompetanse.',
    hint: 'Se forskrift om elektroforetak og kvalifikasjonskrav (FEK). Skriv hvem som er faglig ansvarlig, hva registreringen i Elvirksomhetsregisteret dekker, og hvordan stedfortreder er ordnet. Slå opp paragrafen i gjeldende forskrift.',
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '10',
    tittel: 'Sluttkontroll før anlegget tas i bruk',
    gruppe: 'elfag',
    hjemmel: '',
    formal: 'Hvert anlegg skal kontrolleres før det settes i drift, og kontrollen skal kunne vises fram.',
    hint: 'Beskriv hva som måles, hvem som utfører kontrollen og hva som skjer ved funn. Knytt sluttkontrollskjemaet til dette punktet.',
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '11',
    tittel: 'Erklæring om samsvar',
    gruppe: 'elfag',
    hjemmel: '',
    formal: 'Kunden skal få en erklæring om at anlegget er i samsvar med kravene.',
    hint: 'Beskriv når erklæringen utstedes, hvem som signerer den, og hvordan den kommer fram til eier. Knytt samsvarserklæringen til dette punktet.',
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '12',
    tittel: 'Dokumentasjon som overleveres eier',
    gruppe: 'elfag',
    hjemmel: '',
    formal: 'Eier skal få den dokumentasjonen som trengs for å bruke og vedlikeholde anlegget.',
    hint: 'List hva pakken inneholder: kursfortegnelse, samsvarserklæring, sluttkontroll, utstyrsdokumentasjon. Ampex bygger denne pakken automatisk fra ordren.',
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },
  {
    nummer: '13',
    tittel: 'Måleinstrumenter og verktøy',
    gruppe: 'elfag',
    hjemmel: '',
    formal: 'Instrumentene som brukes til kontroll skal være i orden og kontrollert.',
    hint: 'Skriv hvilke instrumenter firmaet har, hvor ofte de kalibreres, og hvem som følger opp. Et måleinstrument uten gyldig kalibrering gjør sluttkontrollen verdiløs.',
    maaVaereSkriftlig: false,
    intervallMnd: 12,
  },

  // ── Oppbevaring ────────────────────────────────────────────────────────
  {
    nummer: '14',
    tittel: 'Oppbevaring av dokumentasjon',
    gruppe: 'dokumentasjon',
    hjemmel: '',
    formal: 'Dokumentasjonen skal finnes igjen så lenge oppbevaringsplikten varer.',
    hint: 'Skriv hvor lenge dere oppbevarer, og hvor. Oppbevaringstiden firmaet har satt i Ampex står under Firma, og arkivpakken bygges per ordre.',
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
  punkter: { nummer: string; innhold: string | null; status: string; maaVaereSkriftlig: boolean }[],
): Fullstendighet {
  const kreves = punkter.filter(p => p.maaVaereSkriftlig)
  const manglerInnhold = kreves.filter(p => !p.innhold?.trim()).map(p => p.nummer)
  const ikkeVedtatt = kreves
    .filter(p => p.innhold?.trim() && p.status !== 'vedtatt')
    .map(p => p.nummer)
  return {
    kreves: kreves.length,
    pa_plass: kreves.filter(p => p.innhold?.trim() && p.status === 'vedtatt').length,
    manglerInnhold,
    ikkeVedtatt,
  }
}

/** Er nummeret ett av dem forskriften krever skriftlig? */
export function maaVaereSkriftlig(nummer: string): boolean {
  return IK_SKJELETT.find(p => p.nummer === nummer)?.maaVaereSkriftlig ?? false
}
