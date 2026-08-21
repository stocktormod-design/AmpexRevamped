/**
 * Selvtest av skjemaimporten — kjør: npm run verify:form-import
 *
 * Påstanden som testes er ikke «modellen svarer riktig» (det kan ingen test
 * love), men: **uansett hva modellen svarer, kommer det ut en mal som
 * validateFirmSections() godtar** — eller så er problemet noe et menneske
 * faktisk må ta stilling til.
 */
import { normaliserImport, oppsummer, tilId } from '../lib/forms/import'
import { validateFirmSections } from '../lib/forms/firm-schema'

let feil = 0
function sjekk(navn: string, ok: boolean, detalj?: unknown) {
  if (ok) return
  feil++
  console.error(`  ✗ ${navn}${detalj === undefined ? '' : `\n      ${JSON.stringify(detalj)}`}`)
}

console.log('skjemaimport')

// ── 1. Et realistisk, ryddig svar ──────────────────────────────────────────
const pent = normaliserImport({
  tittel: 'Sluttkontroll bolig',
  kategori: 'Sluttkontroll',
  merknad: 'To sider, tabell med kursfortegnelse på side 2.',
  seksjoner: [
    {
      tittel: 'Visuell kontroll',
      felt: [
        { id: 'jording', type: 'check', label: 'Jording kontrollert', paakrevd: true },
        { type: 'multiline', label: 'Beskriv avviket', vises_hvis: { felt: 'jording', er: ['Nei'] } },
        { type: 'number', label: 'Målt isolasjonsresistans', enhet: 'MΩ' },
      ],
    },
    {
      tittel: 'Kursfortegnelse',
      felt: [{ type: 'table', label: 'Kurser', kolonner: [{ label: 'Kurs' }, { label: 'Vern' }, 'Tverrsnitt'] }],
    },
  ],
})
sjekk('tittel og kategori beholdes', pent.tittel === 'Sluttkontroll bolig' && pent.kategori === 'Sluttkontroll')
sjekk('ingen rettelser på et rent svar', pent.rettelser.length === 0, pent.rettelser)
sjekk('valideringen godtar resultatet', validateFirmSections(pent.seksjoner).length === 0, validateFirmSections(pent.seksjoner))
sjekk('betingelsen overlevde', pent.seksjoner[0].fields[1].showIf?.field === 'jording')
sjekk('enhet beholdes på talltype', pent.seksjoner[0].fields[2].unit === 'MΩ')
sjekk('kolonner uten key fikk key', pent.seksjoner[1].fields[0].columns?.map(c => c.key).join(',') === 'kurs,vern,tverrsnitt')
sjekk('id utledes av etiketten når den mangler', pent.seksjoner[0].fields[1].id === 'beskriv_avviket')

// ── 2. Alt modellen pleier å bomme på, i ett svar ──────────────────────────
const rotete = normaliserImport({
  tittel: '',
  kategori: 'Noe helt annet',
  seksjoner: [
    {
      tittel: 'Del A',
      felt: [
        { id: 'punkt', type: 'check', label: 'Første punkt' },
        { id: 'punkt', type: 'text', label: 'Andre punkt med samme id' },
        { type: 'choice', label: 'Klikkliste uten alternativer', valg: [] },
        { type: 'table', label: 'Tabell uten kolonner' },
        { type: 'gjettetype', label: 'Ukjent type' },
        { type: 'text', label: '' },
        { type: 'text', label: 'Peker nedover', vises_hvis: { felt: 'senere', er: ['Ja'] } },
        { type: 'text', label: 'Peker på ingenting', vises_hvis: { felt: 'finnes_ikke', er: ['Ja'] } },
        { type: 'text', label: 'Venter på umulig svar', vises_hvis: { felt: 'punkt', er: ['Kanskje'] } },
        { type: 'text', label: 'Delvis gyldig', vises_hvis: { felt: 'punkt', er: ['Ja', 'Kanskje'] } },
        { id: 'senere', type: 'check', label: 'Kommer etterpå' },
      ],
    },
    { tittel: 'Tom overskrift', felt: [] },
  ],
})

