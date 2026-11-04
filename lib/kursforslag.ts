/**
 * Kursfortegnelsen laget av tegningen (tegnemodusen, 30.10): punktene som ikke ligger på noen
 * kurs fordeles på kurser etter hva de er og hvilket rom de står i, og kursene får et
 * UTGANGSPUNKT for vern, kabel og jordfeilvern. Installatøren eier tallene — alt merkes som
 * forslag, og det som avhenger av produsentens data (komfyr, lader, varmepumpe) får ingen
 * tall i det hele tatt.
 *
 * Kabelen er halogenfri (IFXI-typen) — ikke PFSP/PFXP, som har PVC.
 *
 * Reglene er vanlig boligpraksis, ikke en modell av NEK 400-tabellene:
 *  - lys: B10, IFXI 3G1,5, høyst 12 lyspunkter per kurs (brytere følger rommet sitt);
 *  - stikk: C16, IFXI 3G2,5, høyst 8 stikk per kurs;
 *  - varme: én kurs per rom (varmekabel/ovn + termostat), C16, IFXI 3G2,5;
 *  - faste forbrukere: én kurs hver.
 * 1,5 mm² gir 14,5 A og 2,5 mm² 19,5 A i isolert vegg (A1), så B10/C16 holder der.
 * 30 mA jordfeilvern på alle sluttkurser; laderen trenger type B eller DC-vern i laderen.
 */

import { getSymbol } from './symbols'
import { nesteKursNr, romFor, type Kurs, type Prosjektering, type Punkt } from './prosjektering'

export type Gruppe = 'lys' | 'stikk' | 'varme' | 'fast'

const GRUPPE: Record<string, Gruppe> = {
  'lyspunkt': 'lys', 'downlight': 'lys', 'armatur': 'lys', 'utelys': 'lys', 'vifte': 'lys',
  'bryter': 'lys', 'bryter-2pol': 'lys', 'dimmer': 'lys', 'serievender': 'lys', 'sensor': 'lys', 'lysfoler': 'lys',
  'stikk': 'stikk', 'stikk-jord': 'stikk',
  'varmekabel': 'varme', 'ovn': 'varme', 'termostat': 'varme',
  'komfyr': 'fast', 'bereder': 'fast', 'elbillader': 'fast', 'varmepumpe': 'fast', 'motor': 'fast',
  'stikk-3fas': 'fast',
}
/** Det som teller mot taket på en kurs. Brytere, følere og termostater teller ikke. */
const TELLER = new Set(['lyspunkt', 'downlight', 'armatur', 'utelys', 'vifte', 'stikk', 'stikk-jord'])
const TAK: Record<Gruppe, number> = { lys: 12, stikk: 8, varme: Infinity, fast: 1 }

/**
 * Brann, data, fordeling og koblingsbokser ligger ikke på sterkstrømskurser. «Tilkobling» heller
 * ikke: analysen bruker den for symboler den ikke kjenner, så vi vet ikke hva det er.
 */
export function gruppeFor(type: string): Gruppe | null {
  return GRUPPE[type] ?? null
}

const A30 = '30 mA type A'
type Dim = Pick<Kurs, 'vern' | 'kabel' | 'rcd' | 'merknad'>
export function dimensjonFor(gruppe: Gruppe, type?: string): Dim {
  if (gruppe === 'lys') return { vern: 'B10', kabel: 'IFXI 3G1,5', rcd: A30, merknad: '' }
  if (gruppe === 'stikk') return { vern: 'C16', kabel: 'IFXI 3G2,5', rcd: A30, merknad: '' }
  if (gruppe === 'varme') return { vern: 'C16', kabel: 'IFXI 3G2,5', rcd: A30, merknad: '' }
  if (type === 'bereder') return { vern: 'C16', kabel: 'IFXI 3G2,5', rcd: A30, merknad: '' }
  if (type === 'elbillader') return { vern: '', kabel: '', rcd: '30 mA type B (eller A + 6 mA DC i laderen)', merknad: '' }
  return { vern: '', kabel: '', rcd: A30, merknad: '' }
}

const NAVN: Record<Exclude<Gruppe, 'fast'>, string> = { lys: 'Lys', stikk: 'Stikk', varme: 'Varme' }

function romtekst(navn: string[]): string {
  const n = navn.filter(Boolean)
  if (!n.length) return 'Uten rom'
  return n.length <= 3 ? n.join(', ') : `${n.slice(0, 2).join(', ')} +${n.length - 2} rom`
}

const ny = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))

export type Kursforslag = { p: Prosjektering; nye: string[]; fylt: number }

/**
 * Fordeler punktene uten kurs på nye kurser, og fyller vern/kabel/jordfeil på eksisterende
 * kurser der feltene er tomme (etter gruppen flest av punktene hører til). Rører aldri noe
 * installatøren har skrevet.
 */
