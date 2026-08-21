import { database } from './db'
import { colors } from './theme'

/**
 * ── Palettprøving ──────────────────────────────────────────────────────────
 *
 * MIDLERTIDIG VERKTØY. Når én palett er valgt, skrives verdiene inn i
 * `lib/tokens.js` og denne fila slettes sammen med velgeren i «Meg». Den finnes
 * kun for å kunne se de tre variantene i den EKTE appen i stedet for å gjette
 * ut fra hex-koder — en beige ser helt annerledes ut på en skjerm i sollys enn
 * i en fargevelger.
 *
 * Alle tre holder seg i samme familie: brunt, kremet, kobber. Forskjellen er
 * DYBDE og hvor het kobberen er.
 *
 * Hvordan det virker: `colors` fra lib/theme.ts er ett objekt som alle skjermer
 * leser fra ved hver render. Vi bytter verdiene PÅ objektet og re-monterer
 * treet. Det er ikke måten et ferdig tema skal virke på — det er måten en
 * prøve skal virke på.
 */

export type PalettId = 'naavaerende' | 'espresso' | 'bein'

export type Palett = {
  id: PalettId
  navn: string
  beskrivelse: string
  /** Tre prøver til velgeren: grunn, kort, aksent. */
  proever: [string, string, string]
  farger: Record<string, string>
}

export const PALETTER: Palett[] = [
  {
    id: 'naavaerende',
    navn: 'Sand',
    beskrivelse: 'Den vi har nå. Varm sand, rene hvite kort, dempet kobber.',
    proever: ['#EFEAE1', '#FFFFFF', '#A97C4F'],
    farger: {
      canvas: '#EFEAE1', bg: '#FFFFFF', fill: '#E5DDCE', fillPressed: '#D8CEBB',
      label: '#2E281F', secondaryLabel: '#96896F', tertiaryLabel: '#C9C0AC', iconMuted: '#5C5340',
      separator: '#DED6C7', border: '#CDC4B1',
      cta: '#2E281F', brand: '#A97C4F', brandSoft: '#FBF7F0', brandWash: 'rgba(169,124,79,0.12)',
      slate: '#3F4B5C', ambientWarm: '#EAE5DC',
    },
  },
  {
    id: 'espresso',
    navn: 'Espresso',
    beskrivelse:
      'Dypere og varmere. Kortene er knekt hvite i stedet for rene — det var den rene hvitheten som ga «ark»-følelsen.',
    proever: ['#E9E2D6', '#FBF8F3', '#B57B3F'],
    farger: {
      canvas: '#E9E2D6', bg: '#FBF8F3', fill: '#DED4C2', fillPressed: '#D1C5AF',
      label: '#241E16', secondaryLabel: '#8B7E66', tertiaryLabel: '#BEB4A0', iconMuted: '#52483A',
      separator: '#D8CFBE', border: '#C6BCA7',
      cta: '#241E16', brand: '#B57B3F', brandSoft: '#F7F0E4', brandWash: 'rgba(181,123,63,0.14)',
      slate: '#37424F', ambientWarm: '#E4DCCE',
    },
  },
  {
    id: 'bein',
    navn: 'Bein & kobber',
    beskrivelse:
      'Kjøligere, lysere grunn — mer bein enn beige — med en hetere kobber som eneste varme. Leses som verktøy, ikke notatblokk.',
    proever: ['#EDEAE4', '#FFFFFF', '#C0703C'],
    farger: {
      canvas: '#EDEAE4', bg: '#FFFFFF', fill: '#E2DED5', fillPressed: '#D5D0C4',
      label: '#2B2620', secondaryLabel: '#8E8578', tertiaryLabel: '#C4BCB0', iconMuted: '#5A5346',
      separator: '#E0DAD0', border: '#CFC8BC',
      cta: '#2B2620', brand: '#C0703C', brandSoft: '#FCF6EF', brandWash: 'rgba(192,112,60,0.13)',
      slate: '#3E4A57', ambientWarm: '#E6E2DA',
    },
  },
]

const NOKKEL = 'palett_proeve'

/** Bytt verdiene på det delte fargeobjektet. Kalleren må re-montere treet. */
export function bruk(id: PalettId) {
  const p = PALETTER.find(x => x.id === id) ?? PALETTER[0]
  Object.assign(colors, p.farger)
}

export async function lagretPalett(): Promise<PalettId> {
  const v = await database.localStorage.get(NOKKEL).catch(() => undefined)
  return PALETTER.some(p => p.id === v) ? (v as PalettId) : 'naavaerende'
}

export async function velgPalett(id: PalettId) {
  bruk(id)
  varsle(id)
  await database.localStorage.set(NOKKEL, id).catch(() => {})
}

/** Lyttere, så rotlayoutet kan re-montere treet når velgeren bytter palett. */
const lyttere = new Set<(id: PalettId) => void>()

export function abonnerPalett(f: (id: PalettId) => void): () => void {
  lyttere.add(f)
  return () => { lyttere.delete(f) }
}

export function varsle(id: PalettId) {
  lyttere.forEach(f => f(id))
}
