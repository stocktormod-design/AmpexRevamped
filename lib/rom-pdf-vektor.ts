/**
 * Streker rett ut av en vektor-PDF, med pdf.js på hovedtråden.
 *
 * Hvorfor i det hele tatt: rasterveien (`rom-linjer.ts`) fungerer på alle
 * tegninger, men mister strekbredde og pennfarge. Målt på en RIV-plan traff
 * rasteret 6 av 9 rom, mens de ekte vektorene traff 9 av 9 — forskjellen er at
 * `finnRom` kan skille veggpennen fra ventilasjonskanalene når fargen er
 * eksakt. Derfor: vektor når PDF-en har streker, raster ellers.
 *
 * pdf.js er skrevet for nettleseren. Hermes mangler et par nyere ting den tar
 * for gitt, så de fylles inn her. Alt er pakket i try/catch hos kalleren:
 * feiler dette, faller vi tilbake på rasteret i stedet for å stoppe.
 */

import type { Segment } from './rom-detekt'

export type PdfTekst = { tekst: string; x: number; y: number; hoyde: number }
export type PdfStreker = { segmenter: Segment[]; tekster: PdfTekst[]; breddePt: number; hoydePt: number }

type Matrise = [number, number, number, number, number, number]

/**
 * Hermes mangler `Promise.withResolvers`, og Expo sin `structuredClone`-
 * polyfill (@ungap) kaster på dataene pdf.js sender mellom seg selv og
 * «arbeideren» sin. Vi setter derfor INN vår egen kopifunksjon mens pdf.js
 * jobber, og setter tilbake den originale etterpå.
 */
function fyllInnManglende(): () => void {
  const g = globalThis as unknown as Record<string, unknown>
  const P = Promise as unknown as { withResolvers?: unknown }
  if (typeof P.withResolvers !== 'function') {
    P.withResolvers = function <T>() {
      let resolve!: (v: T | PromiseLike<T>) => void
      let reject!: (r?: unknown) => void
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
      return { promise, resolve, reject }
    }
  }
  // MÅ håndtere typede tabeller: pdf.js sender selve PDF-bytene gjennom denne.
  const original = g.structuredClone
  g.structuredClone = (v: unknown) => dypKopi(v, new Map())
  return () => { g.structuredClone = original }
}

/** Dyp kopi som beholder binærdata, Map/Set/Date og sykler. */
function dypKopi(v: unknown, sett: Map<unknown, unknown>): unknown {
  if (v === null || typeof v !== 'object') return v
  const funnet = sett.get(v)
  if (funnet !== undefined) return funnet
  if (v instanceof ArrayBuffer) { const k = v.slice(0); sett.set(v, k); return k }
  if (ArrayBuffer.isView(v)) {
    const ta = v as unknown as { constructor: new (b: ArrayBuffer, o: number, l: number) => unknown; buffer: ArrayBuffer; byteOffset: number; length: number; byteLength: number }
    const buf = dypKopi(ta.buffer, sett) as ArrayBuffer
    const k = v instanceof DataView
      ? new DataView(buf, ta.byteOffset, ta.byteLength)
      : new ta.constructor(buf, ta.byteOffset, ta.length)
    sett.set(v, k); return k
  }
  if (v instanceof Date) { const k = new Date(v.getTime()); sett.set(v, k); return k }
  if (Array.isArray(v)) { const k: unknown[] = []; sett.set(v, k); for (const e of v) k.push(dypKopi(e, sett)); return k }
  if (v instanceof Map) { const k = new Map(); sett.set(v, k); for (const [a, b] of v) k.set(dypKopi(a, sett), dypKopi(b, sett)); return k }
  if (v instanceof Set) { const k = new Set(); sett.set(v, k); for (const e of v) k.add(dypKopi(e, sett)); return k }
  const k: Record<string, unknown> = {}
  sett.set(v, k)
  for (const [n, e] of Object.entries(v as Record<string, unknown>)) k[n] = dypKopi(e, sett)
  return k
}

