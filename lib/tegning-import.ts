/**
 * En hel mappe med tegninger inn i et prosjekt — slik den ligger i OneDrive.
 *
 * Aqila har tegningene som PDF-er i OneDrive: prosjektmappe → en mappe →
 * fagmapper (brann, tavle, svakstrøm …), med flere nivåer inni. Kontoret drar
 * hele mappa inn, og denne fila bestemmer hva den blir til: hvilke mapper som
 * lages, hvilke som gjenbrukes, hvilke filer som blir tegninger og hvilke som
 * hoppes over. Ingen nettverk, ingen database — så `npm run verify:tegning-import`
 * kan kjøre den i Node, og kontoret kan vise planen FØR noe skrives.
 *
 * Tre regler bærer det:
 *
 * 1. **Innpakningen forsvinner.** Mappa du drar inn er prosjektet selv, og ofte
 *    ligger alt under én «Tegninger»-mappe til. Felles ledd for alle filene
 *    skrelles av, så fagmappene havner rett under prosjektet. Skrellingen
 *    stopper ved et navn som sier noe om fag («Brann» er innhold, «Torvhaugan»
 *    og «Tegninger» er innpakning), og aldri så langt at ingen mappe står igjen.
 * 2. **Andre gang er en fletting, ikke en kopi.** En mappe med samme navn under
 *    samme forelder gjenbrukes, og en tegning med samme navn i samme mappe
 *    hoppes over. Da kan kontoret dra inn OneDrive-mappa igjen når arkitekten
 *    har lagt til tre tegninger, og få akkurat de tre.
 * 3. **Faget gjettes av stien.** «Brann», «Tele og data», «KNX» står allerede i
 *    mappenavnene; dypeste ledd som sier noe vinner. Treffer ingenting, blir det
 *    elkraft — basens standard, og det de fleste tegningene en elektriker får er.
 */
import type { MappeNode } from './tegning-tre'

/** Samme verdier som `drawings.discipline` (lib/db/models/drawing.ts) — gjentatt her
 *  fordi modellfila drar med seg WatermelonDB, og kontoret og selvtesten kan ikke. */
export type Discipline = 'elkraft' | 'svakstrom' | 'automasjon' | 'annet'

export type EksisterendeTegning = { folderId: string | null; name: string }

export type NyMappe = { id: string; parentId: string | null; name: string; sortOrder: number }
export type NyTegning = { sti: string; id: string; folderId: string | null; name: string; discipline: Discipline }
export type Hoppet = { sti: string; grunn: 'ikke-pdf' | 'finnes' | 'duplikat' }

export type ImportPlan = {
  /** Bare mappene som må lages, foreldre før barn — så de kan skrives i rekkefølge. */
  mapper: NyMappe[]
  tegninger: NyTegning[]
  /** Filer som ikke blir tegninger. Systemfiler (.DS_Store, ~$-filer) telles ikke engang. */
  hoppetOver: Hoppet[]
  /** Mapper som fantes fra før og fikk nye tegninger i seg. */
  gjenbrukteMapper: number
}

/** Systemfiler og skjulte mapper: ingen har lagt dem der med vilje. */
function systemfil(ledd: string): boolean {
  return ledd.startsWith('.') || ledd.startsWith('~$') || ledd === '__MACOSX' || /^(thumbs\.db|desktop\.ini)$/i.test(ledd)
}

const norm = (s: string) => s.normalize('NFC').trim().toLocaleLowerCase('nb')
const sorter = (a: string, b: string) => a.localeCompare(b, 'nb', { numeric: true, sensitivity: 'base' })

/** Stien i ledd, uansett om den kom med / eller \ og ledende skråstrek. */
export function delSti(sti: string): string[] {
  return sti.replace(/\\/g, '/').split('/').map(s => s.trim()).filter(Boolean)
}

// Ordene som avslører faget. Hele ord, så «av» (AV-anlegg) ikke treffer «avløp».
const FAG_ORD: [Discipline, string[]][] = [
  ['svakstrom', ['brann', 'brannalarm', 'alarm', 'innbrudd', 'tele', 'data', 'ikt', 'ekom', 'fiber', 'svakstrøm', 'svakstrom',
    'adgang', 'adk', 'itv', 'cctv', 'kamera', 'av', 'lyd', 'porttelefon', 'callingsystem', 'sykesignal', 'talevarsling', 'nett']],
  ['automasjon', ['automasjon', 'byggautomasjon', 'sd', 'knx', 'bus', 'styring', 'bacnet', 'modbus', 'driftskontroll']],
  ['elkraft', ['elkraft', 'kraft', 'sterkstrøm', 'sterkstrom', 'belysning', 'lys', 'nødlys', 'tavle', 'tavler', 'føringsvei',
    'føringsveier', 'kurs', 'stikk', 'jording', 'lyn', 'lynvern', 'varme', 'elbil', 'lading']],
]

/** Faget ett navn avslører, eller null. */
function fagI(navn: string): Discipline | null {
  const ord = new Set(norm(navn).split(/[^a-zæøå0-9]+/).filter(Boolean))
  for (const [fag, liste] of FAG_ORD) if (liste.some(o => ord.has(o))) return fag
  return null
}

/** Faget ut av stien: dypeste ledd (eller filnavnet) som inneholder et kjent ord. */
export function gjettFag(ledd: string[]): Discipline {
  for (let i = ledd.length - 1; i >= 0; i--) {
    const fag = fagI(ledd[i])
    if (fag) return fag
  }
  return 'elkraft'
}

