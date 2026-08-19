/**
 * Selvtest for fakturagrunnlaget. Samme mønster som verify-pricefile: et
 * kjørbart skript med harde påstander, ingen testrunner.
 *
 *   npm run verify:invoicing
 *
 * Dette regnestykket blir til ekte penger på en ekte faktura. De to feilene som
 * koster mest er avrundingsdrift over mange linjer og MVA-koder som mappes feil,
 * og begge er testet her.
 */
import {
  byggFakturagrunnlag, formatKr, linjebelopOre, mvaBelopOre, somMvaType, tilOre,
  type MateriellInn, type TilleggInn, type TimeInn,
} from '../lib/invoicing'
import { MVA_FIKEN, MVA_TRIPLETEX } from '../lib/accounting/adapter'

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

// ── Penger ────────────────────────────────────────────────────────────────────

sjekk('tilOre: 20,50 kr → 2050 øre', tilOre(20.5), 2050)
sjekk('tilOre: 0,1+0,2-problemet gir ikke 30,000000004', tilOre(0.1 + 0.2), 30)
sjekk('tilOre: 1234,567 runder til nærmeste øre', tilOre(1234.567), 123457)
sjekk('linjebelop: 12,5 m à 24,90', linjebelopOre(12.5, tilOre(24.9)), 31125)
sjekk('mva 25 % av 31125 øre', mvaBelopOre(31125, 'hoy'), 7781)
sjekk('mva fritatt gir 0', mvaBelopOre(31125, 'fritatt'), 0)
sjekk('formatKr grupperer tusen med hardt mellomrom', formatKr(123456789), '1\u00A0234\u00A0567,89')
sjekk('tusenskilleren er IKKE vanlig mellomrom', formatKr(1000).includes(' '), false)
sjekk('formatKr negativt', formatKr(-2050), '−20,50')
sjekk('formatKr null', formatKr(0), '0,00')

// ── MVA-typer ─────────────────────────────────────────────────────────────────

sjekk('somMvaType: ukjent faller til høy', somMvaType('tullball'), 'hoy')
sjekk('somMvaType: null faller til høy', somMvaType(null), 'hoy')
sjekk('somMvaType: fritatt beholdes', somMvaType('fritatt'), 'fritatt')
sjekk('Fiken-mapping er engelsk, ikke norsk', MVA_FIKEN.hoy, 'HIGH')
sjekk('Fiken fritatt', MVA_FIKEN.fritatt, 'EXEMPT')
sjekk('Tripletex bruker tallkoder', MVA_TRIPLETEX.hoy, '3')

// ── Grunnlaget ────────────────────────────────────────────────────────────────

const materiell: MateriellInn[] = [
  { id: 'm1', beskrivelse: 'PFSP 3G2,5', antall: 50, enhet: 'm', elnummer: '1234567', enhetsprisKr: 24.9, kostprisKr: 14.5 },
  { id: 'm2', beskrivelse: 'Stikk infelt', antall: 3, enhet: 'stk', enhetsprisKr: 189, kostprisKr: 96 },
  { id: 'm3', beskrivelse: 'Garantibytte deksel', antall: 1, enhet: 'stk', enhetsprisKr: 79, fakturerbar: false },
  { id: 'm4', beskrivelse: 'Ukjent bryter', antall: 2, enhet: 'stk', enhetsprisKr: null },
]

const timer: TimeInn[] = [
  { id: 't1', aktivitetId: 'a1', aktivitetNavn: 'Montasje', aktivitetTimepris: 850, aktivitetFakturerbar: true, personId: 'p1', personNavn: 'Tormod', dato: 0, timer: 4, notat: 'Trakk kurs til kjøkken' },
  { id: 't2', aktivitetId: 'a1', aktivitetNavn: 'Montasje', aktivitetTimepris: 850, aktivitetFakturerbar: true, personId: 'p2', personNavn: 'Ola', dato: 0, timer: 2.5 },
  { id: 't3', aktivitetId: 'a2', aktivitetNavn: 'Kjøring', aktivitetTimepris: 650, aktivitetFakturerbar: true, personId: 'p1', personNavn: 'Tormod', dato: 0, timer: 1 },
  { id: 't4', aktivitetId: 'a3', aktivitetNavn: 'Garanti', aktivitetTimepris: 0, aktivitetFakturerbar: false, personId: 'p1', personNavn: 'Tormod', dato: 0, timer: 2 },
]

