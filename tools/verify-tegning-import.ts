/**
 * Selvtest for import av en hel tegningsmappe (OneDrive-mappa til Aqila).
 *
 *   npm run verify:tegning-import
 *
 * Feilene som koster: at innpakningen («Aqila Torvhaugan/Tegninger») blir to
 * tomme mapper alle må klikke gjennom; at andre import av samme mappe lager
 * duplikater; og at en «Brann»-mappe dratt inn alene blir løse tegninger.
 */
import { planleggImport, gjettFag, delSti } from '../lib/tegning-import'

let feil = 0
function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
  } else console.log(`✓ ${navn}`)
}
function teller() { let n = 0; return () => `id${++n}` }

// ── OneDrive-mappa slik den kommer fra nettleseren ──
const onedrive = [
  'Torvhaugan/Tegninger/Brann/BF1 Brannalarm 1. etg.pdf',
  'Torvhaugan/Tegninger/Brann/BF2 Brannalarm 2. etg.pdf',
  'Torvhaugan/Tegninger/Brann/Gammel/BF1 rev A.PDF',
  'Torvhaugan/Tegninger/Tele og data/TD1.pdf',
  'Torvhaugan/Tegninger/Elkraft/10. etg/E10.pdf',
  'Torvhaugan/Tegninger/Elkraft/2. etg/E2.pdf',
  'Torvhaugan/Tegninger/Elkraft/Tavleskjema.dwg',
  'Torvhaugan/Tegninger/.DS_Store',
  'Torvhaugan/Tegninger/Brann/~$notat.docx',
  'Torvhaugan/Tegninger/KNX/Romstyring.pdf',
]
const p = planleggImport(onedrive, [], [], teller())

sjekk('innpakningen skrelles: fagmappene ligger på rota',
  p.mapper.filter(m => m.parentId === null).map(m => m.name), ['Brann', 'Elkraft', 'KNX', 'Tele og data'])
sjekk('undermapper henger under riktig forelder',
  p.mapper.filter(m => m.parentId === p.mapper.find(x => x.name === 'Elkraft')!.id).map(m => m.name), ['2. etg', '10. etg'])
sjekk('sort_order følger tallene (2. etg før 10. etg)',
  p.mapper.filter(m => m.name.endsWith('etg')).map(m => m.sortOrder), [0, 1])
sjekk('foreldre kommer før barn i lista', p.mapper.every((m, i) => !m.parentId || p.mapper.findIndex(x => x.id === m.parentId) < i), true)
sjekk('sju PDF-er blir sju tegninger', p.tegninger.length, 7)
sjekk('filnavnet uten .pdf (også .PDF) er navnet', p.tegninger.find(t => t.sti.endsWith('rev A.PDF'))!.name, 'BF1 rev A')
sjekk('dwg hoppes over som ikke-PDF, systemfiler telles ikke',
  p.hoppetOver, [{ sti: 'Torvhaugan/Tegninger/Elkraft/Tavleskjema.dwg', grunn: 'ikke-pdf' }])
sjekk('faget: brann og tele er svakstrøm, KNX er automasjon, resten elkraft',
  Object.fromEntries(p.tegninger.map(t => [t.name, t.discipline])),
  { 'BF1 Brannalarm 1. etg': 'svakstrom', 'BF2 Brannalarm 2. etg': 'svakstrom', 'BF1 rev A': 'svakstrom', 'E2': 'elkraft', 'E10': 'elkraft', 'Romstyring': 'automasjon', 'TD1': 'svakstrom' })

// ── Andre gang: arkitekten har lagt til én tegning ──
const mapperEtter = p.mapper.map(m => ({ id: m.id, parentId: m.parentId, name: m.name }))
const tegningerEtter = p.tegninger.map(t => ({ folderId: t.folderId, name: t.name }))
const igjen = planleggImport([...onedrive, 'Torvhaugan/Tegninger/Brann/BF3 Brannalarm 3. etg.pdf'], mapperEtter, tegningerEtter, teller())
sjekk('andre import lager ingen nye mapper', igjen.mapper.length, 0)
sjekk('andre import tar bare den nye tegningen', igjen.tegninger.map(t => t.name), ['BF3 Brannalarm 3. etg'])
sjekk('den nye havner i den eksisterende Brann-mappa', igjen.tegninger[0].folderId, mapperEtter.find(m => m.name === 'Brann')!.id)
sjekk('de gamle telles som «finnes»', igjen.hoppetOver.filter(h => h.grunn === 'finnes').length, 7)
sjekk('én gjenbrukt mappe fikk noe nytt', igjen.gjenbrukteMapper, 1)
sjekk('mappenavn sammenlignes uten store/små bokstaver',
  planleggImport(['X/brann/BF9.pdf', 'X/Tavle/T.pdf'], mapperEtter, tegningerEtter, teller()).mapper.map(m => m.name), ['Tavle'])

// ── En fagmappe dratt inn alene ──
const brann = planleggImport(['Brann/BF1.pdf', 'Brann/BF2.pdf'], [], [], teller())
sjekk('«Brann» alene blir en Brann-mappe, ikke løse tegninger', brann.mapper.map(m => m.name), ['Brann'])
sjekk('…og tegningene ligger i den', brann.tegninger.every(t => t.folderId === brann.mapper[0].id), true)

// ── Løse filer, og import inn i en eksisterende mappe ──
const lose = planleggImport(['A.pdf', 'B.pdf'], [], [], teller())
sjekk('løse PDF-er uten mappe havner på rota', [lose.mapper.length, lose.tegninger.map(t => t.folderId)], [0, [null, null]])
const inni = planleggImport(['Brann/1. etg/BF1.pdf', 'Brann/2. etg/BF2.pdf'], [{ id: 'm', parentId: null, name: 'Bygg A' }], [], teller(), 'm')
sjekk('«Brann» med etasjer, sluppet i «Bygg A»: Brann lages under den, etasjene under Brann',
  inni.mapper.map(m => [m.name, m.parentId === 'm' ? 'Bygg A' : inni.mapper.find(x => x.id === m.parentId)?.name]),
  [['Brann', 'Bygg A'], ['1. etg', 'Brann'], ['2. etg', 'Brann']])

// ── Mapper som bare hadde søppel lages ikke ──
const sopp = planleggImport(['P/Brann/BF1.pdf', 'P/Foto/IMG_1.jpg', 'P/Foto/IMG_2.HEIC'], [], [], teller())
sjekk('mappe med bare bilder blir ikke en tom tegningsmappe', sopp.mapper.map(m => m.name), ['Brann'])

// ── Småbiter ──
sjekk('Windows-stier og ledende skråstrek', delSti('\\Prosjekt\\Brann\\BF1.pdf'), ['Prosjekt', 'Brann', 'BF1.pdf'])
sjekk('«AV-anlegg» er svakstrøm, «Avløp» er ikke', [gjettFag(['AV-anlegg', 'x.pdf']), gjettFag(['Avløp', 'x.pdf'])], ['svakstrom', 'elkraft'])
sjekk('dypeste ledd vinner (Elkraft/Brann → svakstrøm)', gjettFag(['Elkraft', 'Brann', 'x.pdf']), 'svakstrom')
sjekk('filnavnet teller også', gjettFag(['Diverse', 'Belysning plan 1.pdf']), 'elkraft')
sjekk('tom liste gir tom plan', planleggImport([], [], [], teller()), { mapper: [], tegninger: [], hoppetOver: [], gjenbrukteMapper: 0 })

if (feil) { console.error(`\n${feil} feil`); process.exit(1) }
console.log('\nAlt i orden.')
