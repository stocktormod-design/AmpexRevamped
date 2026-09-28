/**
 * Ren del av komponentsøket: fra streker og tekst til komponentforslag.
 * Ingen PDF, ingen Expo, ingen WatermelonDB — så selvtesten når det.
 * PDF-innpakningen ligger i lib/brann-fra-tegning.ts.
 */

import { lesForklaring, finnSymboler, finnSymbolerAsync, type Strek, type Tekst, type Symbolfunn } from './symbol-detekt'

/** Speiler FireDeviceKind i lib/db/models/fire-device.ts (sjekkes der ved kompilering). */
export type Komponenttype = 'royk' | 'varme' | 'multi' | 'melder' | 'klokke' | 'sirene' | 'sentral' | 'annet'

export type Komponentforslag = {
  /** Senter i normaliserte sidekoordinater (0..1). */
  x: number; y: number
  kind: Komponenttype
  /** Etiketten i forklaringen, ordrett — «Sløyfe inn- utgangsenhet». */
  etikett: string
  /** Tilleggssymbol under detektoren — «Detektor med summer». */
  tillegg?: string
  score: number
}

export type Komponentsvar = {
  forslag: Komponentforslag[]
  /** Hva forklaringen inneholdt, så skjermen kan si «Fant 9 symboltyper». */
  symboltyper: string[]
  /** Ingen forklaring i tegningen: da finnes det ingenting å lete etter. */
  utenForklaring: boolean
}

/**
 * Etiketten i forklaringen → komponenttype i registeret. Ordvalg varierer
 * mellom rådgivere; vi treffer på stammen. Ukjent → «annet», etiketten følger med.
 */
export function kindFraEtikett(etikett: string): Komponenttype {
  const e = etikett.toLowerCase()
  if (/multikriterie|multisensor|multidetektor/.test(e)) return 'multi'
  if (/manuell|melder|trykknapp/.test(e)) return 'melder'
  if (/sirene|lydgiver/.test(e)) return 'sirene'
  if (/klokke/.test(e)) return 'klokke'
  if (/sentral/.test(e)) return 'sentral'
  if (/varme/.test(e)) return 'varme'
  if (/røyk|royk|optisk|ionisk|aspirasjon/.test(e)) return 'royk'
  return 'annet'
}

export type Side = { segmenter: Strek[]; tekster: Tekst[]; breddePt: number; hoydePt: number }

export function komponenterFraStreker(side: Side): Komponentsvar {
  const { maler, omraade } = lesForklaring(side.segmenter, side.tekster)
  if (!maler.length) return { forslag: [], symboltyper: [], utenForklaring: true }
  return tilSvar(maler.map(m => m.navn), finnSymboler(maler, side.segmenter, side.tekster, { utelat: omraade }), side)
}

/** Som over, men slipper JS-tråden underveis (telefon). */
export async function komponenterFraStrekerAsync(side: Side, onFremdrift?: (andel: number) => void): Promise<Komponentsvar> {
  const { maler, omraade } = lesForklaring(side.segmenter, side.tekster)
  if (!maler.length) return { forslag: [], symboltyper: [], utenForklaring: true }
  return tilSvar(maler.map(m => m.navn), await finnSymbolerAsync(maler, side.segmenter, side.tekster, { utelat: omraade }, onFremdrift), side)
}

function tilSvar(symboltyper: string[], funn: Symbolfunn[], side: Side): Komponentsvar {
  // Leserekkefølge (rad for rad, venstre mot høyre) så auto-taggene blir forutsigbare.
  const sortert = [...funn].sort((a, b) => (Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x))
  return {
    forslag: sortert.map((f: Symbolfunn) => ({
      x: f.x / side.breddePt, y: f.y / side.hoydePt,
      kind: kindFraEtikett(f.type), etikett: f.type, tillegg: f.tillegg, score: f.score,
    })),
    symboltyper,
    utenForklaring: false,
  }
}
