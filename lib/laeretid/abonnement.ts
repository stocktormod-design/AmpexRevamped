/**
 * Tilgang og finansiering — ren logikk, ingen betalingsleverandør.
 * Selvtestes i `npm run verify:laeretid`.
 *
 * **Stripe skal aldri bli det eneste stedet som vet hvem som har tilgang.**
 *
 * Én rad sier hvem som får bruke produktet. Et eget felt sier hvem som betalte.
 * Lærlingen som betaler selv med Vipps og plassen opplæringskontoret dekker på
 * faktura er den SAMME raden med ulik finansiering. Blir tilgangen utledet av
 * en Stripe-abonnementsstatus, må hele modellen skrives om den dagen TENK
 * Lofoten sier ja — og de betaler ikke med kort.
 *
 * ── Den viktigste regelen her ───────────────────────────────────────────────
 * ET UTLØPT ABONNEMENT LÅSER ALDRI DOKUMENTASJONEN HANS.
 *
 * Loggene er hans eget arbeid og hans bevis på fagprøven. At et kort går ut på
 * dato tre uker før oppmelding skal ikke kunne stenge ham ute fra dem. Han
 * mister å LAGE nytt, aldri å lese og eksportere det han har laget.
 *
 * Det er også det ryddige svaret på retten til dataportabilitet: eksporten er
 * ikke en betalt funksjon, den er hans.
 */

export type Finansiering =
  /** Lærlingen betaler selv. Kort eller Vipps. */
  | 'selv'
  /** Opplæringskontoret dekker plassen. Faktura, ikke kort. */
  | 'kontor'
  /** Lærebedriften dekker plassen. Faktura. */
  | 'bedrift'
  /** Pilot, prøveperiode eller fribruker. */
  | 'gratis'

export type Tilgangsrad = {
  laerlingId: string
  finansiering: Finansiering
  /** Referanse hos den som tar betalt. Aldri kilden til om tilgangen gjelder. */
  referanse: string | null
  gyldigFra: string
  /** ISO-dato. Null = løpende. */
  gyldigTil: string | null
  /** Inkluderte logger per måned. */
  loggerPerMaaned: number
}

/** Kjøpt én gang, ikke et abonnement. For den som ligger tre måneder bak. */
export type Etterslepspakke = {
  laerlingId: string
  kjoptDato: string
  ekstraLogger: number
}

export type Rettighet =
  /** Skrive en ny logg. */
  | 'ny-logg'
  /** Bli spurt ut og ta quiz. */
  | 'utsporing'
  /** Lese det han allerede har laget. */
  | 'lese'
  /** Hente ut PDF og kryssliste. */
  | 'eksport'
  /** Slette alt permanent. */
  | 'slette'

/**
 * Det han beholder for alltid, uansett om han betaler.
 *
 * Dette er ikke raushet, det er den eneste forsvarlige grensen: å ta et
 * menneskes egen dokumentasjon som gissel for en abonnementsavgift er ikke et
 * produkt vi skal lage.
 */
const ALLTID: Rettighet[] = ['lese', 'eksport', 'slette']

function aktiv(rad: Tilgangsrad, paaDato: string): boolean {
  if (paaDato < rad.gyldigFra) return false
  if (rad.gyldigTil !== null && paaDato > rad.gyldigTil) return false
  return true
}

export function harRettighet(
  rettighet: Rettighet, rader: Tilgangsrad[], paaDato: string,
): boolean {
  if (ALLTID.includes(rettighet)) return true
  return rader.some(r => aktiv(r, paaDato))
}

export type Kvote = {
  inkludert: number
  brukt: number
  igjen: number
  /** Etterslep kjøpt separat, som ikke nullstilles ved månedsskifte. */
  ekstra: number
}

/**
 * Hvor mange logger han har igjen denne måneden.
 *
 * Kvoten er en grense for hva abonnementet dekker, ikke en straff. Går den
 * tom, skal han få kjøpe en etterslepspakke — ikke få beskjed om at han har
 * skrevet for mye.
 */
