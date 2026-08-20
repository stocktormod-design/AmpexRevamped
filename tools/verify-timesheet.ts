/**
 * Selvtest for ukelista. Samme mønster som verify-invoicing.
 *
 *   npm run verify:timesheet
 *
 * Ukelista er lønnsgrunnlag. De to feilene som koster er (a) feil ukestart, som
 * flytter timer mellom to lønnsperioder, og (b) feil arv av fakturerbarhet, som
 * gjør at ulønnsom tid ser lønnsom ut.
 */
import {
  byggUkeliste, flyttUke, formatTimer, ukeEtikett, ukenummer, ukeSlutt, ukeStart,
} from '../lib/timesheet-calc'

let feil = 0

function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
  } else {
    console.log(`✓ ${navn}`)
  }
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ── Ukestart: mandag, ikke søndag ────────────────────────────────────────────
// 19. august 2026 er en onsdag.
sjekk('onsdag → mandag samme uke', iso(ukeStart(new Date(2026, 7, 19))), '2026-08-17')
sjekk('mandag → seg selv', iso(ukeStart(new Date(2026, 7, 17))), '2026-08-17')
// Søndag er UKENS SISTE dag i Norge. En søndag-til-lørdag-uke ville flyttet
// søndagstimer inn i neste lønnsperiode.
sjekk('søndag → mandagen FØR, ikke etter', iso(ukeStart(new Date(2026, 7, 23))), '2026-08-17')
sjekk('lørdag → mandagen før', iso(ukeStart(new Date(2026, 7, 22))), '2026-08-17')
sjekk('ukestart nullstiller klokka', ukeStart(new Date(2026, 7, 19, 23, 59)).getHours(), 0)
sjekk('uken er sju dager', (ukeSlutt(ukeStart(new Date(2026, 7, 19))).getTime() - ukeStart(new Date(2026, 7, 19)).getTime()) / 86_400_000, 7)
sjekk('forrige uke', iso(flyttUke(ukeStart(new Date(2026, 7, 19)), -1)), '2026-08-10')
sjekk('neste uke', iso(flyttUke(ukeStart(new Date(2026, 7, 19)), 1)), '2026-08-24')
// Månedsskifte er der en naiv «minus 7 dager» ryker.
sjekk('uke over månedsskifte', iso(flyttUke(ukeStart(new Date(2026, 8, 2)), -1)), '2026-08-24')
sjekk('uke over årsskifte', iso(flyttUke(ukeStart(new Date(2027, 0, 5)), -1)), '2026-12-28')

// ── ISO-ukenummer ────────────────────────────────────────────────────────────
sjekk('uke 34 i 2026', ukenummer(new Date(2026, 7, 19)), 34)
// 1. januar 2027 er en fredag → hører til uke 53 av 2026, ikke uke 1.
sjekk('1. januar kan høre til fjorårets siste uke', ukenummer(new Date(2027, 0, 1)), 53)
sjekk('4. januar 2027 er uke 1', ukenummer(new Date(2027, 0, 4)), 1)

const naa = new Date(2026, 7, 19)
sjekk('denne uken heter «Denne uken»', ukeEtikett(ukeStart(naa), naa), 'Denne uken')
sjekk('forrige uke navngis', ukeEtikett(flyttUke(ukeStart(naa), -1), naa), 'Forrige uke')
sjekk('eldre uker får nummer', ukeEtikett(flyttUke(ukeStart(naa), -3), naa), 'Uke 31')

// ── Fordeling på dager ───────────────────────────────────────────────────────

const start = ukeStart(new Date(2026, 7, 19))
type Linje = { orderId: string; date: Date; hours: number; activityId: string | null; billable: boolean | null }
const linje = (dag: number, hours: number, orderId = 'o1', activityId: string | null = 'a1', billable: boolean | null = null): Linje => {
  const d = new Date(start); d.setDate(d.getDate() + dag); d.setHours(9, 0, 0, 0)
  return { orderId, date: d, hours, activityId, billable }
}

const ordre = new Map<string, { id: string; title: string }>([
  ['o1', { id: 'o1', title: 'Storgata 4' }],
  ['o2', { id: 'o2', title: 'Kirkeveien 12' }],
])
const aktiviteter = new Map<string, { id: string; name: string; billable: boolean }>([
  ['a1', { id: 'a1', name: 'Montasje', billable: true }],
  ['a2', { id: 'a2', name: 'Internt', billable: false }],
])

const uke = byggUkeliste(
  start,
  [
    linje(0, 7.5), linje(1, 8), linje(1, 1.5, 'o2'),
    linje(4, 6, 'o2'), linje(6, 3, 'o1', 'a2'),
  ] as never,
  ordre as never,
  aktiviteter as never,
)

sjekk('sju dager alltid, også tomme', uke.dager.length, 7)
sjekk('timer per dag', uke.dager.map(d => d.timer), [7.5, 9.5, 0, 0, 6, 0, 3])
sjekk('søndag er dag 7, ikke dag 1', uke.dager[6].timer, 3)
sjekk('sum for uken', uke.sumTimer, 26)
sjekk('flere linjer på samme dag beholdes hver for seg', uke.dager[1].linjer.length, 2)

sjekk('per ordre, størst først', uke.perOrdre.map(o => [o.tittel, o.timer]),
  [['Storgata 4', 18.5], ['Kirkeveien 12', 7.5]])
sjekk('per aktivitet', uke.perAktivitet.map(a => [a.navn, a.timer]), [['Montasje', 23], ['Internt', 3]])

// Arv: linja sier ingenting (null) → aktiviteten avgjør. Samme regel som fakturagrunnlaget.
sjekk('ikke-fakturerbar tid arves fra aktiviteten', uke.ikkeFakturerbare, 3)

const overstyrt = byggUkeliste(start, [linje(0, 4, 'o1', 'a1', false)] as never, ordre as never, aktiviteter as never)
sjekk('eksplisitt billable=false overstyrer aktiviteten', overstyrt.ikkeFakturerbare, 4)
const uten = byggUkeliste(start, [linje(0, 4, 'o1', null)] as never, ordre as never, aktiviteter as never)
sjekk('uten aktivitet regnes timen som fakturerbar', uten.ikkeFakturerbare, 0)
sjekk('uten aktivitet får en egen bøtte', uten.perAktivitet.map(a => a.navn), ['Uten aktivitet'])

// Linjer utenfor uken skal ALDRI telle — det er slik timer havner i feil lønnsperiode.
const utenfor = byggUkeliste(start, [linje(-1, 5), linje(7, 5), linje(2, 2)] as never, ordre as never, aktiviteter as never)
sjekk('dagen før uken telles ikke', utenfor.sumTimer, 2)
sjekk('en slettet ordre gir navn, ikke krasj',
  byggUkeliste(start, [linje(0, 1, 'borte')] as never, ordre as never, aktiviteter as never).perOrdre[0].tittel,
  'Slettet ordre')

// ── Formatering ──────────────────────────────────────────────────────────────
sjekk('heltall uten desimaler', formatTimer(8), '8 t')
sjekk('halvtimer med norsk komma', formatTimer(7.5), '7,5 t')
sjekk('tredjedeler rundes til to desimaler', formatTimer(1 / 3), '0,33 t')
sjekk('null timer', formatTimer(0), '0 t')

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')
