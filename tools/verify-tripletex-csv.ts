/**
 * Selvtest for CSV-fakturaeksporten.
 *
 *   npm run verify:tripletex-csv
 *
 * Denne fila blir til ekte penger i et ekte regnskap, og ingen API validerer
 * den underveis — regnskapsføreren importerer det vi skriver. De fire feilene
 * som koster mest er testet her:
 *
 *   1. Belop i ore i stedet for kroner  → faktura 100x for hoy
 *   2. Rabatt trukket to ganger         → kunden underfaktureres
 *   3. Feil MVA-kode                    → feil avgift, oppdages av Skatteetaten
 *   4. Formelinjeksjon fra fritekst     → angrep mot regnskapsforeren som
 *                                          apner fila for aa se over den
 */
import { belop, byggFakturaCsv, felt, filnavn, isoDato, KOLONNER, type Fakturarad } from '../lib/accounting/tripletex-csv'
import type { Fakturagrunnlag } from '../lib/invoicing'

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

const grunnlag = (linjer: Fakturagrunnlag['linjer']): Fakturagrunnlag => ({
  linjer,
  utelatt: [],
  nettoOre: linjer.reduce((n, l) => n + l.nettoOre, 0),
  mvaOre: linjer.reduce((n, l) => n + l.mvaOre, 0),
  bruttoOre: linjer.reduce((n, l) => n + l.bruttoOre, 0),
  kostOre: 0,
  dbOre: null,
  dbProsent: null,
  mvaFordeling: [],
})

const BASIS: Fakturarad = {
  fakturanummer: 10001,
  fakturadato: new Date(2026, 7, 27),
  forfallsdato: new Date(2026, 8, 10),
  ordrenummer: 42,
  ordredato: new Date(2026, 7, 20),
  kunde: {
    navn: 'Ola Nordmann',
    orgnr: '999888777',
    epost: 'ola@example.no',
    adresse: 'Testveien 5',
    postnummer: '5003',
    poststed: 'Bergen',
  },
  leveringsadresse: 'Testveien 5',
  prosjektnavn: 'Nybygg Storhaugen',
  grunnlag: grunnlag([
    // 250,00 kr netto. Sendt som ore ville dette blitt 25 000 kr.
    { kilde: 'timer', kildeIder: ['t1'], beskrivelse: 'Montor — 2,5 t', antall: 1, enhet: 'stk', enhetsprisOre: 25000, rabattProsent: 0, mva: 'hoy', nettoOre: 25000, mvaOre: 6250, bruttoOre: 31250 },
    { kilde: 'materiell', kildeIder: ['m1'], beskrivelse: 'Koblingsklemme', antall: 1, enhet: 'stk', enhetsprisOre: 1234, rabattProsent: 0, mva: 'fritatt', nettoOre: 1234, mvaOre: 0, bruttoOre: 1234 },
  ]),
}

// ── Belop: kroner, ikke ore ────────────────────────────────────────────────

sjekk('250,00 kr skrives som 250.00', belop(25000), '250.00')
sjekk('orene overlever', belop(1234), '12.34')
sjekk('null blir 0.00', belop(0), '0.00')
sjekk('halve orer rundes for deling', belop(1234.6), '12.35')

// ── Dato ───────────────────────────────────────────────────────────────────

sjekk('ISO-dato, som Tripletex krever', isoDato(new Date(2026, 0, 5)), '2026-01-05')
sjekk('manedsskifte padder riktig', isoDato(new Date(2026, 11, 31)), '2026-12-31')

// ── Formelinjeksjon ────────────────────────────────────────────────────────
//
// Et felt som begynner med = + - @ blir en FORMEL i Excel og Sheets. Kundenavn
// og linjebeskrivelser er fritekst en montor har skrevet i felt.

sjekk('likhetstegn noytraliseres', felt('=SUM(A1)'), "'=SUM(A1)")
sjekk('pluss noytraliseres', felt('+1+1'), "'+1+1")
sjekk('minus noytraliseres', felt('-cmd'), "'-cmd")
sjekk('krollalfa noytraliseres', felt('@import'), "'@import")
sjekk('vanlig tekst rores ikke', felt('Ola Nordmann'), 'Ola Nordmann')

// ── CSV-sitering ───────────────────────────────────────────────────────────

sjekk('semikolon i tekst siteres', felt('Stue; kjokken'), '"Stue; kjokken"')
sjekk('anforselstegn dobles', felt('4" ror'), '"4"" ror"')
sjekk('linjeskift siteres', felt('linje1\nlinje2'), '"linje1\nlinje2"')
sjekk('null blir tomt felt', felt(null), '')

// ── Hele fila ──────────────────────────────────────────────────────────────

