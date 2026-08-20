/**
 * Ukelista — ren regning, ingen database.
 *
 * Skilt fra lib/timesheet.ts av samme grunn som lib/invoicing.ts er skilt fra
 * lib/order-billing.ts: dette er lønnsgrunnlag, og lønnsgrunnlag skal kunne
 * selvtestes (`npm run verify:timesheet`) uten å starte en app.
 *
 * Uken er mandag–søndag (ISO 8601 / norsk arbeidsuke), ikke søndag–lørdag. En
 * søndag-til-lørdag-uke flytter søndagstimer inn i neste lønnsperiode.
 */

export const DAGER = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']

/** Mandag 00:00 i uken `d` faller i. */
export function ukeStart(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  // getDay(): 0 = søndag. Vi vil ha mandag som 0, altså (dag + 6) % 7.
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export function ukeSlutt(start: Date): Date {
  const x = new Date(start)
  x.setDate(x.getDate() + 7)
  return x
}

export function flyttUke(start: Date, uker: number): Date {
  const x = new Date(start)
  x.setDate(x.getDate() + uker * 7)
  return ukeStart(x)
}

/**
 * ISO-ukenummer. Regelen er «uken som inneholder årets første torsdag er uke 1»
 * — derfor torsdagstrikset, ikke en divisjon på dagnummer.
 */
export function ukenummer(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const nyttar = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - nyttar.getTime()) / 86_400_000 + 1) / 7)
}

export function ukeEtikett(start: Date, naa = new Date()): string {
  const denne = ukeStart(naa).getTime()
  if (start.getTime() === denne) return 'Denne uken'
  if (start.getTime() === flyttUke(ukeStart(naa), -1).getTime()) return 'Forrige uke'
  if (start.getTime() === flyttUke(ukeStart(naa), 1).getTime()) return 'Neste uke'
  return `Uke ${ukenummer(start)}`
}

// Inndata er strukturelle, ikke WatermelonDB-modeller — men generiske, så
// UI-et får de ekte radene tilbake i `linjer` og kan navigere fra dem.
export type TimeLinje = {
  orderId: string
  date: Date
  hours: number
  activityId: string | null
  billable: boolean | null
}
export type OrdreOppslag = { title: string }
export type AktivitetOppslag = { name: string; billable: boolean }

export type UkeDag<T> = { dato: Date; timer: number; linjer: T[] }

export type Ukeliste<T> = {
  start: Date
  dager: UkeDag<T>[]
  sumTimer: number
  /** Timer per ordre, sortert fallende. Svarer på «hva gikk uken med til». */
  perOrdre: { orderId: string; tittel: string; timer: number }[]
  perAktivitet: { aktivitetId: string | null; navn: string; timer: number }[]
  /** Timer som ikke er fakturerbare — ekte kostnad uten inntekt. */
  ikkeFakturerbare: number
}

export function tomUke<T>(start: Date): Ukeliste<T> {
  return {
    start,
    dager: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return { dato: d, timer: 0, linjer: [] as T[] }
    }),
    sumTimer: 0,
    perOrdre: [],
    perAktivitet: [],
    ikkeFakturerbare: 0,
  }
}

/**
 * Bygger ukelista for én person.
 *
 * Fakturerbarhet arves fra aktiviteten når linja ikke sier noe (`billable`
 * null) — samme regel som i lib/invoicing.ts. To forskjellige svar på «er denne
 * timen fakturerbar» ville vært umulig å forklare for noen.
 */
export function byggUkeliste<T extends TimeLinje>(
  start: Date,
  linjer: T[],
  ordre: Map<string, OrdreOppslag>,
  aktiviteter: Map<string, AktivitetOppslag>,
): Ukeliste<T> {
  const uke = tomUke<T>(start)
  const perOrdre = new Map<string, number>()
  const perAktivitet = new Map<string, number>()

  for (const l of linjer) {
    const dagIndeks = Math.floor((new Date(l.date).setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000)
    // Linjer utenfor uken telles ALDRI — det er slik timer havner i feil
    // lønnsperiode uten at noen oppdager det.
    if (dagIndeks < 0 || dagIndeks > 6) continue
    uke.dager[dagIndeks].timer += l.hours
    uke.dager[dagIndeks].linjer.push(l)
    uke.sumTimer += l.hours

    perOrdre.set(l.orderId, (perOrdre.get(l.orderId) ?? 0) + l.hours)
    const aId = l.activityId ?? ''
    perAktivitet.set(aId, (perAktivitet.get(aId) ?? 0) + l.hours)

    const aktivitet = l.activityId ? aktiviteter.get(l.activityId) : undefined
    const fakturerbar = l.billable ?? aktivitet?.billable ?? true
    if (!fakturerbar) uke.ikkeFakturerbare += l.hours
  }

  uke.perOrdre = [...perOrdre.entries()]
    .map(([orderId, timer]) => ({ orderId, tittel: ordre.get(orderId)?.title ?? 'Slettet ordre', timer }))
    .sort((a, b) => b.timer - a.timer)
  uke.perAktivitet = [...perAktivitet.entries()]
    .map(([id, timer]) => ({
      aktivitetId: id || null,
      navn: id ? (aktiviteter.get(id)?.name ?? 'Ukjent aktivitet') : 'Uten aktivitet',
      timer,
    }))
    .sort((a, b) => b.timer - a.timer)
  return uke
}

/** «7,5 t» — norsk komma, heltall uten desimaler. */
export function formatTimer(timer: number): string {
  if (timer === 0) return '0 t'
  const rundet = Math.round(timer * 100) / 100
  return `${String(rundet).replace('.', ',')} t`
}
