/**
 * Serviceavtaler — regnestykket. REN modul, ingen database.
 *
 * Årskontroll, internkontroll, nødlys, brannvarsling: det gjentakende arbeidet
 * er den mest lønnsomme delen av et elektrofirma, og systemet som HUSKER
 * avtalen er det som beholder kunden. Alt her er datoregning, og datoregning
 * er nettopp der man tror man er ferdig for tidlig:
 *
 *   - 31. januar + 1 måned er 28. februar, ikke 3. mars.
 *   - Sommertid flytter klokka, ikke datoen — «om 12 måneder» skal treffe
 *     samme dato, ikke samme antall millisekunder.
 *   - En avtale som er FORFALT skal ikke hoppe over perioder når den endelig
 *     utføres: neste forfall regnes fra utførelsen, ikke fra planen.
 */

export type Intervall = { maneder: number }

/** Kjente intervaller. Fritt tall er lov — dette er bare de vanlige. */
export const INTERVALLER: { maneder: number; navn: string }[] = [
  { maneder: 1, navn: 'Hver måned' },
  { maneder: 3, navn: 'Hvert kvartal' },
  { maneder: 6, navn: 'Hvert halvår' },
  { maneder: 12, navn: 'Årlig' },
  { maneder: 24, navn: 'Annethvert år' },
  { maneder: 36, navn: 'Hvert tredje år' },
  { maneder: 60, navn: 'Hvert femte år' },
]

export function intervallNavn(maneder: number): string {
  return INTERVALLER.find(i => i.maneder === maneder)?.navn ?? `Hver ${maneder}. måned`
}

/**
 * Legger til måneder med KALENDER-semantikk, ikke millisekunder.
 *
 * `new Date(2026, 0, 31)` + 1 måned gir i JS 3. mars (31. februar renner
 * over). En årskontroll avtalt til den 31. skal skje siste dag i måneden,
 * ikke tre dager inn i neste.
 */
export function leggTilManeder(dato: Date, maneder: number): Date {
  const aar = dato.getFullYear()
  const mnd = dato.getMonth() + maneder
  const dag = dato.getDate()
  // Dag 0 i «måneden etter» = siste dag i ønsket måned.
  const sisteDagIMaaned = new Date(aar, mnd + 1, 0).getDate()
  const ut = new Date(dato)
  ut.setFullYear(aar, mnd, Math.min(dag, sisteDagIMaaned))
  return ut
}

/** Midnatt lokal tid. Forfall er en DATO, ikke et klokkeslett. */
export function tilDagStart(d: Date): Date {
  const ut = new Date(d)
  ut.setHours(0, 0, 0, 0)
  return ut
}

/**
 * Neste forfall etter en utførelse. Regnes fra NÅR DET FAKTISK BLE GJORT —
 * ikke fra planlagt dato. En kontroll utsatt i to måneder flytter hele
 * rekken; alternativet ville gitt to kontroller tett i tid og deretter
 * samme skjevhet for alltid.
 */
export function nesteForfallEtterUtforelse(utfortDato: Date, intervall: Intervall): Date {
  return tilDagStart(leggTilManeder(utfortDato, intervall.maneder))
}

/**
 * Første forfall for en ny avtale: startdato + intervall, med mindre avtalen
 * starter med en kontroll som skal skje nå.
 */
export function forsteForfall(start: Date, intervall: Intervall, kontrollVedStart = false): Date {
  return kontrollVedStart ? tilDagStart(start) : nesteForfallEtterUtforelse(start, intervall)
}

export type Forfallsstatus = 'forfalt' | 'naa' | 'kommende'

/**
 * Status for én avtale. `varselDager` er hvor lenge før forfall arbeidet skal
 * dukke opp som noe å planlegge — en årskontroll bestilles ikke samme dag.
 */
export function forfallsstatus(
  nesteForfall: Date,
  naa: Date,
  varselDager = 30,
): Forfallsstatus {
  const forfall = tilDagStart(nesteForfall).getTime()
  const idag = tilDagStart(naa).getTime()
  if (forfall < idag) return 'forfalt'
  // Dager regnes på midnatt-verdier, så sommertid ikke gir en time i slingring.
  const dagerTil = Math.round((forfall - idag) / 86400000)
  return dagerTil <= varselDager ? 'naa' : 'kommende'
}

/** Dager til forfall. Negativt = forfalt for så mange dager siden. */
export function dagerTilForfall(nesteForfall: Date, naa: Date): number {
  return Math.round((tilDagStart(nesteForfall).getTime() - tilDagStart(naa).getTime()) / 86400000)
}

/**
 * Alle forfall i et vindu — for å se hva året bringer, og for å planlegge.
 * Stopper på `maks` så en månedlig avtale over ti år ikke bygger en liste
 * ingen skal lese.
 */
export function kommendeForfall(
  fraForfall: Date,
  intervall: Intervall,
  tilDato: Date,
  maks = 24,
): Date[] {
  const ut: Date[] = []
  let d = tilDagStart(fraForfall)
  while (d.getTime() <= tilDato.getTime() && ut.length < maks) {
    ut.push(new Date(d))
    d = nesteForfallEtterUtforelse(d, intervall)
  }
  return ut
}

/** Sorteringsvekt: forfalt først, så nærmeste forfall. */
export function forfallsVekt(nesteForfall: Date, naa: Date): number {
  return dagerTilForfall(nesteForfall, naa)
}
