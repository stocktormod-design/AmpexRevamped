/**
 * Ukeplanen — ren regning, ingen database.
 *
 * Timelista svarer på hva uken BLE. Denne svarer på hva uken SKAL bli: de
 * avtalte jobbene, dag for dag. Samme mandagsuke og samme ukevelger som
 * timelista, så de to leses med samme hode.
 *
 * Skilt fra UI-et av samme grunn som timesheet-calc er skilt fra timesheet:
 * bøttingen på dag er den ene tingen her som kan gå galt uten at noen ser det
 * — en jobb i feil dag er en jobb ingen møter opp på — og den skal kunne
 * selvtestes (`npm run verify:kalender`) uten å starte en app.
 */

// Ukevelgeren er FELLES med timelista. To ulike svar på «hvilken uke er dette»
// ville vært umulig å forklare.
export { DAGER, flyttUke, ukeEtikett, ukenummer, ukeSlutt, ukeStart } from './timesheet-calc'

/** Strukturell inndata, ikke WatermelonDB — UI-et får de ekte radene tilbake. */
export type AvtaltJobb = { scheduledAt: Date | null }

export type PlanDag<T> = { dato: Date; jobber: T[] }

export type Ukeplan<T> = {
  start: Date
  dager: PlanDag<T>[]
  /** Antall jobber som faktisk ligger i uken. */
  sumJobber: number
  /** Flest jobber på én dag — skalaen søylene måles mot. */
  maksPerDag: number
  /** Jobber uten dato. De er ikke planlagt, og skal ikke være usynlige. */
  utenDato: T[]
}

export function tomUkeplan<T>(start: Date): Ukeplan<T> {
  return {
    start,
    dager: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return { dato: d, jobber: [] as T[] }
    }),
    sumJobber: 0,
    maksPerDag: 0,
    utenDato: [],
  }
}

/**
 * Fordeler avtalte jobber på ukens sju dager, i klokkeslettrekkefølge.
 */
export function byggUkeplan<T extends AvtaltJobb>(start: Date, jobber: T[]): Ukeplan<T> {
  const plan = tomUkeplan<T>(start)

  for (const j of jobber) {
    if (!j.scheduledAt) { plan.utenDato.push(j); continue }
    const i = dagIndeks(start, j.scheduledAt)
    // Jobber utenfor uken telles ALDRI med — de hører til en annen uke.
    if (i < 0 || i > 6) continue
    plan.dager[i].jobber.push(j)
    plan.sumJobber++
  }

  for (const d of plan.dager) {
    // Ikke-null er garantert: jobber uten dato ble filtrert ut over.
    d.jobber.sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
    plan.maksPerDag = Math.max(plan.maksPerDag, d.jobber.length)
  }
  return plan
}

/**
 * Dagnummer 0–6 fra ukestart.
 *
 * `Math.round`, ikke `floor`: sommertid gjør ett døgn 23 eller 25 timer langt,
 * og en ren divisjon på 86 400 000 bommer da med en dag.
 */
function dagIndeks(start: Date, d: Date): number {
  const midnatt = new Date(d)
  midnatt.setHours(0, 0, 0, 0)
  return Math.round((midnatt.getTime() - start.getTime()) / 86_400_000)
}

/**
 * Dagen som skal være valgt når uken åpnes: i dag når den ligger i uken, ellers
 * første dag med jobber. Å åpne på mandag i en uke der alt skjer på torsdag
 * ville vist en tom dag som om ingenting var planlagt.
 */
export function standardDag<T>(plan: Ukeplan<T>, naa = new Date()): number {
  const idag = dagIndeks(plan.start, naa)
  if (idag >= 0 && idag <= 6) return idag
  const forste = plan.dager.findIndex(d => d.jobber.length > 0)
  return forste === -1 ? 0 : forste
}
