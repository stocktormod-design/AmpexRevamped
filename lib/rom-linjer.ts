/**
 * Piksler → veggstreker. Skilt ut fra `rom-fra-tegning.ts` fordi den er ren
 * regning uten React Native: da kan den kjøres og måles utenfor appen.
 */

import type { Segment, Raster } from './rom-detekt'

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


// ── piksler → veggraster (uten streker) ─────────────────────────────────────

/** Antall påslåtte piksler i hvert k×k-vindu rundt hver piksel (integralbilde). */
function boksSum(m: Uint8Array, W: number, H: number, k: number): Int32Array {
  const I = new Int32Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let rad = 0
    for (let x = 0; x < W; x++) { rad += m[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + rad }
  }
  const r0 = k >> 1, r1 = k - r0, ut = new Int32Array(W * H)
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r0), yb = Math.min(H, y + r1)
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r0), xb = Math.min(W, x + r1)
      ut[y * W + x] = I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa]
    }
  }
  return ut
}
function utvid(m: Uint8Array, W: number, H: number, k: number): Uint8Array {
  const s = boksSum(m, W, H, k), ut = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) ut[i] = s[i] > 0 ? 1 : 0
  return ut
}
function krymp(m: Uint8Array, W: number, H: number, k: number): Uint8Array {
  const inv = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) inv[i] = m[i] ? 0 : 1
  const s = boksSum(inv, W, H, k), ut = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) ut[i] = s[i] === 0 ? 1 : 0
  return ut
}

/**
 * Veggene rett fra pikslene, for innskannede tegninger. Strekveien (`linjerFraMaske` +
 * `finnRom`) leter etter to tynne parallelle streker, og kaster par med streker imellom
 * som skravur — men på arkitekttegninger er det nettopp ytterveggene som er skravert, så
 * de forsvant og rommene lekket (CubiCasa5K, 2026-10-25: 1,6 % av rommene truffet).
 * Her: lukking fyller skravur og mellomrommet i en strekvegg, åpning fjerner alt som er
 * tynnere enn en vegg (møbler, mål, dørsving, tekst), og resultatet samples ned til
 * `finnRomIRaster` sitt rutenett.
 */
export function veggRasterFraMaske(m: Uint8Array, W: number, H: number, pxPerM: number, oppløsning: number,
  valg: { lukk: number; åpne: number; andel: number } = { lukk: 0.12, åpne: 0.06, andel: 0.3 }): Raster {
  const kL = Math.max(1, Math.round(valg.lukk * pxPerM)), kÅ = Math.max(1, Math.round(valg.åpne * pxPerM))
  let v = krymp(utvid(m, W, H, kL), W, H, kL)
  v = utvid(krymp(v, W, H, kÅ), W, H, kÅ)
  const celle = pxPerM * oppløsning
  const RW = Math.ceil(W / celle), RH = Math.ceil(H / celle)
  const sum = new Float32Array(RW * RH), n = new Float32Array(RW * RH)
  for (let y = 0; y < H; y++) {
    const ry = Math.min(RH - 1, Math.floor(y / celle))
    for (let x = 0; x < W; x++) { const j = ry * RW + Math.min(RW - 1, Math.floor(x / celle)); sum[j] += v[y * W + x]; n[j]++ }
  }
  const vegg = new Uint8Array(RW * RH)
  for (let j = 0; j < RW * RH; j++) vegg[j] = n[j] && sum[j] / n[j] >= valg.andel ? 1 : 0
  return { W: RW, H: RH, x0: 0, y0: 0, skala: 1 / celle, vegg }
}

/**
 * Rom som ligger utenfor bygget: rommene du kan nå fra kanten av arket uten å krysse en
 * vegg. Veggene utvides med en halv dørbredde først, så inngangsdører og vinduer ikke
 * slipper utsiden inn. Mellom ytterveggen og målsettingen blir det ellers «rom».
 */
export function fjernUtenfor<R extends { polygon: { x: number; y: number }[] }>(rom: R[], r: Raster, halvDørCeller: number): R[] {
  const { W, H } = r
  const tett = utvid(r.vegg, W, H, 2 * halvDørCeller + 1)
  const ute = new Uint8Array(W * H), kø: number[] = []
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (!tett[i] && !ute[i]) { ute[i] = 1; kø.push(i) } }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (!tett[i] && !ute[i]) { ute[i] = 1; kø.push(i) } }
  while (kø.length) {
    const i = kø.pop()!, x = i % W, y = (i / W) | 0
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
      if (j >= 0 && !tett[j] && !ute[j]) { ute[j] = 1; kø.push(j) }
  }
  // Utvid «ute» tilbake gjennom vegg-utvidelsen, så rommets kant mot ytterveggen ikke telles.
  const uteF = utvid(ute, W, H, 2 * halvDørCeller + 1)
  return rom.filter(rm => {
    // andel av polygonets punkter-boks som er ute, samplet i rutenettet
    let inne = 0, n = 0
    const xs = rm.polygon.map(p => p.x), ys = rm.polygon.map(p => p.y)
    const xa = Math.floor((Math.min(...xs) - r.x0) * r.skala), xb = Math.ceil((Math.max(...xs) - r.x0) * r.skala)
    const ya = Math.floor((Math.min(...ys) - r.y0) * r.skala), yb = Math.ceil((Math.max(...ys) - r.y0) * r.skala)
    for (let y = Math.max(0, ya); y < Math.min(H, yb); y++) for (let x = Math.max(0, xa); x < Math.min(W, xb); x++) {
      if (!punktIPolygon((x + 0.5) / r.skala + r.x0, (y + 0.5) / r.skala + r.y0, rm.polygon)) continue
      n++; if (!uteF[y * W + x]) inne++
    }
    return n > 0 && inne / n >= 0.5
  })
}

function punktIPolygon(x: number, y: number, P: { x: number; y: number }[]): boolean {
  let inn = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) inn = !inn
  }
  return inn
}