export function lagKursfortegnelse(p: Prosjektering): Kursforslag {
  // Rommene i leserekkefølge (ovenfra, så venstre), så naborom havner på samme kurs.
  const romRekke = [...p.rom].sort((a, b) => (a.form.y + a.form.h / 2) - (b.form.y + b.form.h / 2) || a.form.x - b.form.x)
  const romIndeks = new Map(romRekke.map((r, i) => [r.id, i]))
  const romNavn = new Map(romRekke.map(r => [r.id, r.navn]))

  type Bunke = { gruppe: Gruppe; rom: string; punkter: Punkt[] }
  const bunker = new Map<string, Bunke>()
  for (const pt of p.punkter) {
    if (pt.kursId) continue
    const g = gruppeFor(pt.type)
    if (!g) continue
    const rom = romFor(pt, p.rom)?.id ?? ''
    // Faste forbrukere får hver sin kurs; resten samles per rom og gruppe.
    const nokkel = g === 'fast' ? `fast:${pt.id}` : `${g}:${rom}`
    const b = bunker.get(nokkel) ?? { gruppe: g, rom, punkter: [] }
    b.punkter.push(pt)
    bunker.set(nokkel, b)
  }

  const rekke: Gruppe[] = ['lys', 'stikk', 'varme', 'fast']
  const sortert = [...bunker.values()].sort((a, b) =>
    rekke.indexOf(a.gruppe) - rekke.indexOf(b.gruppe) || (romIndeks.get(a.rom) ?? 1e9) - (romIndeks.get(b.rom) ?? 1e9))

  type Utkast = { gruppe: Gruppe; rom: string[]; punkter: Punkt[]; teller: number; type?: string }
  const utkast: Utkast[] = []
  for (const b of sortert) {
    if (b.gruppe === 'fast') { utkast.push({ gruppe: 'fast', rom: [b.rom], punkter: b.punkter, teller: 1, type: b.punkter[0].type }); continue }
    if (b.gruppe === 'varme') { utkast.push({ gruppe: 'varme', rom: [b.rom], punkter: b.punkter, teller: 0 }); continue }
    const tak = TAK[b.gruppe]
    // Et rom med flere punkter enn taket deles i biter; brytere følger første bit.
    const tellende = b.punkter.filter(x => TELLER.has(x.type))
    const andre = b.punkter.filter(x => !TELLER.has(x.type))
    const biter: Punkt[][] = []
    for (let i = 0; i < tellende.length; i += tak) biter.push(tellende.slice(i, i + tak))
    if (!biter.length) biter.push([])
    biter[0].push(...andre)
    for (const bit of biter) {
      const n = bit.filter(x => TELLER.has(x.type)).length
      const forrige = utkast[utkast.length - 1]
      if (forrige && forrige.gruppe === b.gruppe && forrige.teller + n <= tak) {
        forrige.punkter.push(...bit); forrige.teller += n
        if (!forrige.rom.includes(b.rom)) forrige.rom.push(b.rom)
      } else {
        utkast.push({ gruppe: b.gruppe, rom: [b.rom], punkter: bit, teller: n })
      }
    }
  }

  const kurser = [...p.kurser]
  const tilKurs = new Map<string, string>()
  const nye: string[] = []
  for (const u of utkast) {
    const id = ny()
    const rom = romtekst(u.rom.map(r => romNavn.get(r) ?? ''))
    const navn = u.gruppe === 'fast'
      ? `${getSymbol(u.type!)?.label ?? u.type}${u.rom[0] ? `, ${rom}` : ''}`
      : `${NAVN[u.gruppe]} ${rom}`
    kurser.push({ id, nr: nesteKursNr(kurser), navn, forlegning: '', ...dimensjonFor(u.gruppe, u.type) })
    for (const pt of u.punkter) tilKurs.set(pt.id, id)
    nye.push(id)
  }

  // Eksisterende kurser: fyll det som er tomt, etter gruppen flest punkter hører til.
  let fylt = 0
  const ferdig = kurser.map(k => {
    if (nye.includes(k.id) || (k.vern && k.kabel && k.rcd)) return k
    const tell = new Map<Gruppe, number>()
    const egne = p.punkter.filter(x => x.kursId === k.id)
    for (const x of egne) { const g = gruppeFor(x.type); if (g) tell.set(g, (tell.get(g) ?? 0) + 1) }
    const flest = [...tell].sort((a, b) => b[1] - a[1])[0]
    if (!flest) return k
    const fast = flest[0] === 'fast' ? egne.find(x => gruppeFor(x.type) === 'fast')?.type : undefined
    const d = dimensjonFor(flest[0], fast)
    fylt++
    return { ...k, vern: k.vern || d.vern, kabel: k.kabel || d.kabel, rcd: k.rcd || d.rcd, merknad: k.merknad || d.merknad }
  })

  return {
    p: { ...p, kurser: ferdig, punkter: p.punkter.map(x => (tilKurs.has(x.id) ? { ...x, kursId: tilKurs.get(x.id) } : x)) },
    nye, fylt,
  }
}

/**
 * Spenningsfall i prosent på en 230 V-kurs, ved full last på vernet: 2·L·I·ρ / (A·230).
 * ρ = 0,0225 Ω·mm²/m (kobber varm). null når kabel eller vern ikke kan leses. Grensen i
 * fortegnelsen er 4 %, den vanlige tommelfingerregelen for sluttkurser.
 */
export function spenningsfall(lengdeM: number, kabel: string, vern: string): number | null {
  const tverr = kabel.replace(',', '.').match(/\d+\s*[GgxX×]\s*(\d+(?:\.\d+)?)/)
  const strom = vern.match(/^[A-Za-z]?\s*(\d+(?:[.,]\d+)?)/)
  if (!tverr || !strom) return null
  const A = parseFloat(tverr[1]), I = parseFloat(strom[1].replace(',', '.'))
  if (!(A > 0) || !(I > 0)) return null
  return (2 * lengdeM * I * 0.0225) / (A * 230) * 100
}
