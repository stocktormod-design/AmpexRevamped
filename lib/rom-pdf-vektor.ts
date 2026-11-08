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

import { strekerFraSide } from './pdf-streker'
import type { PdfStreker } from './pdf-streker'
export type { PdfTekst, PdfStreker } from './pdf-streker'
// Statisk, ikke `await import(...)`: Metro lastet den late bundelen som egen
// forespørsel og avbrøt den (2026-09-13), så løftet aldri kom tilbake — søket
// sto på «Leser tegningen …» for alltid. Reserveveien må kunne stoles på.
import * as pdfjsStatisk from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as pdfjsWorkerStatisk from 'pdfjs-dist/legacy/build/pdf.worker.mjs'

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

/**
 * Leser strekene på side 1. Fyll og tekst hoppes over — bare streker er vegger.
 * Returnerer tom liste for bilde-PDF-er (skannede tegninger), som er signalet
 * til kalleren om å rasterisere i stedet.
 */
/**
 * `medFyll`: ta med omrisset av fylte flater også (bredde 0, `fyll: true`).
 * Romdelingen vil ikke ha dem (fyll er ikke vegger), men symbolsøket må: prikken
 * i «!» på en detektor er en fylt sirkel, ikke en strek.
 */
export async function strekerFraPdf(bytes: Uint8Array, valg: { medFyll?: boolean; side?: number } = {}): Promise<PdfStreker> {
  const settTilbake = fyllInnManglende()
  const pdfjs = pdfjsStatisk
  const OPS = pdfjs.OPS as unknown as Record<string, number>

  // pdf.js vil laste kjernen sin i en worker. Det finnes ingen worker her, så
  // vi registrerer modulen selv — pdf.js sjekker `globalThis.pdfjsWorker` før
  // den prøver å importere fila, og kjører da alt på hovedtråden.
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.pdfjsWorker) g.pdfjsWorker = pdfjsWorkerStatisk
  pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs' // må være satt, men leses aldri

  // Jobben er kort nok til å ligge på hovedtråden.
  const oppgave = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false, useSystemFonts: false } as never)
  const doc = await oppgave.promise
  try {
    const side = await doc.getPage(valg.side ?? 1)
    return await strekerFraSide(side as never, OPS, valg)
  } finally {
    await doc.destroy()
    settTilbake()
  }
}
