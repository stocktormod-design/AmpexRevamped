/**
 * Fra PDF-tegning til romforslag, på telefonen.
 *
 * Tegninger kommer i to former: vektor (streker i fila) og bilde (skannet
 * eller flislagt PNG). Vi tar den enkleste veien som dekker begge: rasterér
 * siden med den native rendereren, plukk ut de lange rette linjene av
 * pikslene, og send dem til `finnRom`. Det er nøyaktig samme vei som ble
 * målt til 9/9 rom på en RIV-plan og 66 rom på en ren bilde-PDF.
 *
 * Alt skjer lokalt. Tegninger kan være taushetsbelagte (energiloven § 9-3),
 * så ingenting lastes opp for å dele inn i rom.
 */

import * as FileSystem from 'expo-file-system/legacy'
import { Skia } from '@shopify/react-native-skia'
import { renderPdfPage, isPdfRasterAvailable } from '../modules/ampex-splat'
import { finnRom, STANDARD } from './rom-detekt'
import { morkMaske, linjerFraMaske } from './rom-linjer'
import { strekerFraPdf } from './rom-pdf-vektor'

export type Romforslag = {
  /** Hjørnene i normaliserte sidekoordinater (0..1) — samme form som Room.shape. */
  punkter: [number, number][]
  /** Gulvareal i kvadratmeter. */
  areal: number
  /** Navn lest av tegningen, når den har et tekstlag. */
  navn?: string
}

export type Romdelingsvalg = {
  /** Sidebredde i punkter. Utelates den, leses den av PDF-en selv. */
  sidebreddePt?: number
  /** Målestokkens nevner: 50 for 1:50. */
  maalestokk?: number
  /** Rasterets lengste side. Høyere = finere, men tregere. */
  maksPx?: number
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** base64 → bytes. Hermes har ikke alltid `atob`, og vi vil ikke dra inn et bibliotek for én funksjon. */
function fraBase64(s: string): Uint8Array {
  const rein = s.replace(/[^A-Za-z0-9+/]/g, '')
  const ut = new Uint8Array((rein.length * 3) >> 2)
  let n = 0, buf = 0, bits = 0
  for (let i = 0; i < rein.length; i++) {
    buf = (buf << 6) | B64.indexOf(rein[i]); bits += 6
    if (bits >= 8) { bits -= 8; ut[n++] = (buf >> bits) & 0xff }
  }
  return n === ut.length ? ut : ut.subarray(0, n)
}

/**
 * Romnavnet står rett over arealpåskriften («Teknisk» over «20,3 m²»).
 * Vi tar nærmeste tekst over, innen halvannen linjehøyde, og hopper over
 * tall-koder og taggene med `=` som RIV-tegninger er fulle av.
 */
function romnavn(merke: { x: number; y: number; hoyde: number }, alle: Array<{ tekst: string; x: number; y: number }>): string | undefined {
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

/** Punkter per meter på papiret ved gitt målestokk (1:50 → 56,69 pt/m). */
export function ptPerMeter(maalestokk: number): number {
  return (1000 / maalestokk) / 25.4 * 72
}

// ── hoved ───────────────────────────────────────────────────────────────────

export const kanDeleIRom = isPdfRasterAvailable

/**
 * Deler tegningen i rom. Returnerer forslag — de skal alltid kunne rettes for
 * hånd etterpå, for ingen tegning er ryddig nok til at dette blir riktig hver
 * gang.
 */
export async function finnRomPaaTegning(pdfSti: string, valg: Romdelingsvalg): Promise<Romforslag[]> {
  const maalestokk = valg.maalestokk ?? 50
  const ptPerM = ptPerMeter(maalestokk)
  let sidebreddePt = valg.sidebreddePt ?? 0

  // 1) Ekte streker hvis PDF-en har dem. Målt 9/9 rom mot 6/9 for rasteret,
  //    fordi pennfargen skiller vegg fra ventilasjonskanal.
  try {
    const b64 = await FileSystem.readAsStringAsync(pdfSti.replace('file://', ''), { encoding: 'base64' })
    const bytes = fraBase64(b64)
    const { segmenter, tekster, breddePt, hoydePt } = await strekerFraPdf(bytes)
    sidebreddePt = breddePt // gjelder også rasterveien under
    if (segmenter.length >= 200) {
      // Arealpåskriftene («20,3 m²») står inne i hvert rom og er de sikreste
      // frøene vi kan få: ett per rom, alltid på gulvet.
      // NB: ingen \b etter «²» — den er ikke et ordtegn, så grensen treffer aldri.
      const merker = tekster.filter(t => /\d\s*m(²|2)/i.test(t.tekst))
      const rom = finnRom(segmenter, { ...STANDARD, ptPerM }, merker.map(m => ({ x: m.x, y: m.y })))
      return rom.map(r => ({
        punkter: r.polygon.map(p => [p.x / breddePt, p.y / hoydePt] as [number, number]),
        areal: r.areal / (ptPerM * ptPerM),
        navn: r.etiketter.length ? romnavn(merker[r.etiketter[0]], tekster) : undefined,
      }))
    }
  } catch {
    // Skannet PDF, uvanlig innhold eller pdf.js som ikke kom i gang: ta rasteret.
  }

  // 2) Rasterveien — virker på alt, også rene bilde-PDF-er.
  const raster = await renderPdfPage(pdfSti, 0, valg.maksPx ?? 2400)

  const b64 = await FileSystem.readAsStringAsync(raster.uri.replace('file://', ''), { encoding: 'base64' })
  const data = Skia.Data.fromBase64(b64)
  const bilde = Skia.Image.MakeImageFromEncoded(data)
  if (!bilde) throw new Error('Klarte ikke lese rasteret av tegningen')
  const W = bilde.width(), H = bilde.height()
  const raa = bilde.readPixels()
  if (!raa) throw new Error('Klarte ikke lese pikslene')
  const px = raa instanceof Uint8Array ? raa : Uint8Array.from(raa as unknown as ArrayLike<number>)

  // Piksler per meter: papirets pt/m ganget med rasterets oppløsning.
  if (!sidebreddePt) throw new Error('Fant ikke sidestørrelsen på tegningen')
  const pxPerPt = W / sidebreddePt
  const pxPerM = ptPerMeter(maalestokk) * pxPerPt

  const { maske, lys } = morkMaske(px, W, H)
  const segmenter = linjerFraMaske(maske, W, H, Math.max(3, Math.round(0.4 * pxPerM)), lys)
  if (segmenter.length < 20) return []

  const rom = finnRom(segmenter, { ...STANDARD, ptPerM: pxPerM })
  return rom.map(r => ({
    punkter: r.polygon.map(p => [p.x / W, p.y / H] as [number, number]),
    areal: r.areal / (pxPerM * pxPerM),
  }))
}
