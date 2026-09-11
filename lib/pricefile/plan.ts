import { elnummer, type ParseResultat, type Vare } from './efo-nelfo'
import { tilVarekort, type Varekort } from './varekort'
import { erListepris, kostprisFra, type Prisrad } from '../pricing'
import { utledKategorier } from '../product-category'

/**
 * Prisfil -> varekartotek, kontorutgaven.
 *
 * Montørappens `lib/pricefile/import.ts` gjør det samme mot WatermelonDB fordi
 * telefonen er offline-først. Kontor-PC-en er ikke det: den sitter på nett, den
 * skriver en fil på titusenvis av linjer, og den skal ikke lagre en hel
 * grossistkatalog i en lokal SQLite bare for å synke den opp igjen. Derfor
 * skriver denne rett mot Supabase.
 *
 * Reglene er de samme, og de er ikke kosmetiske:
 *
 * - En rad per (vare, grossist) i `product_prices`. Prisen lå tidligere som én
 *   kolonne på varen, og da forsvant Onninens pris i det Solar ble importert.
 * - `products.cost_price` er den BILLIGSTE kjente prisen, ikke prisen i denne
 *   fila. Dekningsbidraget skal regne med det vi faktisk kan kjøpe for.
 * - En listepris slår aldri en ekte nettopris (`kostprisFra`). Et DB regnet på
 *   listepris er for lavt og får en lønnsom jobb til å se ulønnsom ut.
 * - Utsalgsprisen røres ikke uten at noen har bedt om et påslag. Grossistfila
 *   vet hva varen koster oss, ikke hva vi tar for den.
 *
 * Delingen i to er med vilje: `planleggImport()` er ren og har en selvtest
 * (`npm run verify:prisfil-plan`), `skrivImport()` gjør bare I/O.
 */

export type ImportValg = {
  /** Navn på grossisten fila kom fra. Lagres på hver prisrad. */
  grossist: string
  /**
   * Påslag i prosent på nettoprisen -> utsalgspris. Utelates den, settes
   * `unit_price` kun på varer som ikke har en fra før, og da til nettoprisen.
   */
  paslagProsent?: number
  /** Ta med varer grossisten har merket `utgaar`. Normalt av. */
  inkluderUtgaatte?: boolean
  /** Merkes på hver vare (`source_system`), så en prøveimport kan spores. */
  kilde?: string
}

export type ImportResultat = {
  nye: number
  oppdaterte: number
  /**
   * Varer uten el-nummer. De kan ikke kobles på tvers av grossister, og
   * hoppes over.
   *
   * Merk at EAN-varer (varemerke 2) havner her, selv om `tilVarekort()` godtar
   * EAN som nøkkel. Grensen er satt av `elnummer()`, og den er den samme som i
   * montørappens `lib/pricefile/import.ts` — de to skal ikke ha hvert sitt syn
   * på hva som er en importerbar vare. Skal EAN-varer inn, må begge endres, og
   * det er en egen beslutning.
   */
  utenElnummer: number
  utgaatte: number
  /** Varer der DENNE grossisten er billigst av dem vi har priser fra. */
  billigstHer: number
  /**
   * Linjer der fila ga LISTEPRIS, ikke firmaets pris (brutto uten rabatt).
   * En `V4` gir dette på alt. Da vet vi hva varen koster i katalogen, ikke hva
   * firmaet betaler.
   */
  listepriser: number
  /** Varer som fikk varekortdata (fabrikat, bilde, FDV ...) for første gang. */
  berikede: number
}

/** Kolonnene vi må lese for å kunne skrive en hel rad tilbake uten å tømme felt. */
export const VARE_KOLONNER =
  'id,elnummer,name,unit,unit_price,cost_price,vat_type,income_account,supplier,' +
  'fabrikat,type_betegnelse,discount_group,ean,nrf,image_url,fdv_url,hms_url,' +
  'efobase_id,replaced_by,sales_pack,extra,search_text,category,source_system,price_updated_at'

export const PRIS_KOLONNER = 'id,product_id,elnummer,supplier,net_price,price_type,discount_percent'

export type VareRad = {
  id: string
  company_id: string
  elnummer: string | null
  name: string
  unit: string
  unit_price: number | null
  cost_price: number | null
  vat_type: string | null
  income_account: string | null
  supplier: string | null
  fabrikat: string | null
  type_betegnelse: string | null
  discount_group: string | null
  ean: string | null
  nrf: string | null
  image_url: string | null
  fdv_url: string | null
  hms_url: string | null
  efobase_id: string | null
  replaced_by: string | null
  sales_pack: number | null
  extra: string | null
  search_text: string | null
  category: string | null
  source_system: string | null
  price_updated_at: string | null
  created_by: string | null
  updated_at: string
}

