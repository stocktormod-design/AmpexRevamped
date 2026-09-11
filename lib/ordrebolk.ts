/**
 * Hvilken bunke ligger ordren i?
 *
 * Ren logikk, ingen database. Selvtestes i `npm run verify:ordrebolk`.
 *
 * Databasen har fem statuser (`mottatt`, `planlagt`, `pagaar`, `fakturaklar`,
 * `fakturert`), men kontoret jobber i tre bunker, og det er bunkene som avgjør
 * hvem som gjør hva:
 *
 *   ÅPEN               jobben er ikke ferdig. Feltets ansvar.
 *   TIL GODKJENNING    montøren er ferdig. Faglig ansvarlig skal se på den.
 *   FAKTURERT          ute av huset.
 *
 * De fem statusene forsvinner ikke — de står fortsatt på hver rad. Men å sortere
 * på fem når man tenker i tre er å be folk gjøre oversettelsen selv hver gang.
 *
 * ── Den viktige forskjellen inne i bunke to ────────────────────────────────
 *
 * En ordre som er `fakturaklar` er IKKE klar til å faktureres før faglig
 * ansvarlig har godkjent den. Databasen håndhever det (`krev_faglig_godkjenning`
 * blokkerer), så en ordre som ser ferdig ut, men mangler godkjenning, er en
 * ordre som stopper når noen prøver å sende fakturaen.
 *
 * Derfor bærer bunken et eget flagg for godkjent, og lista sorterer de
 * ugodkjente først: det er DE som venter på et menneske.
 */

export type Ordrestatus = 'mottatt' | 'planlagt' | 'pagaar' | 'fakturaklar' | 'fakturert'

export type Bolk = 'apen' | 'godkjenning' | 'fakturert'

export const BOLKNAVN: Record<Bolk, string> = {
  apen: 'Åpne',
  godkjenning: 'Til godkjenning',
  fakturert: 'Fakturert',
}

/** Rekkefølgen kontoret leser i: det som venter først, det avsluttede sist. */
export const BOLKREKKEFOLGE: Bolk[] = ['godkjenning', 'apen', 'fakturert']

export function bolkFor(status: string): Bolk {
  if (status === 'fakturert') return 'fakturert'
  if (status === 'fakturaklar') return 'godkjenning'
  // Ukjent status havner blant de åpne med vilje. En ordre som forsvinner fra
  // alle bunkene fordi noen la til en status er verre enn en som ligger feil.
  return 'apen'
}

export type Sorterbar = {
  bolk: Bolk
  /** Faglig godkjent? Bare meningsfullt i bunken «Til godkjenning». */
  godkjent: boolean
  /** Ordrenummer. Høyest er nyest. */
  nummer: number | null
}

/**
 * Sorterer innad i en bunke.
 *
 * I «Til godkjenning» kommer de UGODKJENTE først — de venter på et menneske.
 * Ellers nyeste ordrenummer først. Ordrer uten nummer havner sist; de har ikke
 * vært gjennom nummertildelingen ennå og er derfor ikke noe kontoret jobber med.
 */
export function sammenlign(a: Sorterbar, b: Sorterbar): number {
  if (a.bolk === 'godkjenning' && b.bolk === 'godkjenning' && a.godkjent !== b.godkjent) {
    return a.godkjent ? 1 : -1
  }
  if (a.nummer == null && b.nummer == null) return 0
  if (a.nummer == null) return 1
  if (b.nummer == null) return -1
  return b.nummer - a.nummer
}

/** Grupperer i bunker, i lesrekkefølgen, og sorterer innad. Tomme bunker droppes. */
export function grupper<T extends Sorterbar>(rader: T[]): { bolk: Bolk; navn: string; rader: T[] }[] {
  return BOLKREKKEFOLGE
    .map(b => ({
      bolk: b,
      navn: BOLKNAVN[b],
      rader: rader.filter(r => r.bolk === b).sort(sammenlign),
    }))
    .filter(g => g.rader.length > 0)
}