{
  const csv = byggFakturaCsv([BASIS])
  const rader = csv.trim().split('\r\n')

  sjekk('header + en rad per ordrelinje', rader.length, 3)
  sjekk('headeren er Tripletex sine egne kolonnenavn', rader[0], KOLONNER.join(';'))

  const kol = (rad: string, navn: (typeof KOLONNER)[number]) => rad.split(';')[KOLONNER.indexOf(navn)]

  sjekk('fakturanummeret gjentas paa begge linjene', [kol(rader[1], 'INVOICE NO'), kol(rader[2], 'INVOICE NO')], ['10001', '10001'])
  sjekk('fakturadato er ISO', kol(rader[1], 'INVOICE DATE'), '2026-08-27')
  sjekk('forfallsdato er ISO', kol(rader[1], 'DUE DATE'), '2026-09-10')
  sjekk('ordrenummeret folger med', kol(rader[1], 'ORDER NO'), '42')
  sjekk('org.nr folger med', kol(rader[1], 'ORGANIZATION NO'), '999888777')

  // Den viktigste enkeltpaastanden i fila.
  sjekk('250,00 kr staar som 250.00, ikke 25000', kol(rader[1], 'ORDER LINE - UNIT PRICE'), '250.00')
  sjekk('12,34 kr beholder orene', kol(rader[2], 'ORDER LINE - UNIT PRICE'), '12.34')

  sjekk('antall er alltid 1 — belopet er hele linja', [kol(rader[1], 'ORDER LINE - COUNT'), kol(rader[2], 'ORDER LINE - COUNT')], ['1', '1'])
  sjekk('25 % mva blir kode 3', kol(rader[1], 'ORDER LINE - VAT CODE'), '3')
  sjekk('fritatt blir kode 5', kol(rader[2], 'ORDER LINE - VAT CODE'), '5')

  // Rabatten er allerede trukket fra i nettoOre. Sendes den ogsaa her, trekkes
  // den to ganger og kunden underfaktureres.
  sjekk('rabatt sendes ikke paa nytt', kol(rader[1], 'ORDER LINE - DISCOUNT'), '0')

  sjekk('prosjektnavnet folger med', kol(rader[1], 'PROJECT NAME'), 'Nybygg Storhaugen')
  sjekk('CRLF, som Excel paa Windows vil ha', csv.endsWith('\r\n'), true)
}

{
  // Rabatterte linjer: nettoOre skal vaere det kunden faktisk skal betale.
  const medRabatt = byggFakturaCsv([{
    ...BASIS,
    grunnlag: grunnlag([
      { kilde: 'materiell', kildeIder: ['m'], beskrivelse: 'Kabel', antall: 1, enhet: 'm', enhetsprisOre: 10000, rabattProsent: 20, mva: 'hoy', nettoOre: 8000, mvaOre: 2000, bruttoOre: 10000 },
    ]),
  }])
  const rad = medRabatt.trim().split('\r\n')[1].split(';')
  sjekk('rabattert linje sender nettobelopet', rad[KOLONNER.indexOf('ORDER LINE - UNIT PRICE')], '80.00')
  sjekk('og rabattfeltet staar paa null', rad[KOLONNER.indexOf('ORDER LINE - DISCOUNT')], '0')
}

{
  // Flere fakturaer i en fil — det regnskapsforeren faktisk faar per maaned.
  const to = byggFakturaCsv([BASIS, { ...BASIS, fakturanummer: 10002, ordrenummer: 43 }])
  const rader = to.trim().split('\r\n')
  sjekk('to fakturaer gir fire linjer pluss header', rader.length, 5)
  const nr = rader.slice(1).map(r => r.split(';')[0])
  sjekk('og hver faktura beholder sitt nummer', nr, ['10001', '10001', '10002', '10002'])
}

{
  // En kunde med fiendtlig navn skal ikke kunne bryte fila.
  const stygg = byggFakturaCsv([{
    ...BASIS,
    kunde: { ...BASIS.kunde, navn: '=cmd|"/c calc"!A1' },
    grunnlag: grunnlag([
      { kilde: 'materiell', kildeIder: ['m'], beskrivelse: 'Rør; 4" — «spesial»', antall: 1, enhet: 'stk', enhetsprisOre: 100, rabattProsent: 0, mva: 'hoy', nettoOre: 100, mvaOre: 25, bruttoOre: 125 },
    ]),
  }])
  sjekk('formelen er noytralisert', stygg.includes("'=cmd"), true)
  sjekk('og semikolon i beskrivelsen brot ikke kolonnene', stygg.trim().split('\r\n').length, 2)
}

// ── Filnavn ────────────────────────────────────────────────────────────────

sjekk(
  'filnavnet sier firma og periode',
  filnavn('Arntsen Elservice', new Date(2026, 7, 1), new Date(2026, 7, 31)),
  'Arntsen-Elservice-faktura-2026-08-01-til-2026-08-31.csv',
)
sjekk('skraastrek i firmanavn fjernes', filnavn('A/S Test', new Date(2026, 0, 1), new Date(2026, 0, 2)), 'AS-Test-faktura-2026-01-01-til-2026-01-02.csv')

console.log('')
if (feil > 0) {
  console.error(`${feil} påstand(er) feilet.`)
  process.exit(1)
}
console.log('Alle påstander holder.')