export function kvote(
  args: {
    rader: Tilgangsrad[]
    pakker: Etterslepspakke[]
    brukteLoggerDenneMaaneden: number
    brukteEkstraTotalt: number
    paaDato: string
  },
): Kvote {
  const { rader, pakker, brukteLoggerDenneMaaneden, brukteEkstraTotalt, paaDato } = args
  const inkludert = rader
    .filter(r => aktiv(r, paaDato))
    .reduce((sum, r) => Math.max(sum, r.loggerPerMaaned), 0)
  const kjopt = pakker.reduce((sum, p) => sum + p.ekstraLogger, 0)
  const ekstra = Math.max(0, kjopt - brukteEkstraTotalt)
  const igjen = Math.max(0, inkludert - brukteLoggerDenneMaaneden) + ekstra
  return { inkludert, brukt: brukteLoggerDenneMaaneden, igjen, ekstra }
}

/**
 * Quizbudsjettet følger loggene: to per logg.
 *
 * Takten er en anbefaling, ikke en sperre. Quizene ligger alltid åpne, og det
 * som er tidsstyrt er varselet. Derfor er dette et tall for hvor mange som
 * ANBEFALES i perioden, ikke en grense noen møter.
 */
export function anbefalteQuizer(loggerPerMaaned: number): number {
  return loggerPerMaaned * 2
}

export type Avslag = { kanFortsette: false; grunn: string; tilbud: 'abonnement' | 'etterslep' }
export type Innvilget = { kanFortsette: true }

/**
 * Kan han starte en ny logg nå?
 *
 * Skiller bevisst mellom «du har ikke abonnement» og «du har brukt opp
 * månedens logger», fordi de har to helt ulike svar. Den første skal kjøpe et
 * abonnement, den andre ligger bak og skal tilbys etterslepspakken — og det er
 * den kunden som trenger oss mest.
 */
export function kanStarteNyLogg(
  rader: Tilgangsrad[], k: Kvote, paaDato: string,
): Innvilget | Avslag {
  if (!rader.some(r => aktiv(r, paaDato))) {
    return {
      kanFortsette: false,
      grunn: 'Abonnementet er ikke aktivt. Loggene dine ligger trygt og kan leses og eksporteres.',
      tilbud: 'abonnement',
    }
  }
  if (k.igjen <= 0) {
    return {
      kanFortsette: false,
      grunn: `Du har brukt ${k.brukt} av ${k.inkludert} logger denne måneden.`,
      tilbud: 'etterslep',
    }
  }
  return { kanFortsette: true }
}

/**
 * Hvor mange ganger modellen får skrive om en logg etter at den er laget.
 *
 * To, og grunnen er ikke kostnad. Kan man trykke «skriv om» i det uendelige,
 * slutter man å lese teksten og begynner å trille terning til noe ser bra ut.
 * Da eier ingen det som står der, og da er vi tilbake til logger som ikke
 * holder et eneste spørsmål — som er nøyaktig det produktet finnes for.
 *
 * To tvinger fram at man sier HVA som er galt i stedet for å be om en ny sjanse.
 */
export const AI_ENDRINGER_PER_LOGG = 2

export type Endringssvar =
  | { kan: true; igjen: number }
  | { kan: false; grunn: string }

/**
 * Får han be modellen skrive om loggen en gang til?
 *
 * MERK at dette ALDRI sperrer hans egen redigering. Han kan skrive fritt i
 * teksten uansett hvor mange omskrivinger han har brukt — det er modellens
 * runder som er begrenset, ikke hans. Å låse en lærling fast i en tekst han
 * mener er feil ville vært det samme overtrampet som å låse dokumentasjonen
 * hans bak en abonnementsavgift.
 */
export function kanBeOmEndring(brukt: number): Endringssvar {
  const igjen = Math.max(0, AI_ENDRINGER_PER_LOGG - brukt)
  if (igjen > 0) return { kan: true, igjen }
  return {
    kan: false,
    grunn: 'Du har brukt begge omskrivingene. Rett heller i teksten selv — den er din uansett.',
  }
}

// ── Verving ─────────────────────────────────────────────────────────────────

