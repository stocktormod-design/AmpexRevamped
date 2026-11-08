/**
 * Vektorveien til romdelingen, uten PDF-lesing og uten Expo: fra ferdig leste streker og
 * tekst til romforslag. Skilt ut av `rom-fra-tegning.ts` (30.10) så kontoret kan bruke den
 * samme koden i nettleseren — telefonen leser strekene med den native skanneren, kontoret
 * med pdf.js, og begge sender dem hit.
 */

import { finnRomMedPaaskrifter, romPaaskrifter, arealFraTekst } from './rom-detekt'
import type { PdfStreker } from './pdf-streker'

export type Romforslag = {
  /** Hjørnene i normaliserte sidekoordinater (0..1) — samme form som Room.shape. */
  punkter: [number, number][]
  /** Gulvareal i kvadratmeter. */
  areal: number
  /** Navn lest av tegningen, når den har et tekstlag. */
  navn?: string
  /** Arealpåskriften inni rommet stemmer med det funne arealet (±10 %). `false` = forslag
   *  som bør sjekkes; utelatt = tegningen har ingen påskrifter å sjekke mot. */
  bekreftet?: boolean
}

/** Punkter per meter på papiret ved gitt målestokk (1:50 → 56,69 pt/m). */
export function ptPerMeter(maalestokk: number): number {
  return (1000 / maalestokk) / 25.4 * 72
}

/** «1 : 50», «1:100», «M 1:50» i tittelfeltet → 50. Ingen → null (romdelingen bruker 50). */
export function maalestokkFraTekst(tekster: { tekst: string }[]): number | null {
  for (const t of tekster) {
    const m = /(?:^|[^\d])1\s*:\s*(\d{2,4})(?!\d)/.exec(t.tekst)
    if (m) { const n = parseInt(m[1], 10); if (n >= 10 && n <= 2000) return n }
  }
  return null
}

/**
 * Romnavnet står rett over arealpåskriften («Teknisk» over «20,3 m²»).
 * Vi tar nærmeste tekst over, innen halvannen linjehøyde, og hopper over
 * tall-koder og taggene med `=` som RIV-tegninger er fulle av.
 */
export function romnavn(merke: { x: number; y: number; hoyde: number }, alle: Array<{ tekst: string; x: number; y: number }>): string | undefined {
  let best: { t: string; d: number } | null = null
  for (const t of alle) {
    const dy = merke.y - t.y
    if (dy <= 0 || dy > merke.hoyde * 2.2) continue
    if (Math.abs(t.x - merke.x) > merke.hoyde * 6) continue
    if (/m(²|2)/i.test(t.tekst) || t.tekst.includes('=') || /^[\d.,\s-]+$/.test(t.tekst)) continue
    const d = dy + Math.abs(t.x - merke.x) * 0.3
    if (!best || d < best.d) best = { t: t.tekst, d }
  }
  return best?.t
}

/**
 * Rom fra strekene. Arealpåskriftene («20,3 m²») står inne i hvert rom og er de sikreste
 * frøene vi kan få: ett per rom, alltid på gulvet. De sier også HVOR STORT rommet er — det
 * avgjør hvem som får en navnløs stripe når to rom deler den (se bruktEtiketter i rom-detekt),
 * hvilken målestokk tegningen egentlig har, og hvilke rom vi kan stå inne for (se
 * finnRomMedPaaskrifter).
 *
 * Tom liste betyr som regel at strekene bare er ramma og tittelfeltet (bilde-PDF med
 * vektorramme, Torvhaugan 2026-09-13) — da må en rastervei ta over hos kalleren.
 */
export function romFraStreker(lest: PdfStreker, maalestokk: number): Romforslag[] {
  return romOgMaalestokkFraStreker(lest, maalestokk).rom
}

/** Som over, og målestokken som faktisk passet påskriftene (tittelfeltet kan lyve). */
export function romOgMaalestokkFraStreker(lest: PdfStreker, maalestokk: number): { rom: Romforslag[]; maalestokk: number } {
  const { segmenter, tekster, breddePt, hoydePt } = lest
  const merker = romPaaskrifter(tekster)
  const etiketter = merker.map(m => ({ x: m.x, y: m.y, areal: arealFraTekst(m.tekst) }))
  const { rom, maalestokk: funnet } = finnRomMedPaaskrifter(segmenter, etiketter, maalestokk)
  const pm = ptPerMeter(funnet)
  const harPaaskrifter = etiketter.filter(e => e.areal).length >= 3
  return {
    maalestokk: funnet,
    rom: rom.map(r => ({
      punkter: r.polygon.map(p => [p.x / breddePt, p.y / hoydePt] as [number, number]),
      areal: r.areal / (pm * pm),
      navn: r.etiketter.length ? romnavn(merker[r.etiketter[0]], tekster) : undefined,
      bekreftet: harPaaskrifter ? !!r.bekreftet : undefined,
    })),
  }
}
