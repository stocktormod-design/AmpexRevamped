import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist'
import arbeider from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { strekerFraSide, type PdfSide, type PdfStreker } from '@delt/pdf-streker'
import { maalestokkFraTekst, ptPerMeter, romOgMaalestokkFraStreker, type Romforslag } from '@delt/rom-fra-streker'
import { finnRom, STANDARD } from '@delt/rom-detekt'
import { linjerFraMaske, morkMaske } from '@delt/rom-linjer'
import { komponenterFraStrekerAsync, kindFraEtikett } from '@delt/brann-symboler'
import { erTilleggssymbol, punkttypeFraEtikett } from '@delt/el-symboler'
import { boksFor, type Prosjektering, type Punkt, type Rom } from '@delt/prosjektering'

GlobalWorkerOptions.workerSrc = arbeider

/**
 * Det telefonen gjør ved første opplasting (`lib/tegning-analyse.ts`), på kontoret: rom fra
 * strekene og punkter fra tegningens egen symbolforklaring. Samme kode som er målt på Moskenes
 * (brann: 9/9 rom bekreftet mot påskriftene, 38 symboler av 10 typer). Kontoret leser PDF-en
 * med sin egen pdf.js (v6); tolkningen av strekene er felles (`@delt/pdf-streker`).
 *
 * Bilde-PDF-er (skannede, eller limt inn som ett bilde) har ingen streker — da rasteriseres
 * siden og linjene plukkes av pikslene, som i appen. Symbolene krever vektorer.
 *
 * Alt skjer i nettleseren. Tegninger kan være taushetsbelagte; ingenting sendes noe sted.
 */

export type Analyse = {
  rom: Rom[]
  punkter: Punkt[]
  /** Målestokken tegningen faktisk passet (tittelfeltet kan lyve), og linja vi legger inn for den. */
  nevner: number | null
  malestokk: Prosjektering['plan']['malestokk']
  symboltyper: string[]
  /** Etiketter i forklaringen vi ikke kjenner — lagt inn med etiketten som notat. */
  ukjente: string[]
  vei: 'vektor' | 'raster' | 'ingen'
}

/** Brannsymbolene har sin egen oversettelse; de få som har et symbol hos oss, får det. */
function brannType(etikett: string): string | null {
  const k = kindFraEtikett(etikett)
  if (k === 'royk' || k === 'varme' || k === 'multi') return 'royk'
  if (k === 'melder') return 'melder'
  if (k === 'klokke' || k === 'sirene') return 'klokke'
  return null
}

function somRom(f: Romforslag, i: number): Rom {
  const polygon = f.punkter.map(([x, y]) => ({ x, y }))
  return {
    id: crypto.randomUUID(), navn: f.navn ?? `Rom ${i + 1}`, form: boksFor(polygon), polygon,
    bruk: '', brukere: '', pavirkninger: [], notat: '',
    funnet: f.bekreftet === true ? 'bekreftet' : f.bekreftet === false ? 'usikker' : 'uten-paaskrift',
  }
}

/** Linja for målestokken: langs nedre marg, 80 % av sidebredden. */
function malestokkLinje(nevner: number, breddePt: number): Prosjektering['plan']['malestokk'] {
  return { a: { x: 0.1, y: 0.97 }, b: { x: 0.9, y: 0.97 }, meter: Math.round(0.8 * breddePt / ptPerMeter(nevner) * 100) / 100 }
}

async function rasterRom(side: { getViewport(o: { scale: number }): { width: number; height: number }; render(o: unknown): { promise: Promise<void> } }, breddePt: number, nevner: number): Promise<Romforslag[]> {
  const v1 = side.getViewport({ scale: 1 })
  const skala = 2400 / Math.max(v1.width, v1.height)
  const vp = side.getViewport({ scale: skala })
  const lerret = document.createElement('canvas')
  lerret.width = Math.round(vp.width); lerret.height = Math.round(vp.height)
  const ctx = lerret.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lerret.width, lerret.height)
  await side.render({ canvasContext: ctx, canvas: lerret, viewport: vp }).promise
  const W = lerret.width, H = lerret.height
  const px = new Uint8Array(ctx.getImageData(0, 0, W, H).data.buffer)
  const pxPerM = ptPerMeter(nevner) * (W / breddePt)
  const { maske, lys } = morkMaske(px, W, H)
  const segmenter = linjerFraMaske(maske, W, H, Math.max(3, Math.round(0.4 * pxPerM)), lys)
  if (segmenter.length < 20) return []
  return finnRom(segmenter, { ...STANDARD, ptPerM: pxPerM }).map(r => ({
    punkter: r.polygon.map(p => [p.x / W, p.y / H] as [number, number]),
    areal: r.areal / (pxPerM * pxPerM),
  }))
}

export async function analyserPdf(bytes: ArrayBuffer, onSteg?: (tekst: string) => void): Promise<Analyse> {
  onSteg?.('Leser tegningen …')
  const oppgave = getDocument({ data: new Uint8Array(bytes) })
  const doc = await oppgave.promise
  try {
    const side = await doc.getPage(1)
    const lest: PdfStreker = await strekerFraSide(side as unknown as PdfSide, OPS as unknown as Record<string, number>, { medFyll: true })
    const tittel = maalestokkFraTekst(lest.tekster)
    let nevner = tittel
    let romforslag: Romforslag[] = []
    let vei: Analyse['vei'] = 'ingen'

    onSteg?.('Finner rommene …')
    if (lest.segmenter.length >= 200) {
      const r = romOgMaalestokkFraStreker(lest, tittel ?? 50)
      if (r.rom.length) { romforslag = r.rom; nevner = r.maalestokk; vei = 'vektor' }
    }
    if (!romforslag.length) {
      romforslag = await rasterRom(side as never, lest.breddePt, nevner ?? 50)
      if (romforslag.length) vei = 'raster'
    }
    romforslag.sort((a, b) => b.areal - a.areal)

    onSteg?.('Leter etter symbolene i forklaringen …')
    const punkter: Punkt[] = []
    const ukjente = new Set<string>()
    let symboltyper: string[] = []
    if (lest.segmenter.length >= 50) {
      const svar = await komponenterFraStrekerAsync(lest, a => onSteg?.(`Leter etter symbolene … ${Math.round(a * 100)} %`))
      symboltyper = svar.symboltyper
      for (const f of svar.forslag) {
        if (erTilleggssymbol(f.etikett)) continue
        const type = punkttypeFraEtikett(f.etikett) ?? brannType(f.etikett)
        if (!type) ukjente.add(f.etikett)
        punkter.push({
          id: crypto.randomUUID(), x: f.x, y: f.y, type: type ?? 'tilkobling',
          notat: type ? (f.tillegg ?? undefined) : [f.etikett, f.tillegg].filter(Boolean).join(' · '),
        })
      }
    }

    return {
      rom: romforslag.map(somRom), punkter, nevner, symboltyper, ukjente: [...ukjente], vei,
      malestokk: nevner ? malestokkLinje(nevner, lest.breddePt) : null,
    }
  } finally {
    await oppgave.destroy()
  }
}