sjekk('tittel faller tilbake', rotete.tittel === 'Importert skjema')
sjekk('ukjent kategori blir Diverse', rotete.kategori === 'Diverse')
sjekk('duplikat-id ble gjort unik', rotete.seksjoner[0].fields[1].id === 'punkt_2')
sjekk('klikkliste uten alternativer ble fritekst', rotete.seksjoner[0].fields[2].type === 'text')
sjekk('tabell uten kolonner ble fritekst', rotete.seksjoner[0].fields[3].type === 'multiline')
sjekk('ukjent type ble fritekst', rotete.seksjoner[0].fields[4].type === 'text')
sjekk('punkt uten tekst ble fjernet', !rotete.seksjoner[0].fields.some(f => !f.label))
sjekk('tom seksjon ble fjernet', rotete.seksjoner.length === 1, rotete.seksjoner.map(s => s.title))
sjekk(
  'betingelse som peker nedover ble fjernet',
  rotete.seksjoner[0].fields.find(f => f.label === 'Peker nedover')?.showIf === undefined,
)
sjekk(
  'betingelse mot ukjent punkt ble fjernet',
  rotete.seksjoner[0].fields.find(f => f.label === 'Peker på ingenting')?.showIf === undefined,
)
sjekk(
  'betingelse med umulig svar ble fjernet',
  rotete.seksjoner[0].fields.find(f => f.label === 'Venter på umulig svar')?.showIf === undefined,
)
const delvis = rotete.seksjoner[0].fields.find(f => f.label === 'Delvis gyldig')
sjekk('delvis gyldig betingelse ble strammet inn, ikke kastet', delvis?.showIf?.equals.join(',') === 'Ja', delvis?.showIf)

// Det som gjør hele øvelsen verdt noe: etter opprydding er malen lovlig.
const problemer = validateFirmSections(rotete.seksjoner)
sjekk('et rotete svar er lovlig etter opprydding', problemer.length === 0, problemer)
sjekk('hver rettelse er en lesbar setning', rotete.rettelser.every(r => r.length > 20 && r.endsWith('.')), rotete.rettelser)
sjekk('antall rettelser stemmer med antall inngrep', rotete.rettelser.length === 10, rotete.rettelser)

// ── 3. Søppel inn skal ikke kaste ──────────────────────────────────────────
for (const søppel of [null, undefined, {}, { seksjoner: 'ikke en liste' }, { seksjoner: [null, { felt: [null] }] }, []]) {
  let kastet = false
  let res
  try { res = normaliserImport(søppel) } catch { kastet = true }
  sjekk(`tåler ${JSON.stringify(søppel)}`, !kastet && res!.seksjoner.length === 0)
}

// ── 4. Usikkerhet og oppsummering ──────────────────────────────────────────
const usikkert = normaliserImport({
  tittel: 'Skannet',
  seksjoner: [{ tittel: 'A', felt: [
    { type: 'text', label: 'Uleselig punkt', usikkert: 'Teksten var uskarp i kilden.' },
    { type: 'text', label: 'Tydelig punkt' },
  ] }],
})
sjekk('usikkert punkt merkes på id', usikkert.usikre['uleselig_punkt'] === 'Teksten var uskarp i kilden.')
sjekk('tydelig punkt merkes ikke', usikkert.usikre['tydelig_punkt'] === undefined)
const sum = oppsummer(usikkert)
sjekk('oppsummering teller riktig', sum.seksjoner === 1 && sum.punkt === 2 && sum.usikre === 1, sum)

// ── 5. id-utledning på norsk ───────────────────────────────────────────────
sjekk('æøå blir lesbart', tilId('Måling av jordfeilbryter') === 'maaling_av_jordfeilbryter', tilId('Måling av jordfeilbryter'))
sjekk('tegnsetting forsvinner', tilId('Er anlegget spenningsløst? (pkt. 6.3)') === 'er_anlegget_spenningsloest_pkt_6_3', tilId('Er anlegget spenningsløst? (pkt. 6.3)'))
sjekk('bare tegnsetting gir noe brukbart', tilId('???') === 'punkt')
sjekk('lang etikett kuttes uten å ende på understrek', !tilId('a'.repeat(60) + ' og enda mer tekst her').endsWith('_'))

if (feil) {
  console.error(`\n${feil} feil`)
  process.exit(1)
}
console.log('  ✓ alle påstander holder')
