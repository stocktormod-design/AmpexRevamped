import { elnummer, type Vare } from './efo-nelfo'

/**
 * Vare fra prisfila → varekort.
 *
 * **Innsikten som gjør EFObasen unødvendig for v1:** prisfila inneholder
 * allerede fabrikat, typebetegnelse, EAN, NRF-nummer, bilde, FDV, HMS,
 * erstatningsvare, pakningsstørrelse og lagerstatus. `VX`/`VA`-postene
 * (tilleggsinfo og alternativer) er halve varekartoteket, og importen kastet
 * dem. Det er derfor varesøket føltes tomt ved siden av EFObasen — ikke fordi
 * dataene manglet, men fordi vi ikke tok vare på dem.
 *
 * Rene funksjoner, ingen database — selvtestes i `npm run verify:varekort`.
 *
 * Hva EFObasen fortsatt har som dette IKKE gir: ETIM-attributter (strukturerte
 * tekniske data), og varer ingen grossist du har fil fra fører. Det er ærlig
 * å si høyt — resten er dekket.
 */

/** FELTID-er i VX-poster vi er trygge på betydningen av. */
const BILDE = 'BILDE'
const FDV = 'FDV'
const HMS = 'HMS'
const EFOBASE = 'EFOBASE'

export type Varekort = {
  /**
   * Nøkkelen varen kobles på: el-nummer når linjeposten har det, ellers EAN.
   * Begge er universelle på tvers av grossister, som er hele poenget.
   */
  elnummer: string
  navn: string
  /** Produsent — «Nexans», «ABB», «Schneider». Det folk faktisk sier. */
  fabrikat: string | null
  /** Produsentens egen typebetegnelse. */
  typeBetegnelse: string | null
  /** Grossistens rabattgruppe. Faget bruker den som varegruppe. */
  rabattGruppe: string | null
  ean: string | null
  nrf: string | null
  bildeUrl: string | null
  fdvUrl: string | null
  hmsUrl: string | null
  efobaseId: string | null
  /** El-nummeret som erstatter denne når grossisten har merket den utgått. */
  erstattesAv: string | null
  /** Antall prisenheter i minste normale bestilling. */
  salgspakning: number | null
  /** Alle VX-felt, også de vi ikke har promotert. Ingenting skal gå tapt. */
  ekstra: Record<string, string>
  /** Ett felt å søke i, små bokstaver. Se lib/product-search.ts. */
  sokeTekst: string
}

/**
 * Ser verdien ut som noe som kan åpnes? BILDE/FDV/HMS er URL-er hos alle
 * grossistene vi har sett.
 *
 * `data:image/…` godtas også: et innebygd bilde ER en gyldig bildekilde, og
 * vakten finnes for å unngå DØDE lenker («se katalog», et arkivnummer), ikke
 * for å avvise bilder som følger med i fila.
 */
function somUrl(v: string | undefined): string | null {
  const s = v?.trim()
  if (!s) return null
  return /^(https?:\/\/|data:image\/)/i.test(s) ? s : null
}

/**
 * Søketeksten. Ett felt, små bokstaver, mellomromseparert — så SQLite kan
 * filtrere med LIKE før noe havner i JS. Uten den måtte hele varekartoteket
 * (titusenvis av rader) leses inn ved hvert tastetrykk.
 */
export function byggSokeTekst(deler: (string | null | undefined)[]): string {
  return deler
    .map(d => (d ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
    // Komma og skråstrek i «PFSP 3G2,5» og «1,5/2,5» skal ikke klistre ord sammen,
    // men tallet må også kunne søkes med komma. Derfor beholdes originalen OG
    // en variant der skilletegn er mellomrom.
    .replace(/\s+/g, ' ')
}

export function tilVarekort(vare: Vare): Varekort | null {
  const eanAlt = vare.alternativer.find(a => a.merke === 'ean')?.vareNr ?? null
  // El-nummer er den foretrukne nøkkelen — den er universell på tvers av
  // grossister. Men en linjepost kan være merket EAN i stedet (`merke = 2`),
  // og da er EAN like universell. Å hoppe over den var å kaste en vare vi
  // hadde full informasjon om.
  const el = elnummer(vare) ?? (vare.merke === 'ean' ? vare.vareNr : null)
  if (!el) return null

  const ekstra: Record<string, string> = {}
  for (const t of vare.tillegg) {
    if (!t.feltId) continue
    // Første forekomst vinner: noen grossister gjentar FELTID med tomme verdier.
    if (ekstra[t.feltId] === undefined && t.verdi.trim()) ekstra[t.feltId] = t.verdi.trim()
  }

  const ean = eanAlt ?? (vare.merke === 'ean' ? vare.vareNr : null)
  const nrf = vare.alternativer.find(a => a.merke === 'nrf')?.vareNr ?? null
  const erstattesAv = vare.alternativer.find(a => a.type === 'erstatning' && a.merke === 'elnummer')?.vareNr ?? null

  // Pakningsstørrelse kan stå både på linjeposten og som egen P-alternativpost.
  // Linjeposten vinner; alternativet er reserven.
  const pakning = vare.salgspakning
    ?? vare.alternativer.find(a => a.type === 'pakning')?.salgspakning
    ?? null

  return {
    elnummer: el,
    navn: vare.beskrivelse,
    fabrikat: vare.fabrikat,
    typeBetegnelse: vare.type,
    rabattGruppe: vare.rabattGruppe,
    ean,
    nrf,
    bildeUrl: somUrl(ekstra[BILDE]),
    fdvUrl: somUrl(ekstra[FDV]),
    hmsUrl: somUrl(ekstra[HMS]),
    efobaseId: ekstra[EFOBASE]?.trim() || null,
    erstattesAv,
    salgspakning: pakning,
    ekstra,
    sokeTekst: byggSokeTekst([vare.beskrivelse, el, vare.fabrikat, vare.type, ean, nrf, vare.rabattGruppe]),
  }
}

/**
 * Feltene i `ekstra` som er verdt å vise på varekortet, i rekkefølge.
 * Nøkler vi ikke kjenner vises til slutt med FELTID-en som etikett — bedre enn
 * å skjule data grossisten faktisk sendte.
 */
export const EKSTRA_ETIKETT: Record<string, string> = {
  DIMENSJON: 'Dimensjon',
  VEKT: 'Vekt',
  VOLUM: 'Volum',
  UNSPSC: 'UNSPSC',
}

/** Ekstrafelt som ikke allerede vises som lenke eller egen rad. */
export function visbareEkstra(ekstra: Record<string, string>): { etikett: string; verdi: string }[] {
  const skjult = new Set([BILDE, FDV, HMS, EFOBASE])
  const kjente = Object.keys(EKSTRA_ETIKETT)
  const nøkler = [
    ...kjente.filter(k => ekstra[k]),
    ...Object.keys(ekstra).filter(k => !skjult.has(k) && !kjente.includes(k)).sort(),
  ]
  return nøkler.map(k => ({ etikett: EKSTRA_ETIKETT[k] ?? k, verdi: ekstra[k] }))
}
