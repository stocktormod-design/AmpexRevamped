/**
 * Ren regning for ordreklokka — ingen database, derfor selvtestbar
 * (tools/verify-klokke.ts). Samme splitt som lib/timesheet-calc.ts:
 * tall som blir til lønn og fakturalinjer skal kunne prøves uten en app rundt.
 */

/**
 * Minutter → timer, avrundet til nærmeste kvarter.
 *
 * Kvarter fordi det er enheten faget bruker — ingen fører «2,37 t». Og aldri
 * null: et kort besøk som blir null timer forsvinner fra fakturaen, og montøren
 * har vært der.
 */
export function kvarter(minutter: number): number {
  return Math.round(minutter / 15) / 4 || 0.25
}

/**
 * «3 t 15 min» — timer som desimaltall er riktig i databasen og feil i en
 * setning til et menneske. «3,25 t» må regnes om i hodet; «3 t 15 min» ikke.
 */
export function timerTekst(timer: number): string {
  const t = Math.floor(timer)
  const m = Math.round((timer - t) * 60)
  if (t === 0) return `${m} min`
  if (m === 0) return `${t} t`
  return `${t} t ${m} min`
}
