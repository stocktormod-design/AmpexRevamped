/**
 * Godkjenning — ren logikk, ingen database. Selvtestes i
 * `npm run verify:approvals`.
 *
 * Kjernen er én ting: å oppdage at en godkjenning ikke lenger stemmer.
 * Godkjennes en ordre på 12 400 kr og noen fører to timer etterpå, ser alt
 * riktig ut med mindre noen sier fra.
 */

/** Bare det snapshotet trenger — ikke hele WatermelonDB-modellen. */
export type Snapshot = {
  sumOre: number | null
  timer: number | null
  antallMateriell: number | null
  antallDokumenter: number | null
  antallSignaturer: number | null
  besluttetAt: Date
  beslutning: 'godkjent' | 'avvist'
}

/** Det faglig ansvarlig faktisk ser på når han bestemmer seg. */
export type Grunnlag = {
  sumOre: number
  timer: number
  antallMateriell: number
  antallDokumenter: number
  /** Dokumenter som er FULLFØRT. Utkast teller ikke som dokumentasjon. */
  antallFullforte: number
  antallSignaturer: number
  harKunde: boolean
}

export type Godkjenningsstatus =
  | { type: 'ingen' }
  | { type: 'avvist'; rad: Snapshot }
  | { type: 'godkjent'; rad: Snapshot; avvik: string[] }

/**
 * Har noe endret seg siden godkjenningen?
 *
 * Sammenligner snapshotet mot nåtilstanden. Rene funksjoner, ingen database —
 * derfor selvtestbart (`npm run verify:approvals`).
 *
 * Vi blokkerer ikke på avvik. Å oppdage at to timer kom til ETTER at faglig
 * ansvarlig sa ja, er en samtale mellom mennesker — ikke noe systemet skal
 * gjette på og stoppe. Men det skal stå på skjermen, ikke være usynlig.
 */
export function finnAvvik(rad: Snapshot, naa: Grunnlag): string[] {
  const ut: string[] = []
  const kr = (ore: number) => `${(ore / 100).toFixed(2).replace('.', ',')} kr`
  if (rad.sumOre != null && rad.sumOre !== naa.sumOre) {
    ut.push(`Summen er endret fra ${kr(rad.sumOre)} til ${kr(naa.sumOre)}`)
  }
  if (rad.timer != null && rad.timer !== naa.timer) {
    ut.push(`Timene er endret fra ${String(rad.timer).replace('.', ',')} til ${String(naa.timer).replace('.', ',')}`)
  }
  if (rad.antallMateriell != null && rad.antallMateriell !== naa.antallMateriell) {
    ut.push(`Materiellinjer er endret fra ${rad.antallMateriell} til ${naa.antallMateriell}`)
  }
  if (rad.antallDokumenter != null && rad.antallDokumenter !== naa.antallDokumenter) {
    ut.push(`Dokumenter er endret fra ${rad.antallDokumenter} til ${naa.antallDokumenter}`)
  }
  if (rad.antallSignaturer != null && rad.antallSignaturer !== naa.antallSignaturer) {
    ut.push(`Signaturer er endret fra ${rad.antallSignaturer} til ${naa.antallSignaturer}`)
  }
  return ut
}

/** Gjeldende beslutning for en ordre — den nyeste som ikke er slettet. */
export function sisteBeslutning<T extends { besluttetAt: Date }>(rader: T[]): T | null {
  return [...rader].sort((a, b) => b.besluttetAt.getTime() - a.besluttetAt.getTime())[0] ?? null
}
