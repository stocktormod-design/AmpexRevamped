import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Product } from '../db/models/product'
import { ProductPrice } from '../db/models/product-price'
import { syncQuietly } from '../db/sync'
import { elnummer, type ParseResultat, type Vare } from './efo-nelfo'
import { tilVarekort, type Varekort } from './varekort'
import { erListepris, kostprisFra, type Prisrad } from '../pricing'
import { utledKategorier } from '../product-category'

/**
 * Prisfil → varekartotek.
 *
 * To ting ble rettet 19. august, og begge var strukturelle:
 *
 * **1. Prisen lå som én kolonne på varen.** Importerte du Solar etter Onninen,
 * ble Onninens pris borte. Prissammenligning — hele salgsargumentet mot
 * Ahlsell og Onninens egne systemer — var strukturelt umulig. Nå skrives én rad
 * per (vare, grossist) i `product_prices`. `products.cost_price` beholdes som
 * den BILLIGSTE kjente prisen, fordi det er den fakturagrunnlaget og
 * dekningsbidraget skal regne med.
 *
 * **2. Halve fila ble kastet.** `VX`- og `VA`-postene inneholder fabrikat,
 * typebetegnelse, EAN, NRF, bilde, FDV, HMS, erstatningsvare og
 * pakningsstørrelse. Det er nøyaktig det som gjør EFObasen til EFObasen, og det
 * lå i fila hele tiden. Se `lib/pricefile/varekort.ts`.
 *
 * Uendret fra før: **kostpris = nettopris, utsalg røres ikke.** Grossistfila vet
 * hva varen koster oss, ikke hva vi tar for den. Påslaget er bedriftens
 * beslutning, og settes med `paslagProsent`.
 */

export type ImportValg = {
  /** Navn på grossisten fila kom fra. Lagres på hver prisrad. */
  grossist: string
  /**
   * Påslag i prosent på nettoprisen → utsalgspris. Utelates den, settes
   * `unit_price` kun på varer som ikke har en fra før, og da til nettoprisen.
   */
  paslagProsent?: number
  /** Ta med varer grossisten har merket `utgaar`. Normalt av. */
  inkluderUtgaatte?: boolean
  /**
   * Merkes på hver vare (`source_system`). Settes til 'demo' av demokatalogen,
   * så oppdiktede priser aldri kan forveksles med ekte — og kan fjernes igjen.
   */
  kilde?: string
}

export type ImportResultat = {
  nye: number
  oppdaterte: number
  hoppetOver: number
  /** Varer uten el-nummer kan ikke kobles på tvers av grossister. */
  utenElnummer: number
  utgaatte: number
  /** Varer der DENNE grossisten er billigst av dem vi har priser fra. */
  billigstHer: number
  /**
   * Linjer der fila ga LISTEPRIS, ikke firmaets pris (brutto uten rabatt).
   * En `V4` gir dette på alt. Da vet vi hva varen koster i katalogen, ikke hva
   * firmaet betaler — og dekningsbidraget blir for lavt.
   */
  listepriser: number
  /** Varer som fikk varekortdata (fabrikat, bilde, FDV …) for første gang. */
  berikede: number
}

function utsalgspris(netto: number, valg: ImportValg, eksisterende: number | null): number | null {
  if (valg.paslagProsent != null) {
    return Math.round(netto * (1 + valg.paslagProsent / 100) * 100) / 100
  }
  // Uten påslagsregel skal en pris noen har satt for hånd aldri overskrives.
  return eksisterende ?? Math.round(netto * 100) / 100
}

/** Nettopris i kroner, avrundet til øre. */
function netto(vare: Vare): number {
  return Math.round(vare.nettoPris * 100) / 100
}

