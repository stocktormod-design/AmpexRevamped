import { database } from './db'
import { kvarter } from './order-clock-calc'

export { kvarter, timerTekst } from './order-clock-calc'

/**
 * ── Klokka som går av seg selv ─────────────────────────────────────────────
 *
 * Timeføring er den kjedeligste daglige oppgaven en montør har, og den eneste
 * som direkte avgjør hva firmaet får betalt. Jobber løser det med «Start Timer»
 * og «Complete Visit»: tiden registreres uten at noen taster noe.
 *
 * Vi har allerede knappene — «Start jobben» og «Meld ferdig». De klammet bare
 * ikke klokka. Nå gjør de det.
 *
 * TRE VALG SOM ER VIKTIGE:
 *
 * 1. Tiden LAGRES ALDRI av seg selv. Den foreslås. Mellom «start» og «ferdig»
 *    ligger kjøring, pauser og en telefonsamtale fra en annen kunde — et tall
 *    som havner rett på fakturaen uten at noen så det, er verre enn ingen tall.
 *    Montøren bekrefter, og kan justere.
 *
 * 2. Starten ligger LOKALT, ikke på ordren. Det er DIN klokke: er dere tre på
 *    jobben, har dere tre forskjellige starttidspunkt, og en `started_at` på
 *    ordreraden ville sagt at den siste som trykket startet for alle.
 *
 * 3. Ingen bakgrunnstimer, ingen polling (regel 8). Vi lagrer ett tidsstempel
 *    og regner ut differansen når du melder ferdig. Klokka «går» ikke — den
 *    huskes.
 */

const NOKKEL = 'ordre_klokke_v1'

type Klokker = Record<string, number>

async function les(): Promise<Klokker> {
  const lagret = await database.localStorage.get(NOKKEL).catch(() => undefined)
  return (lagret as Klokker | undefined) ?? {}
}

async function skriv(k: Klokker) {
  await database.localStorage.set(NOKKEL, k).catch(() => {})
}

/** Kalles når ordren settes til «pågår». Overskriver ikke en klokke som alt går. */
export async function startKlokke(orderId: string, naa = Date.now()): Promise<void> {
  const k = await les()
  if (k[orderId]) return
  await skriv({ ...k, [orderId]: naa })
}

/**
 * Stopper klokka og returnerer antall timer, avrundet til nærmeste kvarter.
 *
 * Kvarter fordi det er slik timer faktisk føres i dette faget — ingen skriver
 * «2,37 t». Runder OPP fra ti minutter: har du vært der i tolv minutter, har du
 * vært der et kvarter.
 *
 * Null hvis det ikke gikk noen klokke, eller hvis det er gått under fem
 * minutter (da var det en feiltrykk, ikke en jobb).
 */
export async function stoppKlokke(orderId: string, naa = Date.now()): Promise<number | null> {
  const k = await les()
  const start = k[orderId]
  if (!start) return null
  const { [orderId]: _, ...resten } = k
  await skriv(resten)

  const minutter = (naa - start) / 60_000
  if (minutter < 5) return null
  return kvarter(minutter)
}


/** Går det en klokke på denne ordren? Til å vise «pågår siden …». */
export async function klokkeStartet(orderId: string): Promise<number | null> {
  const k = await les()
  return k[orderId] ?? null
}

/** Ordren ble avbrutt eller satt tilbake — glem klokka uten å foreslå noe. */
export async function glemKlokke(orderId: string): Promise<void> {
  const k = await les()
  if (!k[orderId]) return
  const { [orderId]: _, ...resten } = k
  await skriv(resten)
}

