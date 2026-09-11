/**
 * Piksler → veggstreker. Skilt ut fra `rom-fra-tegning.ts` fordi den er ren
 * regning uten React Native: da kan den kjøres og måles utenfor appen.
 */

import type { Segment } from './rom-detekt'

// ── piksler → streker ───────────────────────────────────────────────────────

/**
 * Mørke piksler: alt som ikke er nesten hvitt, og som ikke er sterkt farget.
 * Gråtonen tas vare på: veggene er tegnet med én penn, og `finnRom` bruker
 * den til å skille vegg fra kanaler og utstyr.
 */
export function morkMaske(px: Uint8Array, W: number, H: number): { maske: Uint8Array; lys: Uint8Array } {
  const maske = new Uint8Array(W * H)
  const lys = new Uint8Array(W * H)
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = px[p], g = px[p + 1], b = px[p + 2]
    const maks = r > g ? (r > b ? r : b) : (g > b ? g : b)
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b)
    const snitt = (r + g + b) / 3
    // Sterk farge = ventilasjon, el-symboler, markeringer. Vegger er grå/svarte.
    if (maks - min > 60) continue
    if (snitt > 235) continue
    maske[i] = 1
    lys[i] = snitt
  }
  return { maske, lys }
}

/**
 * Lange rette strekk av mørke piksler, vannrett og loddrett. Møbler, tekst og
 * symboler gir korte strekk og forsvinner; vegger gir lange.
 * Nabolinjer med nesten samme strekk hoppes over, ellers blir én 3 px tykk
 * vegglinje til tre streker som parer seg med hverandre.
 */
export function linjerFraMaske(m: Uint8Array, W: number, H: number, minPx: number, lys?: Uint8Array): Segment[] {
  const ut: Segment[] = []
  const HULL = 2
  const felles = (a: number, b: number, forrige: Array<[number, number]>) =>
    forrige.some(([pa, pb]) => Math.abs(a - pa) <= 2 && Math.abs(b - pb) <= 2)
  /** Strekkets gråtone, kvantisert — ellers blir ingen to streker «samme penn». */
  const farge = (fra: number, til: number, steg: number) => {
    if (!lys) return 0.5
    let sum = 0, n = 0
    for (let k = fra; k <= til; k += steg) { sum += lys[k]; n++ }
    return n ? Math.round(sum / n / 255 * 10) / 10 : 0.5
  }

  let forrige: Array<[number, number]> = []
  for (let y = 0; y < H; y++) {
    const naa: Array<[number, number]> = []
    let start = -1, sist = -1
    for (let x = 0; x <= W; x++) {
      const paa = x < W && m[y * W + x] === 1
      if (paa) { if (start < 0) start = x; sist = x; continue }
      if (start >= 0 && (x - sist > HULL || x === W)) {
        if (sist - start + 1 >= minPx) {
          naa.push([start, sist])
          if (!felles(start, sist, forrige)) ut.push({ x0: start, y0: y, x1: sist, y1: y, bredde: 1, lys: 0, farge: farge(y * W + start, y * W + sist, 1) })
        }
        start = -1
      }
    }
    forrige = naa
  }

  forrige = []
  for (let x = 0; x < W; x++) {
    const naa: Array<[number, number]> = []
    let start = -1, sist = -1
    for (let y = 0; y <= H; y++) {
      const paa = y < H && m[y * W + x] === 1
      if (paa) { if (start < 0) start = y; sist = y; continue }
      if (start >= 0 && (y - sist > HULL || y === H)) {
        if (sist - start + 1 >= minPx) {
          naa.push([start, sist])
          if (!felles(start, sist, forrige)) ut.push({ x0: x, y0: start, x1: x, y1: sist, bredde: 1, lys: 0, farge: farge(start * W + x, sist * W + x, W) })
        }
        start = -1
      }
    }
    forrige = naa
  }
  return ut
}

