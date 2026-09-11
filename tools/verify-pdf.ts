/**
 * Selvtest for dokumentene som forlater appen.
 *
 *   npm run verify:pdf
 *
 * En PDF er det eneste i Ampex som havner hos noen andre: kunden, DSB, en
 * advokat i en tvist. Fire klasser feil ville vært umulige å oppdage etterpå,
 * og alle fire er billige å teste:
 *
 *   1. **Lekkasje.** Dekningsbidrag, kostpris og interne notater skal ALDRI
 *      finnes i utdataene. Ett feilplassert felt er firmaets innkjøpspris hos
 *      kunden — det kan ikke trekkes tilbake.
 *   2. **Injeksjon.** Et kundenavn med `<` eller en tabellcelle med `"` skal
 *      ikke kunne bryte ut i markup. Kunden skriver navnet, vi skriver arket.
 *   3. **Falsk fullstendighet.** Et ubesvart punkt må VISES som ubesvart. Et
 *      dokument som ser mer komplett ut enn jobben var, er verre enn ingen.
 *   4. **Pengeformat.** Beløp må formateres med appens egen `formatKr`, ellers
 *      viser dokumentet andre tall enn skjermen for samme ordre.
 */
import { dokumentHtml, esc, datoNo, formatKr, signaturSvg } from '../lib/pdf/dokument'
import { skjemaInnholdHtml } from '../lib/pdf/skjema'
import { tilbudInnholdHtml } from '../lib/pdf/tilbud'
import { fakturaInnholdHtml } from '../lib/pdf/faktura'
import { signaturSti } from '../lib/signature-path'

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
function paastand(navn: string, betingelse: boolean) {
  sjekk(navn, betingelse, true)
}

const mvaEtikett = (m: string) => ({ hoy: '25 %', middels: '15 %', lav: '12 %', fritatt: '0 %' }[m] ?? m)

/* ── Escaping: kunden skriver innholdet, vi skriver arket ──────────────────── */

sjekk('esc bryter ikke ut av attributt', esc('Hansen "AS" & <b>co</b>'),
  'Hansen &quot;AS&quot; &amp; &lt;b&gt;co&lt;/b&gt;')
sjekk('esc tåler null', esc(null), '')
sjekk('esc tåler 0 (ikke tom)', esc(0), '0')

const ondtNavn = '<script>alert(1)</script>'
const medOndtNavn = dokumentHtml({
  meta: { type: 'Tilbud', tittel: ondtNavn },
  avsender: { navn: ondtNavn },
  mottaker: { navn: ondtNavn, adresse: ondtNavn },
  innhold: '<p>ok</p>',
})
paastand('dokumentet inneholder ingen rå <script fra data', !medOndtNavn.includes('<script>alert'))
paastand('det onde navnet er escapet', medOndtNavn.includes('&lt;script&gt;'))

/* ── Penger: samme tall som skjermen ───────────────────────────────────────── */

sjekk('formatKr 250,00', formatKr(25000), '250,00')
sjekk('formatKr tusenskille er U+00A0', formatKr(123456789).includes(' '), true)
sjekk('formatKr negativ bruker minustegn', formatKr(-5000).startsWith('−'), true)

/* ── Dato ──────────────────────────────────────────────────────────────────── */

sjekk('datoNo', datoNo('2026-08-29T10:00:00.000Z'), '29.08.2026')
sjekk('datoNo på tomt gir tom streng', datoNo(null), '')
sjekk('datoNo på søppel gir tom streng (aldri «Invalid Date»)', datoNo('ikke en dato'), '')

/* ── Skjema: ubesvart skal SES som ubesvart ────────────────────────────────── */