const g = byggFakturagrunnlag(materiell, timer)

sjekk('materiell + to aktiviteter = 4 linjer', g.linjer.length, 4)
sjekk('kabellinje netto (50 × 24,90)', g.linjer[0].nettoOre, 124500)
sjekk('kabellinje mva 25 %', g.linjer[0].mvaOre, 31125)
sjekk('kabellinje brutto', g.linjer[0].bruttoOre, 155625)
sjekk('el-nummer følger med linja', g.linjer[0].elnummer, '1234567')

const montasje = g.linjer.find(l => l.kilde === 'timer' && l.beskrivelse.startsWith('Montasje'))
sjekk('to personer slås sammen på aktivitet', montasje?.antall, 6.5)
sjekk('montasje netto (6,5 × 850)', montasje?.nettoOre, 552500)
sjekk('notat følger med i beskrivelsen', montasje?.beskrivelse.includes('Trakk kurs til kjøkken'), true)
sjekk('begge timeføringene er kilde til linja', montasje?.kildeIder, ['t1', 't2'])

sjekk('ikke-fakturerbart materiell utelates', g.utelatt.some(u => u.id === 'm3' && u.grunn === 'ikke_fakturerbar'), true)
sjekk('materiell uten pris utelates som mangel', g.utelatt.some(u => u.id === 'm4' && u.grunn === 'mangler_pris'), true)
sjekk('garantitimer utelates', g.utelatt.some(u => u.id === 't4' && u.grunn === 'ikke_fakturerbar'), true)
sjekk('fire utelatte totalt', g.utelatt.length, 3)

// 124500 + 56700 (3 × 189) + 552500 + 65000 = 798700
sjekk('sum netto', g.nettoOre, 798700)
sjekk('sum mva', g.mvaOre, 199675)
sjekk('sum brutto', g.bruttoOre, 998375)
sjekk('brutto = netto + mva', g.bruttoOre, g.nettoOre + g.mvaOre)
sjekk('linjene summerer til totalen', g.linjer.reduce((a, l) => a + l.bruttoOre, 0), g.bruttoOre)

// Kost: 50 × 14,50 = 72500, 3 × 96 = 28800 → 101300
sjekk('kost kun fra materiell med kostpris', g.kostOre, 101300)
sjekk('dekningsbidrag', g.dbOre, 798700 - 101300)
sjekk('DB-prosent', Math.round((g.dbProsent as number) * 10) / 10, 87.3)

sjekk('mva-fordeling har én sats', g.mvaFordeling.length, 1)
sjekk('mva-fordeling stemmer med totalen', g.mvaFordeling[0].mvaOre, g.mvaOre)

// ── Gruppering ────────────────────────────────────────────────────────────────

const perPerson = byggFakturagrunnlag([], timer, { gruppering: 'aktivitetOgPerson' })
sjekk('aktivitet+person gir 3 timelinjer', perPerson.linjer.length, 3)
sjekk('personnavn står i linja', perPerson.linjer.some(l => l.beskrivelse.startsWith('Montasje, Ola')), true)
sjekk('gruppering endrer ikke totalen', perPerson.nettoOre, byggFakturagrunnlag([], timer).nettoOre)

const ingen = byggFakturagrunnlag([], timer, { gruppering: 'ingen' })
sjekk('gruppering «ingen» gir én linje per føring', ingen.linjer.length, 3)
sjekk('gruppering «ingen» endrer ikke totalen', ingen.nettoOre, perPerson.nettoOre)

// ── Fakturert-sperren ─────────────────────────────────────────────────────────

const alleredeFakturert: MateriellInn[] = [
  { id: 'm9', beskrivelse: 'Allerede fakturert', antall: 1, enhet: 'stk', enhetsprisKr: 100, fakturertTid: 1 },
]
sjekk('fakturert linje utelates som standard', byggFakturagrunnlag(alleredeFakturert, []).linjer.length, 0)
sjekk('fakturert linje utelates med grunn', byggFakturagrunnlag(alleredeFakturert, []).utelatt[0].grunn, 'allerede_fakturert')
sjekk('kan tvinges med', byggFakturagrunnlag(alleredeFakturert, [], { inkluderFakturerte: true }).linjer.length, 1)