export type PrisRad = {
  id: string
  company_id: string
  product_id: string
  elnummer: string
  supplier: string
  net_price: number
  gross_price: number | null
  discount_percent: number | null
  price_type: string | null
  sales_pack: number | null
  stocked: boolean | null
  discontinued: boolean | null
  price_date: string | null
  valid_from: string | null
  valid_to: string | null
  imported_at: string
  created_by: string | null
  updated_at: string
}

/** Formen `planleggImport` trenger av en vare som allerede finnes. */
export type EksisterendeVare = Partial<VareRad> & { id: string; elnummer: string | null }

/** Formen `planleggImport` trenger av en prisrad som allerede finnes. */
export type EksisterendePris = {
  id: string
  product_id: string
  elnummer: string
  supplier: string
  net_price: number
  price_type: string | null
  discount_percent: number | null
}

export type Plan = {
  varer: VareRad[]
  priser: PrisRad[]
  resultat: ImportResultat
}

export type PlanKontekst = {
  companyId: string
  brukerId: string | null
  /** Sendes inn i stedet for å kalles direkte, så selvtesten kan være deterministisk. */
  nyId: () => string
  naa: Date
}

function ore(kr: number): number {
  return Math.round(kr * 100) / 100
}

function utsalgspris(netto: number, valg: ImportValg, eksisterende: number | null | undefined): number | null {
  if (valg.paslagProsent != null) return ore(netto * (1 + valg.paslagProsent / 100))
  // Uten påslagsregel skal en pris noen har satt for hånd aldri overskrives.
  return eksisterende ?? ore(netto)
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

function slaaSammenEkstra(gammel: string | null | undefined, ny: Record<string, string>): string | null {
  if (Object.keys(ny).length === 0) return gammel ?? null
  let fra: Record<string, string> = {}
  if (gammel) {
    try {
      const tolket: unknown = JSON.parse(gammel)
      if (tolket && typeof tolket === 'object' && !Array.isArray(tolket)) fra = tolket as Record<string, string>
    } catch {
      // Ugyldig JSON i basen skal ikke stoppe en import av femti tusen varer.
      fra = {}
    }
  }
  return JSON.stringify({ ...fra, ...ny })
}

/**
 * Regner ut hva som skal skrives, uten å skrive noe.
 *
 * Kalles to ganger i grensesnittet: en gang for forhåndsvisningen, og en gang
 * når importen kjøres. Det er billig nok, og det gjør at tallene brukeren så
 * er de samme tallene som skrives.
 */
export function planleggImport(
  resultat: ParseResultat,
  valg: ImportValg,
  eksisterendeVarer: EksisterendeVare[],
  eksisterendePriser: EksisterendePris[],
  ktx: PlanKontekst,
): Plan {
  const ut: ImportResultat = {
    nye: 0, oppdaterte: 0, utenElnummer: 0, utgaatte: 0,
    billigstHer: 0, berikede: 0, listepriser: 0,
  }

  type Kandidat = { vare: Vare; kort: Varekort }
  const kandidater: Kandidat[] = []
  for (const v of resultat.varer) {
    if (v.status === 'utgaar' && !valg.inkluderUtgaatte) { ut.utgaatte++; continue }
    if (!elnummer(v)) { ut.utenElnummer++; continue }
    const kort = tilVarekort(v)
    if (!kort) { ut.utenElnummer++; continue }
    kandidater.push({ vare: v, kort })
  }
  if (kandidater.length === 0) return { varer: [], priser: [], resultat: ut }

  const varePerEl = new Map<string, EksisterendeVare>()
  for (const p of eksisterendeVarer) if (p.elnummer) varePerEl.set(p.elnummer, p)

  const priserPerEl = new Map<string, EksisterendePris[]>()
  for (const r of eksisterendePriser) {
    const liste = priserPerEl.get(r.elnummer) ?? []
    liste.push(r)
    priserPerEl.set(r.elnummer, liste)
  }

  // Varegruppene utledes av HELE fila under ett: ordet som går igjen på flest
  // varer vinner. Med én vare av gangen ville «Skjermet installasjonskabel»
  // blitt gruppen «Skjermet».
  const kategorier = utledKategorier(kandidater.map(k => k.kort.navn))

  const naa = ktx.naa.toISOString()
  const gyldigFra = iso(resultat.hode.gyldigFra)
  const gyldigTil = iso(resultat.hode.gyldigTil)
  const varer: VareRad[] = []
  const priser: PrisRad[] = []

  for (let idx = 0; idx < kandidater.length; idx++) {
    const { vare, kort } = kandidater[idx]
    const kategori = kategorier[idx]
    const pris = ore(vare.nettoPris)
    const funnet = varePerEl.get(kort.elnummer)

    const denne: Prisrad = {
      grossist: valg.grossist,
      nettoPris: pris,
      priceType: vare.prisType,
      rabattProsent: vare.rabatt,
    }
    if (erListepris(denne)) ut.listepriser++

    // Prisbildet ETTER denne importen: alle andre grossisters priser på samme
    // el-nummer, pluss den vi skriver nå.
    const andre = (priserPerEl.get(kort.elnummer) ?? [])
      .filter(r => r.supplier !== valg.grossist)
      .map<Prisrad>(r => ({
        grossist: r.supplier, nettoPris: r.net_price,
        priceType: r.price_type, rabattProsent: r.discount_percent,
      }))
    const kost = kostprisFra([denne, ...andre])
    const billigste = kost?.pris ?? pris
    const billigsteGrossist = kost?.grossist ?? valg.grossist
    if (billigsteGrossist === valg.grossist) ut.billigstHer++

    const produktId = funnet?.id ?? ktx.nyId()
    if (funnet) {
      ut.oppdaterte++
      if (!funnet.fabrikat && kort.fabrikat) ut.berikede++
    } else {
      ut.nye++
      if (kort.fabrikat) ut.berikede++
    }

    // Varekortfelt fylles kun når fila FAKTISK har dem: en grossist uten bilde
    // skal ikke tømme et bilde en annen grossist ga oss.
    const behold = <T,>(ny: T | null, gammel: T | null | undefined): T | null => ny ?? gammel ?? null

    varer.push({
      id: produktId,
      company_id: ktx.companyId,
      elnummer: kort.elnummer,
      name: kort.navn,
      unit: vare.maaleEnhet === 'ukjent' ? (funnet?.unit ?? 'stk') : vare.maaleEnhet,
      // Kostpris = den BILLIGSTE kjente, ikke nødvendigvis denne fila.
      cost_price: billigste,
      unit_price: utsalgspris(billigste, valg, funnet?.unit_price),
      vat_type: funnet?.vat_type ?? 'hoy',
      income_account: funnet?.income_account ?? '3000',
      supplier: billigsteGrossist,
      price_updated_at: naa,
      source_system: valg.kilde ?? funnet?.source_system ?? null,
      fabrikat: behold(kort.fabrikat, funnet?.fabrikat),
      type_betegnelse: behold(kort.typeBetegnelse, funnet?.type_betegnelse),
      discount_group: behold(kort.rabattGruppe, funnet?.discount_group),
      ean: behold(kort.ean, funnet?.ean),
      nrf: behold(kort.nrf, funnet?.nrf),
      image_url: behold(kort.bildeUrl, funnet?.image_url),
      fdv_url: behold(kort.fdvUrl, funnet?.fdv_url),
      hms_url: behold(kort.hmsUrl, funnet?.hms_url),
      efobase_id: behold(kort.efobaseId, funnet?.efobase_id),
      replaced_by: behold(kort.erstattesAv, funnet?.replaced_by),
      sales_pack: kort.salgspakning ?? funnet?.sales_pack ?? null,
      extra: slaaSammenEkstra(funnet?.extra, kort.ekstra),
      search_text: kort.sokeTekst,
      category: kategori,
      created_by: funnet?.created_by ?? ktx.brukerId,
      updated_at: naa,
    })

    // En rad per (vare, grossist). Ny import fra samme grossist oppdaterer,
    // en annen grossist får sin egen.
    const min = (priserPerEl.get(kort.elnummer) ?? []).find(r => r.supplier === valg.grossist)
    priser.push({
      id: min?.id ?? ktx.nyId(),
      company_id: ktx.companyId,
      product_id: produktId,
      elnummer: kort.elnummer,
      supplier: valg.grossist,
      net_price: pris,
      gross_price: vare.prisType === 'brutto' ? ore(vare.pris) : null,
      discount_percent: vare.rabatt,
      price_type: vare.prisType,
      sales_pack: kort.salgspakning,
      stocked: vare.lagerfoert,
      discontinued: vare.status === 'utgaar',
      price_date: iso(vare.prisDato),
      valid_from: gyldigFra,
      valid_to: gyldigTil,
      imported_at: naa,
      created_by: ktx.brukerId,
      updated_at: naa,
    })
  }

  return { varer, priser, resultat: ut }
}

/**
 * Alle el-numrene en fil vil røre. Brukes til å hente eksisterende rader før
 * planen legges.
 *
 * Filteret MÅ være identisk med det `planleggImport` bruker. Er det videre,
 * slås det opp el-numre som aldri skrives; er det smalere, legges planen uten
 * å vite hva som allerede finnes, og en oppdatering blir til en ny vare.
 * Selvtesten sammenligner de to listene av nettopp den grunnen.
 */
export function elnumreIFil(resultat: ParseResultat, valg: ImportValg): string[] {
  const sett = new Set<string>()
  for (const v of resultat.varer) {
    if (v.status === 'utgaar' && !valg.inkluderUtgaatte) continue
    if (!elnummer(v)) continue
    const kort = tilVarekort(v)
    if (kort) sett.add(kort.elnummer)
  }
  return [...sett]
}

export function bolker<T>(liste: T[], storrelse: number): T[][] {
  const ut: T[][] = []
  for (let i = 0; i < liste.length; i += storrelse) ut.push(liste.slice(i, i + storrelse))
  return ut
}
