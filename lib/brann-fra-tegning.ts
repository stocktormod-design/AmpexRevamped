/**
 * Fra brannplan (PDF) til komponentforslag, på telefonen.
 *
 * Tegningen forklarer selv symbolene sine (SYMBOLFORKLARING). Vi leser
 * forklaringen som maler og finner dem igjen i planen — se lib/symbol-detekt.ts
 * for hva som måtte til. Resultatet er ett forslag per komponent, i
 * normaliserte sidekoordinater (0..1), klart til å bli en `fire_devices`-rad
 * som montøren kan trykke på. Den rene delen ligger i lib/brann-symboler.ts.
 *
 * Alt skjer lokalt. Brannplaner er ofte unntatt offentlighet (energiloven
 * § 9-3), så ingenting lastes opp for å finne komponentene.
 */

import * as FileSystem from 'expo-file-system/legacy'
import { strekerFraPdf } from './rom-pdf-vektor'
import { aiLogg } from './ai/ai-logg'
import { komponenterFraStrekerAsync, type Komponentsvar, type Komponenttype, type Side } from './brann-symboler'
import { isPdfRasterAvailable, pdfVectors } from '../modules/ampex-splat'
import type { FireDeviceKind } from './db/models/fire-device'

export type { Komponentsvar, Komponentforslag } from './brann-symboler'
export { kindFraEtikett } from './brann-symboler'

// Komponenttype i den rene modulen må være en gyldig FireDeviceKind — feiler
// her ved kompilering hvis registeret får en type den rene delen ikke kjenner.
const _typesjekk: FireDeviceKind = null as unknown as Komponenttype
void _typesjekk

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
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
 * Strekene og teksten i en lokal PDF (offline-cachen), i punkt med origo øverst
 * til venstre. Native skanner når den finnes (rask, følger form-XObjects);
 * pdf.js er reserven for bygg uten modulen (Android i dag) — den hang på Hermes
 * med en A0-plan, så den er nettopp reserve. Brukes av BÅDE komponentsøket og
 * romdelingen, så tegningen leses én gang ved opplasting.
 */
export async function lesTegningsvektorer(localUri: string): Promise<Side> {
  if (isPdfRasterAvailable) {
    const t0 = Date.now()
    const v = await pdfVectors(localUri)
    const segmenter: Side['segmenter'] = []
    for (let i = 0; i + 7 < v.seg.length; i += 8) {
      // lys = metning (0 = grå/svart), farge = gråtone — romdelingen skiller veggpenn på dem.
      segmenter.push({ x0: v.seg[i], y0: v.seg[i + 1], x1: v.seg[i + 2], y1: v.seg[i + 3], bredde: v.seg[i + 4], fyll: v.seg[i + 5] === 1, farge: v.seg[i + 6], lys: v.seg[i + 7] })
    }
    aiLogg('[symbol] native streker', segmenter.length, 'tekster', v.tekster.length, v.widthPt, v.heightPt, (Date.now() - t0) + ' ms')
    return { segmenter, tekster: v.tekster, breddePt: v.widthPt, hoydePt: v.heightPt }
  }
  const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 })
  const side = await strekerFraPdf(fraBase64(b64), { medFyll: true })
  aiLogg('[symbol] pdf.js streker', side.segmenter.length, 'tekster', side.tekster.length, side.breddePt, side.hoydePt)
  return side
}

/** Fra en lokal PDF-fil til komponentforslag (knappen «Finn fra tegningen»). */
export async function finnKomponenterPaaTegning(localUri: string, onFremdrift?: (andel: number) => void): Promise<Komponentsvar> {
  const side = await lesTegningsvektorer(localUri)
  const t0 = Date.now()
  const svar = await komponenterFraStrekerAsync(side, onFremdrift)
  aiLogg('[symbol] forslag', svar.forslag.length, 'typer', svar.symboltyper.length, (Date.now() - t0) + ' ms')
  return svar
}