// ── Tilleggsarbeid ────────────────────────────────────────────────────────────
// Det farligste her er at et IKKE-godkjent tillegg havner på fakturaen, eller at
// et «etter medgått»-tillegg fakturerer timene en gang til.

const tillegg: TilleggInn[] = [
  { id: 'x1', tittel: 'To ekstra stikk soverom', prising: 'fastpris', prisKr: 2400, status: 'godkjent', godkjentAv: 'Kari Nordmann' },
  { id: 'x2', tittel: 'Flytte sikringsskap', prising: 'fastpris', prisKr: 8000, status: 'foreslatt' },
  { id: 'x3', tittel: 'Downlights gang', prising: 'fastpris', prisKr: 5000, status: 'avvist' },
  { id: 'x4', tittel: 'Feilsøking jordfeil', prising: 'medgatt', status: 'godkjent', godkjentAv: 'Kari Nordmann' },
  { id: 'x5', tittel: 'Uprist tillegg', prising: 'fastpris', prisKr: null, status: 'godkjent' },
]

const gt = byggFakturagrunnlag([], [], {}, tillegg)

sjekk('kun godkjent fastpris med beløp blir linje', gt.linjer.length, 1)
sjekk('godkjent fastpris netto', gt.linjer[0].nettoOre, 240000)
sjekk('godkjenner navngis på linja', gt.linjer[0].beskrivelse, 'To ekstra stikk soverom (godkjent av Kari Nordmann)')
sjekk('linja er merket som tillegg', gt.linjer[0].kilde, 'tillegg')

sjekk('foreslått tillegg faktureres ALDRI', gt.utelatt.some(u => u.id === 'x2' && u.grunn === 'ikke_godkjent'), true)
sjekk('avvist tillegg faktureres ALDRI', gt.utelatt.some(u => u.id === 'x3' && u.grunn === 'avvist'), true)
sjekk('godkjent uten pris flagges som mangel', gt.utelatt.some(u => u.id === 'x5' && u.grunn === 'mangler_pris'), true)

// «Etter medgått» skal IKKE gi egen linje — timene og materiellet ligger der alt.
sjekk('etter medgått gir ingen linje', gt.linjer.some(l => l.kildeIder.includes('x4')), false)
sjekk('etter medgått er heller ikke en «mangel»', gt.utelatt.some(u => u.id === 'x4'), false)

// Dobbeltfakturering: samme arbeid som både timer og medgått-tillegg.
const medTimer = byggFakturagrunnlag([], timer, {}, [tillegg[3]])
const utenTillegg = byggFakturagrunnlag([], timer, {})
sjekk('medgått-tillegg endrer ikke totalen', medTimer.nettoOre, utenTillegg.nettoOre)

// Tillegg legger seg SIST, etter materiell og timer.
const blandet = byggFakturagrunnlag(materiell, timer, {}, [tillegg[0]])
sjekk('tillegg ligger sist i linjelista', blandet.linjer[blandet.linjer.length - 1].kilde, 'tillegg')
sjekk('tillegg teller med i totalen', blandet.nettoOre, g.nettoOre + 240000)

// ── Tomt grunnlag ─────────────────────────────────────────────────────────────

const tom = byggFakturagrunnlag([], [])
sjekk('tom ordre gir 0 kr', [tom.nettoOre, tom.mvaOre, tom.bruttoOre], [0, 0, 0])
sjekk('tom ordre har ingen DB (ikke 0 %)', tom.dbOre, null)

// ── Avrundingsdrift ───────────────────────────────────────────────────────────
// 100 linjer à 0,333 kr. Naiv flyttallssum ville drevet fra heltallssummen.
const mange: MateriellInn[] = Array.from({ length: 100 }, (_, i) => ({
  id: `d${i}`, beskrivelse: `Linje ${i}`, antall: 1, enhet: 'stk', enhetsprisKr: 0.333,
}))
const drift = byggFakturagrunnlag(mange, [])
sjekk('100 × 0,333 kr = 100 × 33 øre', drift.nettoOre, 3300)
sjekk('summen er et heltall øre', Number.isInteger(drift.nettoOre), true)
sjekk('mva på summen er heltall', Number.isInteger(drift.mvaOre), true)

console.log(feil === 0 ? '\nAlle påstander grønne.' : `\n${feil} påstand(er) feilet.`)
process.exit(feil === 0 ? 0 : 1)