const skjema = skjemaInnholdHtml({
  seksjoner: [{
    tittel: 'Sluttkontroll',
    punkter: [
      { nokkel: 'a', sporsmal: 'Jordfeilbryter testet', type: 'choice', svar: 'Ja' },
      { nokkel: 'b', sporsmal: 'Målt isolasjonsmotstand', type: 'number', enhet: 'MΩ', svar: '2.4' },
      { nokkel: 'c', sporsmal: 'Merking av kurser', type: 'choice', svar: '' },
      { nokkel: 'd', sporsmal: 'Status', type: 'choice', svar: 'Avvik' },
      {
        nokkel: 'e', sporsmal: 'Kursfortegnelse', type: 'table',
        kolonner: [{ key: 'kurs', label: 'Kurs' }, { key: 'vern', label: 'Vern' }],
        svar: [{ kurs: '1', vern: 'B16' }],
      },
    ],
  }],
})
paastand('ubesvart punkt vises som «Ikke besvart»', skjema.includes('Ikke besvart'))
paastand('enhet blir med på tallsvar', skjema.includes('2.4 MΩ'))
paastand('avvik markeres synlig', skjema.includes('class="punkt-svar avvik"'))
paastand('tabellsvar rendres som tabell med kolonneoverskrifter',
  skjema.includes('<th>Kurs</th>') && skjema.includes('<td>B16</td>'))

const tomTabell = skjemaInnholdHtml({
  seksjoner: [{ tittel: 'S', punkter: [{ nokkel: 't', sporsmal: 'Kurser', type: 'table', svar: [] }] }],
})
paastand('tom tabell sier «Ingen rader», ikke ingenting', tomTabell.includes('Ingen rader'))

/* ── Signatur: strøkene må faktisk tegnes ──────────────────────────────────── */

sjekk('signaturSti normaliserer til piksler', signaturSti([[0, 0], [1, 1]], 100, 50), 'M0 0 L100 50')
paastand('ett enkelt punkt gir fortsatt en strek (en prikk forsvinner ellers)',
  signaturSti([[0.5, 0.5]], 100, 50).includes('L50.6'))

const medSignatur = skjemaInnholdHtml({
  seksjoner: [],
  signaturer: [{
    navn: 'Kari Hansen', formal: 'ferdig', signertTid: '29.08.2026',
    strok: [{ points: [[0, 0], [0.5, 0.5], [1, 0.2]] }], aspekt: 2,
  }],
})
paastand('signaturen blir en SVG-bane', medSignatur.includes('<path d="M0 0'))
paastand('signaturnavnet står under', medSignatur.includes('Kari Hansen'))

/* ── Tilbud: dekningsbidraget skal ALDRI ut ────────────────────────────────── */

const tilbud = tilbudInnholdHtml({
  linjer: [
    { art: 'materiell', beskrivelse: 'Downlight 8W', antall: 12, enhet: 'stk', enhetsprisOre: 24900, rabattProsent: 10, nettoOre: 268920, elnummer: '1265467' },
    { art: 'arbeid', beskrivelse: 'Montasje', antall: 4, enhet: 't', enhetsprisOre: 89000, rabattProsent: 0, nettoOre: 356000 },
    { art: 'tekst', beskrivelse: 'Stillas leies inn av kunde', antall: 0, enhet: '', enhetsprisOre: 0, rabattProsent: 0, nettoOre: 0 },
  ],
  sum: {
    nettoOre: 624920, rabattOre: 29880, bruttoOre: 781150,
    mvaFordeling: [{ mva: 'hoy', nettoOre: 624920, mvaOre: 156230 }],
  },
  mvaEtikett,
  gyldigTil: '2026-09-30T00:00:00.000Z',
})
paastand('tilbudet viser totalsummen', tilbud.includes(formatKr(781150)))
paastand('fritekstlinje har ingen beløpskolonne', tilbud.includes('colspan="4"'))
paastand('el-nummer følger materiellinja', tilbud.includes('El-nr 1265467'))
paastand('gyldighetsdatoen er norsk', tilbud.includes('30.09.2026'))
paastand('tilbudet nevner ALDRI dekningsbidrag',
  !/dekningsbidrag|kostpris|innkjøp/i.test(tilbud))