/** Ververen får 50 kr for første måned … */
export const VERVING_FORSTE_ORE = 5000
/** … og 25 kr for hver måned den vervede fortsetter å betale. */
export const VERVING_LOPENDE_ORE = 2500

/**
 * Grensa der en utbetaling til en privatperson blir rapporteringspliktig.
 *
 * Tusen kroner i året per mottaker. Under det er det ingenting å melde; over
 * det skal det innrapporteres, og fradraget forutsetter uansett at det er
 * dokumentert. Med ti verv passerer en verver dette i løpet av året, så
 * systemet varsler i stedet for å la det dukke opp i januar.
 */
export const RAPPORTERINGSGRENSE_ORE = 100_000

/**
 * Hva ververen vil ha.
 *
 * Tre valutaer, fordi folk verdsetter ulikt og det koster oss ulikt:
 *   `utbetaling` er ekte penger, og den eneste som utløser papirarbeid.
 *   `avslag` går på hans egen regning — ingen rapportering, ingen skatt for ham.
 *   `logger` er billigst for oss (marginal modellkostnad), men verdt null for
 *   den som ikke bruker opp kvoten sin.
 */
export type Vervevaluta = 'utbetaling' | 'avslag' | 'logger'

export type Verving = {
  ververId: string
  vervetId: string
  valuta: Vervevaluta
  /**
   * Datoen den vervede betalte FØRSTE gang. Null til da.
   *
   * Belønningen utløses her og ikke ved registrering. Uten det lager noen fem
   * kontoer på en kveld.
   */
  forstBetalt: string | null
  /** Antall måneder den vervede har betalt for, inkludert den første. */
  betalteMaaneder: number
}

export type Belonning = {
  valuta: Vervevaluta
  /** Øre. Alltid 0 for `logger`. */
  ore: number
  /** Antall ekstra logger. Alltid 0 for de to andre. */
  logger: number
}

/** 50 kr er to logger verdt, målt mot firepakken på 399. */
const LOGGER_FORSTE = 2
const LOGGER_LOPENDE = 1

export function belonning(v: Verving): Belonning {
  if (!v.forstBetalt || v.betalteMaaneder < 1) {
    return { valuta: v.valuta, ore: 0, logger: 0 }
  }
  const lopende = Math.max(0, v.betalteMaaneder - 1)
  if (v.valuta === 'logger') {
    return { valuta: 'logger', ore: 0, logger: LOGGER_FORSTE + lopende * LOGGER_LOPENDE }
  }
  return {
    valuta: v.valuta,
    ore: VERVING_FORSTE_ORE + lopende * VERVING_LOPENDE_ORE,
    logger: 0,
  }
}

/**
 * Avslag kan aldri gjøre abonnementet negativt.
 *
 * Ti verv gir 250 i avslag på 399, altså 149 å betale. Det er en bedre
 * historie enn en utbetaling: «verv nok, så blir din egen nesten gratis».
 * Men ingen får penger igjen av oss gjennom avslagsveien.
 */
export function avslagForMaaned(opptjentOre: number, prisOre: number): number {
  return Math.min(opptjentOre, prisOre)
}

export type Rapporteringsvarsel = {
  ververId: string
  sumOre: number
  overGrensen: boolean
}

/**
 * Hvem som nærmer seg eller har passert rapporteringsgrensa i år.
 *
 * Bare `utbetaling` teller. Avslag på egen regning er en rabatt, ikke en
 * ytelse til en privatperson, og logger er det enda mindre.
 */
export function rapporteringsvarsler(vervinger: Verving[]): Rapporteringsvarsel[] {
  const sum = new Map<string, number>()
  for (const v of vervinger) {
    if (v.valuta !== 'utbetaling') continue
    const b = belonning(v)
    sum.set(v.ververId, (sum.get(v.ververId) ?? 0) + b.ore)
  }
  return [...sum.entries()]
    .map(([ververId, sumOre]) => ({
      ververId, sumOre, overGrensen: sumOre >= RAPPORTERINGSGRENSE_ORE,
    }))
    .filter(r => r.sumOre > 0)
    .sort((a, b) => b.sumOre - a.sumOre)
}
