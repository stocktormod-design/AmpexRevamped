/**
 * Strekene på én PDF-side, fra en side pdf.js alt har åpnet. Uten egen pdf.js-import, så
 * appen (pdfjs v4 legacy, på Hermes) og kontoret (pdfjs v6 i nettleseren) bruker samme
 * tolkning med hver sin pdf.js. Skilt ut av `rom-pdf-vektor.ts` 30.10.
 *
 * De to versjonene koder operatorlista ulikt, og begge håndteres her:
 *  - v4: `constructPath` = [delops, koordinater]; tegningen kommer som egen `stroke`/`fill`
 *    etterpå. Farger er [r, g, b] i 0–255.
 *  - v5+: `constructPath` = [tegneop, [stidata], minMax]; stidata er DrawOPS-koder
 *    (0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath) blandet med
 *    koordinater, og tegningen (stroke/fill) er MED i samme op. Farger er «#rrggbb».
 */

import type { Segment } from './rom-detekt'

export type PdfTekst = { tekst: string; x: number; y: number; hoyde: number }
export type PdfStreker = { segmenter: Segment[]; tekster: PdfTekst[]; breddePt: number; hoydePt: number }

type Matrise = [number, number, number, number, number, number]

/** Det vi trenger av en pdf.js-side — likt i v4 og v6. */
export type PdfSide = {
  getViewport(o: { scale: number }): { transform: number[]; width: number; height: number }
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>
  getTextContent(): Promise<{ items: unknown[] }>
}