/* ── Fakturagrunnlag ───────────────────────────────────────────────────────── */

const faktura = fakturaInnholdHtml({
  linjer: [
    { kilde: 'timer', beskrivelse: 'Montasje — 3,5 t\nSkiftet defekt kurs', antall: 3.5, enhet: 't', enhetsprisOre: 89000, mva: 'hoy', nettoOre: 311500 },
    { kilde: 'materiell', beskrivelse: 'PN 2,5 blå', antall: 100, enhet: 'm', enhetsprisOre: 1200, mva: 'hoy', nettoOre: 120000, elnummer: '1010101' },
  ],
  sum: { nettoOre: 431500, bruttoOre: 539375, mvaFordeling: [{ mva: 'hoy', nettoOre: 431500, mvaOre: 107875 }] },
  mvaEtikett,
  ikkeFakturert: [{ beskrivelse: 'Befaring', grunn: 'Ikke fakturerbar' }],
})
paastand('arbeid og materiell står i hver sin gruppe',
  faktura.includes('<h2>Arbeid</h2>') && faktura.includes('<h2>Materiell</h2>'))
paastand('timenotatet står som undertekst, ikke i overskriften',
  faktura.includes('class="punkt-hjelp">Skiftet defekt kurs'))
paastand('«Å betale» er summen inkl. mva', faktura.includes(formatKr(539375)))
paastand('ikke-fakturert arbeid forklares', faktura.includes('Befaring'))
paastand('fakturagrunnlaget nevner ALDRI dekningsbidrag',
  !/dekningsbidrag|kostpris|dbOre/i.test(faktura))

/* ── Hele dokumentet ───────────────────────────────────────────────────────── */

const helt = dokumentHtml({
  meta: { type: 'Sluttkontroll', nummer: '2026-014', tittel: 'Sikringsskap', dato: '2026-08-29T00:00:00.000Z' },
  avsender: { navn: 'Holand Elektro AS', orgnr: '912 345 678', adresse: 'Bjørkeveien 3, 1440 Drøbak' },
  mottaker: { navn: 'Åsane Bygg AS' },
  metalinjer: ['Ordre 2026-014', 'Anlegg: Bjørndalen 12'],
  innhold: skjema,
})
paastand('dokumentet er komplett HTML', helt.startsWith('<!DOCTYPE html>') && helt.trimEnd().endsWith('</html>'))
paastand('brevhodet har firma og org.nr', helt.includes('Holand Elektro AS') && helt.includes('912 345 678'))
paastand('A4 er satt i @page', helt.includes('size: A4'))
paastand('metalinjene står i hodet', helt.includes('Ordre 2026-014'))
// Et utskriftstidspunkt inne i dokumentet gjør to identiske dokumenter ulike,
// og da kan de ikke sammenlignes i en tvist.
const helt2 = dokumentHtml({
  meta: { type: 'Sluttkontroll', nummer: '2026-014', tittel: 'Sikringsskap', dato: '2026-08-29T00:00:00.000Z' },
  avsender: { navn: 'Holand Elektro AS', orgnr: '912 345 678', adresse: 'Bjørkeveien 3, 1440 Drøbak' },
  mottaker: { navn: 'Åsane Bygg AS' },
  metalinjer: ['Ordre 2026-014', 'Anlegg: Bjørndalen 12'],
  innhold: skjema,
})
sjekk('samme data gir BYTE-IDENTISK dokument (ingen «generert klokken»)', helt === helt2, true)

/* ── Signatur-SVG ──────────────────────────────────────────────────────────── */

sjekk('tom signatur gir tom streng, ikke en tom <svg>', signaturSvg([], 100, 50), '')

console.log(feil === 0 ? '\nAlle påstander grønne.' : `\n${feil} påstand(er) feilet.`)
process.exit(feil === 0 ? 0 : 1)