export async function importerPrisfil(
  resultat: ParseResultat,
  valg: ImportValg,
): Promise<ImportResultat> {
  const ut: ImportResultat = {
    nye: 0, oppdaterte: 0, hoppetOver: 0, utenElnummer: 0, utgaatte: 0,
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
  if (kandidater.length === 0) return ut

  // Ett oppslag for alle el-numrene i stedet for ett per vare. En varefil har
  // titusenvis av linjer; N spørringer ville tatt minutter på en telefon.
  const BOLK = 500
  const nr = kandidater.map(k => k.kort.elnummer)
  const eksisterende = new Map<string, Product>()
  for (let i = 0; i < nr.length; i += BOLK) {
    const treff = await database.get<Product>('products')
      .query(Q.where('elnummer', Q.oneOf(nr.slice(i, i + BOLK)))).fetch()
    for (const p of treff) if (p.elnummer) eksisterende.set(p.elnummer, p)
  }

  // Alle kjente priser på de samme el-numrene, fra ALLE grossister. Trengs for
  // å avgjøre hvem som er billigst etter at denne fila er lest inn.
  const priserPerEl = new Map<string, ProductPrice[]>()
  for (let i = 0; i < nr.length; i += BOLK) {
    const rader = await database.get<ProductPrice>('product_prices')
      .query(Q.where('elnummer', Q.oneOf(nr.slice(i, i + BOLK)))).fetch()
    for (const r of rader) {
      const liste = priserPerEl.get(r.elnummer) ?? []
      liste.push(r)
      priserPerEl.set(r.elnummer, liste)
    }
  }

  // Varegruppene utledes av HELE fila under ett: ordet som går igjen på flest
  // varer vinner. Med én vare av gangen ville «Skjermet installasjonskabel»
  // blitt gruppen «Skjermet».
  const kategorier = utledKategorier(kandidater.map(k => k.kort.navn))

  const naa = new Date()
  const gyldigFra = resultat.hode.gyldigFra
  const gyldigTil = resultat.hode.gyldigTil
  const produkter = database.get<Product>('products')
  const priser = database.get<ProductPrice>('product_prices')

  await database.write(async () => {
    const operasjoner: unknown[] = []

    for (let idx = 0; idx < kandidater.length; idx++) {
      const { vare, kort } = kandidater[idx]
      const kategori = kategorier[idx]
      const pris = netto(vare)
      const funnet = eksisterende.get(kort.elnummer)

      const denne: Prisrad = {
        grossist: valg.grossist,
        nettoPris: pris,
        priceType: vare.prisType,
        rabattProsent: vare.rabatt,
      }
      if (erListepris(denne)) ut.listepriser++

      // Prisbildet ETTER denne importen: alle andre grossisters priser på samme
      // el-nummer, pluss den vi skriver nå. `kostprisFra` lar ALDRI en listepris
      // slå en ekte nettopris — et dekningsbidrag regnet på listepris er for
      // lavt, og får en lønnsom jobb til å se ulønnsom ut.
      const andre = (priserPerEl.get(kort.elnummer) ?? [])
        .filter(r => r.supplier !== valg.grossist)
        .map<Prisrad>(r => ({
          grossist: r.supplier, nettoPris: r.netPrice,
          priceType: r.priceType, rabattProsent: r.discountPercent,
        }))
      const kost = kostprisFra([denne, ...andre])
      const billigste = kost?.pris ?? pris
      const billigsteGrossist = kost?.grossist ?? valg.grossist
      const viErBilligst = billigsteGrossist === valg.grossist
      if (viErBilligst) ut.billigstHer++

      let produktId: string
      if (funnet) {
        ut.oppdaterte++
        if (!funnet.fabrikat && kort.fabrikat) ut.berikede++
        produktId = funnet.id
        operasjoner.push(funnet.prepareUpdate(p => {
          p.name = kort.navn
          p.unit = vare.maaleEnhet === 'ukjent' ? p.unit : vare.maaleEnhet
          // Kostpris = den BILLIGSTE kjente, ikke nødvendigvis denne fila.
          // Dekningsbidraget skal regne med det vi faktisk kan kjøpe for.
          p.costPrice = billigste
          p.unitPrice = utsalgspris(billigste, valg, p.unitPrice)
          p.vatType = p.vatType ?? 'hoy'
          p.supplier = billigsteGrossist
          p.priceUpdatedAt = naa
          if (valg.kilde) p.sourceSystem = valg.kilde
          // Varekortfelt fylles kun når fila FAKTISK har dem — en grossist uten
          // bilde skal ikke tømme et bilde en annen grossist ga oss.
          if (kort.fabrikat) p.fabrikat = kort.fabrikat
          if (kort.typeBetegnelse) p.typeBetegnelse = kort.typeBetegnelse
          if (kort.rabattGruppe) p.discountGroup = kort.rabattGruppe
          if (kort.ean) p.ean = kort.ean
          if (kort.nrf) p.nrf = kort.nrf
          if (kort.bildeUrl) p.imageUrl = kort.bildeUrl
          if (kort.fdvUrl) p.fdvUrl = kort.fdvUrl
          if (kort.hmsUrl) p.hmsUrl = kort.hmsUrl
          if (kort.efobaseId) p.efobaseId = kort.efobaseId
          if (kort.erstattesAv) p.replacedBy = kort.erstattesAv
          if (kort.salgspakning != null) p.salesPack = kort.salgspakning
          if (Object.keys(kort.ekstra).length > 0) {
            p.extra = JSON.stringify({ ...p.ekstraFelt, ...kort.ekstra })
          }
          p.searchText = kort.sokeTekst
          p.category = kategori
        }))
      } else {
        ut.nye++
        if (kort.fabrikat) ut.berikede++
        const ny = produkter.prepareCreate(p => {
          p.elnummer = kort.elnummer
          p.name = kort.navn
          p.unit = vare.maaleEnhet === 'ukjent' ? 'stk' : vare.maaleEnhet
          p.costPrice = billigste
          p.unitPrice = utsalgspris(billigste, valg, null)
          p.vatType = 'hoy'
          p.incomeAccount = '3000'
          p.supplier = billigsteGrossist
          p.priceUpdatedAt = naa
          p.sourceSystem = valg.kilde ?? null
          p.fabrikat = kort.fabrikat
          p.typeBetegnelse = kort.typeBetegnelse
          p.discountGroup = kort.rabattGruppe
          p.ean = kort.ean
          p.nrf = kort.nrf
          p.imageUrl = kort.bildeUrl
          p.fdvUrl = kort.fdvUrl
          p.hmsUrl = kort.hmsUrl
          p.efobaseId = kort.efobaseId
          p.replacedBy = kort.erstattesAv
          p.salesPack = kort.salgspakning
          p.extra = Object.keys(kort.ekstra).length > 0 ? JSON.stringify(kort.ekstra) : null
          p.searchText = kort.sokeTekst
          p.category = kategori
        })
        produktId = ny.id
        operasjoner.push(ny)
      }

      // Prisraden for DENNE grossisten. Én per (vare, grossist) — ny import fra
      // samme grossist oppdaterer, en annen grossist får sin egen rad.
      const min = (priserPerEl.get(kort.elnummer) ?? []).find(r => r.supplier === valg.grossist)
      const settPris = (r: ProductPrice) => {
        r.productId = produktId
        r.elnummer = kort.elnummer
        r.supplier = valg.grossist
        r.netPrice = pris
        r.grossPrice = vare.prisType === 'brutto' ? Math.round(vare.pris * 100) / 100 : null
        r.discountPercent = vare.rabatt
        r.priceType = vare.prisType
        r.salesPack = kort.salgspakning
        r.stocked = vare.lagerfoert
        r.discontinued = vare.status === 'utgaar'
        r.priceDate = vare.prisDato
        r.validFrom = gyldigFra
        r.validTo = gyldigTil
        r.importedAt = naa
      }
      operasjoner.push(min ? min.prepareUpdate(settPris) : priser.prepareCreate(settPris))
    }

    for (let i = 0; i < operasjoner.length; i += BOLK) {
      await database.batch(...(operasjoner.slice(i, i + BOLK) as never[]))
    }
  })

  syncQuietly()
  return ut
}

/**
 * Ferskhet per grossist — «Onninen: 3 dager siden, Solar: 94 dager siden».
 *
 * Leses nå fra `product_prices`, ikke fra `products.supplier`. Forskjellen er
 * ikke kosmetisk: før viste den bare hvilken import som sist rørte hver vare,
 * så en grossist forsvant helt fra lista i det en annen ble importert over.
 */
export async function prisferskhet(): Promise<{ grossist: string; sistOppdatert: Date; antall: number }[]> {
  const rader = await database.get<ProductPrice>('product_prices').query().fetch()
  const per = new Map<string, { sist: number; antall: number }>()
  for (const r of rader) {
    const rad = per.get(r.supplier) ?? { sist: 0, antall: 0 }
    rad.sist = Math.max(rad.sist, r.importedAt?.getTime() ?? 0)
    rad.antall++
    per.set(r.supplier, rad)
  }
  return [...per.entries()]
    .map(([grossist, r]) => ({ grossist, sistOppdatert: new Date(r.sist), antall: r.antall }))
    .sort((a, b) => b.sistOppdatert.getTime() - a.sistOppdatert.getTime())
}