const gang = (a: Matrise, b: Matrise): Matrise => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
]
const bruk = (m: Matrise, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/**
 * Leser strekene på side 1. Fyll og tekst hoppes over — bare streker er vegger.
 * Returnerer tom liste for bilde-PDF-er (skannede tegninger), som er signalet
 * til kalleren om å rasterisere i stedet.
 */
export async function strekerFraPdf(bytes: Uint8Array): Promise<PdfStreker> {
  const settTilbake = fyllInnManglende()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const OPS = pdfjs.OPS as unknown as Record<string, number>

  // pdf.js vil laste kjernen sin i en worker. Det finnes ingen worker her, så
  // vi registrerer modulen selv — pdf.js sjekker `globalThis.pdfjsWorker` før
  // den prøver å importere fila, og kjører da alt på hovedtråden.
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs' // må være satt, men leses aldri

  // Jobben er kort nok til å ligge på hovedtråden.
  const oppgave = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false, useSystemFonts: false } as never)
  const doc = await oppgave.promise
  try {
    const side = await doc.getPage(1)
    const vp = side.getViewport({ scale: 1 })
    const ops = await side.getOperatorList()

    let ctm = vp.transform.slice() as Matrise
    let farge = 0, bredde = 1, metning = 0
    const stabel: Array<[Matrise, number, number, number]> = []
    let sti: Array<[number, number, number, number]> = []
    const ut: Segment[] = []
    const graa = (c: number[]) => (c[0] + c[1] + c[2]) / 3 / 255
    const metn = (c: number[]) => (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      const a = ops.argsArray[i] as never[]
      if (fn === OPS.save) { stabel.push([ctm.slice() as Matrise, farge, bredde, metning]); continue }
      if (fn === OPS.restore) { const s = stabel.pop(); if (s) { ctm = s[0]; farge = s[1]; bredde = s[2]; metning = s[3] } continue }
      if (fn === OPS.transform) { ctm = gang(ctm, a as unknown as Matrise); continue }
      if (fn === OPS.setLineWidth) { bredde = a[0] as unknown as number; continue }
      if (fn === OPS.setStrokeRGBColor) { const c = a as unknown as number[]; farge = graa(c); metning = metn(c); continue }
      if (fn === OPS.constructPath) {
        const pOps = a[0] as unknown as number[]
        const pArgs = a[1] as unknown as number[]
        sti = []
        let k = 0, cx = 0, cy = 0, sx = 0, sy = 0
        const linje = (x0: number, y0: number, x1: number, y1: number) => sti.push([x0, y0, x1, y1])
        for (const op of pOps) {
          if (op === OPS.moveTo) { cx = pArgs[k++]; cy = pArgs[k++]; sx = cx; sy = cy }
          else if (op === OPS.lineTo) { const x = pArgs[k++], y = pArgs[k++]; linje(cx, cy, x, y); cx = x; cy = y }
          else if (op === OPS.curveTo) {
            const x1 = pArgs[k++], y1 = pArgs[k++], x2 = pArgs[k++], y2 = pArgs[k++], x3 = pArgs[k++], y3 = pArgs[k++]
            let px = cx, py = cy
            for (let t = 1; t <= 6; t++) {
              const u = t / 6, m = 1 - u
              const x = m * m * m * cx + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x3
              const y = m * m * m * cy + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y3
              linje(px, py, x, y); px = x; py = y
            }
            cx = x3; cy = y3
          }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { k += 4 }
          else if (op === OPS.closePath) { linje(cx, cy, sx, sy); cx = sx; cy = sy }
          else if (op === OPS.rectangle) {
            const x = pArgs[k++], y = pArgs[k++], w = pArgs[k++], h = pArgs[k++]
            linje(x, y, x + w, y); linje(x + w, y, x + w, y + h); linje(x + w, y + h, x, y + h); linje(x, y + h, x, y)
            cx = x; cy = y; sx = x; sy = y
          }
        }
        continue
      }
      if (fn === OPS.stroke || fn === OPS.closeStroke) {
        for (const [x0, y0, x1, y1] of sti) {
          const p = bruk(ctm, x0, y0), q = bruk(ctm, x1, y1)
          ut.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], bredde, lys: metning, farge })
        }
        sti = []
        continue
      }
      if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke) { sti = [] }
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
  } finally {
    await doc.destroy()
    settTilbake()
  }
}