const gang = (a: Matrise, b: Matrise): Matrise => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
]
const bruk = (m: Matrise, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** Farge-argumentene som tall 0–255, uansett versjon. */
function rgb(a: unknown[]): number[] {
  if (typeof a[0] === 'string') {
    const h = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(a[0])
    return h ? [parseInt(h[1], 16), parseInt(h[2], 16), parseInt(h[3], 16)] : [0, 0, 0]
  }
  return a as number[]
}

/**
 * Leser strekene på siden. Returnerer tom liste for bilde-PDF-er (skannede tegninger), som
 * er signalet til kalleren om å rasterisere i stedet.
 *
 * `medFyll`: ta med omrisset av fylte flater også (bredde 0, `fyll: true`). Romdelingen vil
 * ikke ha dem (fyll er ikke vegger), men symbolsøket må: prikken i «!» på en detektor er en
 * fylt sirkel, ikke en strek.
 */
export async function strekerFraSide(side: PdfSide, OPS: Record<string, number>, valg: { medFyll?: boolean } = {}): Promise<PdfStreker> {
  const vp = side.getViewport({ scale: 1 })
  const ops = await side.getOperatorList()

  let ctm = vp.transform.slice() as Matrise
  let farge = 0, bredde = 1, metning = 0, fyllGraa = 0, fyllMetning = 0
  const stabel: Array<[Matrise, number, number, number, number, number]> = []
  let sti: Array<[number, number, number, number]> = []
  const ut: Segment[] = []
  const graa = (c: number[]) => (c[0] + c[1] + c[2]) / 3 / 255
  const metn = (c: number[]) => (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255
  const skala = () => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]))

  const kurve = (cx: number, cy: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    let px = cx, py = cy
    for (let t = 1; t <= 6; t++) {
      const u = t / 6, m = 1 - u
      const x = m * m * m * cx + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x3
      const y = m * m * m * cy + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y3
      sti.push([px, py, x, y]); px = x; py = y
    }
  }

  /** v4: delops + koordinater hver for seg. */
  const stiV4 = (pOps: number[], pArgs: number[]) => {
    let k = 0, cx = 0, cy = 0, sx = 0, sy = 0
    for (const op of pOps) {
      if (op === OPS.moveTo) { cx = pArgs[k++]; cy = pArgs[k++]; sx = cx; sy = cy }
      else if (op === OPS.lineTo) { const x = pArgs[k++], y = pArgs[k++]; sti.push([cx, cy, x, y]); cx = x; cy = y }
      else if (op === OPS.curveTo) {
        const x1 = pArgs[k++], y1 = pArgs[k++], x2 = pArgs[k++], y2 = pArgs[k++], x3 = pArgs[k++], y3 = pArgs[k++]
        kurve(cx, cy, x1, y1, x2, y2, x3, y3); cx = x3; cy = y3
      }
      else if (op === OPS.curveTo2 || op === OPS.curveTo3) { k += 4 }
      else if (op === OPS.closePath) { sti.push([cx, cy, sx, sy]); cx = sx; cy = sy }
      else if (op === OPS.rectangle) {
        const x = pArgs[k++], y = pArgs[k++], w = pArgs[k++], h = pArgs[k++]
        sti.push([x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y])
        cx = x; cy = y; sx = x; sy = y
      }
    }
  }

  /** v5+: DrawOPS-koder og koordinater i én tabell. */
  const stiV6 = (d: ArrayLike<number>) => {
    let cx = 0, cy = 0, sx = 0, sy = 0
    for (let i = 0; i < d.length;) {
      const op = d[i++]
      if (op === 0) { cx = d[i++]; cy = d[i++]; sx = cx; sy = cy }
      else if (op === 1) { const x = d[i++], y = d[i++]; sti.push([cx, cy, x, y]); cx = x; cy = y }
      else if (op === 2) {
        const x1 = d[i++], y1 = d[i++], x2 = d[i++], y2 = d[i++], x3 = d[i++], y3 = d[i++]
        kurve(cx, cy, x1, y1, x2, y2, x3, y3); cx = x3; cy = y3
      }
      else if (op === 3) {
        const qx = d[i++], qy = d[i++], x3 = d[i++], y3 = d[i++]
        kurve(cx, cy, cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x3 + 2 / 3 * (qx - x3), y3 + 2 / 3 * (qy - y3), x3, y3); cx = x3; cy = y3
      }
      else if (op === 4) { sti.push([cx, cy, sx, sy]); cx = sx; cy = sy }
      else break
    }
  }

  const tegn = (fn: number) => {
    if (fn === OPS.stroke || fn === OPS.closeStroke) {
      // Strekbredden er i de LOKALE enhetene, som segmentene: gang med CTM-ens skala.
      // Uten dette ble 0,4 mm-vegger tegnet i mm-enheter lest som «4 pt = kabel» og
      // kastet av finnVegger (dansk/norsk CAD-eksport, 2026-10-25).
      const b = bredde * skala()
      for (const [x0, y0, x1, y1] of sti) {
        const p = bruk(ctm, x0, y0), q = bruk(ctm, x1, y1)
        ut.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], bredde: b, lys: metning, farge })
      }
    } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke) {
      if (valg.medFyll) {
        const b = fn === OPS.fillStroke || fn === OPS.eoFillStroke ? bredde * skala() : 0
        for (const [x0, y0, x1, y1] of sti) {
          const p = bruk(ctm, x0, y0), q = bruk(ctm, x1, y1)
          ut.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], bredde: b, lys: metning, farge, fyll: true, fyllGraa, fyllMetning })
        }
      }
    } else if (fn !== OPS.endPath) return
    sti = []
  }

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const a = ops.argsArray[i] as unknown[]
    if (fn === OPS.save) { stabel.push([ctm.slice() as Matrise, farge, bredde, metning, fyllGraa, fyllMetning]); continue }
    if (fn === OPS.restore) { const s = stabel.pop(); if (s) { ctm = s[0]; farge = s[1]; bredde = s[2]; metning = s[3]; fyllGraa = s[4]; fyllMetning = s[5] } continue }
    if (fn === OPS.transform) { ctm = gang(ctm, a as Matrise); continue }
    if (fn === OPS.setLineWidth) { bredde = a[0] as number; continue }
    if (fn === OPS.setStrokeRGBColor) { const c = rgb(a); farge = graa(c); metning = metn(c); continue }
    if (fn === OPS.setFillRGBColor) { const c = rgb(a); fyllGraa = graa(c); fyllMetning = metn(c); continue }
    if (fn === OPS.constructPath) {
      sti = []
      if (Array.isArray(a[0])) { stiV4(a[0] as number[], a[1] as number[]); continue }
      const data = (a[1] as unknown[] | undefined)?.[0]
      if (data && typeof data === 'object' && 'length' in (data as object)) stiV6(data as ArrayLike<number>)
      tegn(a[0] as number)
      continue
    }
    tegn(fn)
  }

  // Tekstlaget: romnavn og påførte arealer. Brukes som frø i romdelingen.
  const tekster: PdfTekst[] = []
  try {
    const tc = await side.getTextContent()
    for (const it of tc.items as Array<{ str?: string; transform?: number[]; height?: number }>) {
      const str = (it.str ?? '').trim()
      if (!str || !it.transform) continue
      const m = gang(vp.transform.slice() as Matrise, it.transform as unknown as Matrise)
      tekster.push({ tekst: str, x: m[4], y: m[5], hoyde: Math.abs(it.height ?? m[3]) || 8 })
    }
  } catch { /* uten tekstlag går romdelingen videre uten navn */ }

  return { segmenter: ut, tekster, breddePt: vp.width, hoydePt: vp.height }
}