/**
 * Hva en innsluppet mappe blir til.
 *
 * `filer` er relative stier slik nettleseren gir dem (`webkitRelativePath` eller
 * gjennomgått `FileSystemEntry`). `malMappe` er mappa det slippes i — `null` er
 * prosjektets rot. `nyId` lages utenfra så testen kan bruke faste id-er.
 */
export function planleggImport(
  filer: string[],
  mapper: MappeNode[],
  tegninger: EksisterendeTegning[],
  nyId: () => string,
  malMappe: string | null = null,
): ImportPlan {
  const hoppetOver: Hoppet[] = []
  const pdfer: { sti: string; ledd: string[] }[] = []
  for (const sti of filer) {
    const ledd = delSti(sti)
    if (!ledd.length || ledd.some(systemfil)) continue
    if (!/\.pdf$/i.test(ledd[ledd.length - 1])) { hoppetOver.push({ sti, grunn: 'ikke-pdf' }); continue }
    pdfer.push({ sti, ledd })
  }

  // Regel 1: skrell av felles mappeledd — men aldri så langt at ingen mappe står igjen.
  const mappeledd = pdfer.map(p => p.ledd.slice(0, -1))
  let felles = 0
  if (mappeledd.length) {
    const kortest = Math.min(...mappeledd.map(m => m.length))
    // Et ledd som sier noe om fag («Brann») er innhold, ikke innpakning — der stopper skrellingen.
    while (felles < kortest && !fagI(mappeledd[0][felles]) && mappeledd.every(m => norm(m[felles]) === norm(mappeledd[0][felles]))) felles++
    if (felles > 0 && mappeledd.every(m => m.length === felles)) felles--
  }

  // Mappene, gjenbrukt eller nye, nøkkel = forelder + navn.
  const finnes = new Map<string, string>() // `${parent}\u0000${navn}` → id
  for (const m of mapper) finnes.set(`${m.parentId ?? ''}\u0000${norm(m.name)}`, m.id)
  const nye: NyMappe[] = []
  const gjenbrukt = new Set<string>()
  const antallUnder = new Map<string, number>()
  for (const m of mapper) antallUnder.set(m.parentId ?? '', (antallUnder.get(m.parentId ?? '') ?? 0) + 1)

  // Lag mappene i sortert rekkefølge, så sort_order følger navnene (1. etg før 10. etg).
  const alleStier = [...new Set(mappeledd.map(m => m.slice(felles)).flatMap(m => m.map((_, i) => m.slice(0, i + 1).join('/'))))]
    .map(s => s.split('/'))
    .sort((a, b) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = sorter(a[i], b[i]); if (c) return c }
      return a.length - b.length
    })
  const idForSti = new Map<string, string | null>([['', malMappe]])
  for (const ledd of alleStier) {
    const forelder = idForSti.get(norm(ledd.slice(0, -1).join('/'))) ?? malMappe
    const navn = ledd[ledd.length - 1]
    const nokkel = `${forelder ?? ''}\u0000${norm(navn)}`
    let id = finnes.get(nokkel)
    if (id) gjenbrukt.add(id)
    else {
      id = nyId()
      const n = antallUnder.get(forelder ?? '') ?? 0
      antallUnder.set(forelder ?? '', n + 1)
      nye.push({ id, parentId: forelder, name: navn, sortOrder: n })
      finnes.set(nokkel, id)
    }
    idForSti.set(norm(ledd.join('/')), id)
  }

  // Regel 2: samme navn i samme mappe = finnes allerede.
  const tatt = new Set(tegninger.map(t => `${t.folderId ?? ''}\u0000${norm(t.name)}`))
  const iDenne = new Set<string>()
  const ut: NyTegning[] = []
  const sortert = [...pdfer].sort((a, b) => sorter(a.ledd.join('/'), b.ledd.join('/')))
  const brukteGjenbrukte = new Set<string>()
  for (const p of sortert) {
    const egne = p.ledd.slice(felles, -1)
    const folderId = idForSti.get(norm(egne.join('/'))) ?? malMappe
    const name = p.ledd[p.ledd.length - 1].replace(/\.pdf$/i, '').trim()
    const nokkel = `${folderId ?? ''}\u0000${norm(name)}`
    if (tatt.has(nokkel)) { hoppetOver.push({ sti: p.sti, grunn: 'finnes' }); continue }
    if (iDenne.has(nokkel)) { hoppetOver.push({ sti: p.sti, grunn: 'duplikat' }); continue }
    iDenne.add(nokkel)
    if (folderId && gjenbrukt.has(folderId)) brukteGjenbrukte.add(folderId)
    // Faget leses av HELE stien, også leddene som ble skrelt av («Brann» dratt inn alene).
    ut.push({ sti: p.sti, id: nyId(), folderId, name, discipline: gjettFag(p.ledd) })
  }

  // Nye mapper som bare inneholdt systemfiler eller ikke-PDF-er, lages ikke.
  const brukt = new Set<string>()
  const byId = new Map(nye.map(m => [m.id, m]))
  for (const t of ut) {
    let id = t.folderId
    while (id && byId.has(id) && !brukt.has(id)) { brukt.add(id); id = byId.get(id)!.parentId }
  }

  return {
    mapper: nye.filter(m => brukt.has(m.id)),
    tegninger: ut,
    hoppetOver,
    gjenbrukteMapper: brukteGjenbrukte.size,
  }
}
