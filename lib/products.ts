import { Q } from '@nozbe/watermelondb'
import { useEffect, useMemo, useState } from 'react'
import { database } from './db'
import { Product } from './db/models/product'
import { ProductPrice } from './db/models/product-price'
import { StockMovement } from './db/models/stock-movement'
import { syncQuietly } from './db/sync'
import { byggSokeTekst } from './pricefile/varekort'
import {
  foreslaaRetting, likeMonster, sorterTreff,
  type Sortering, type SokbarVare, type Varefilter,
} from './product-search'
import { kategoriNavn } from './product-category'
import { byggPrisbilde, erListepris, type Prisbilde } from './pricing'

/**
 * Varesøk og varekort.
 *
 * Rangeringen ligger i `lib/product-search.ts` (ren, selvtestet). Her er
 * databasen: hvordan treffene hentes uten å lese hele kartoteket, og hvordan
 * prisene fra flere grossister settes sammen.
 *
 * **Hvorfor det ikke lenger lastes alt inn i minnet:** før abonnerte søket på
 * `products` OG `stock_movements` uten filter, og bygde et nytt abonnement ved
 * hvert tastetrykk. Usynlig med en håndskrevet fixture, umulig med en ekte
 * EFO-fil på titusenvis av linjer. Nå LIKE-filtrerer SQLite på `search_text`
 * først, og beholdning slås opp kun for de radene som faktisk ble treff.
 */

export type Grossistpris = {
  grossist: string
  nettoPris: number
  /**
   * Sann når fila bare ga LISTEPRIS (brutto uten rabatt) — altså en `V4`.
   * Da vet vi hva varen koster i katalogen, ikke hva firmaet betaler.
   */
  erListepris: boolean
  priceType: string | null
  rabattProsent: number | null
  /** Grossisten fører varen. null = ikke oppgitt i fila. */
  lagerfoert: boolean | null
  utgaatt: boolean
  salgspakning: number | null
  importertDato: Date | null
}

export type Varetreff = {
  product: Product
  /** Total beholdning over alle lokasjoner. null når varen aldri er talt. */
  beholdning: number | null
  /**
   * Prisbildet: alle grossisters priser, hvem som er billigst, og om
   * sammenligningen i det hele tatt er meningsfull. Se lib/pricing.ts —
   * en listepris får ALDRI slå en ekte nettopris.
   */
  pris: Prisbilde
  /** Snarveier, for lesbarhet i UI-et. */
  priser: Grossistpris[]
  billigste: Grossistpris | null
  besparelse: number | null
}

const EPS = 1e-9

function tilSokbar(p: Product): SokbarVare {
  return {
    id: p.id,
    elnummer: p.elnummer,
    navn: p.name,
    fabrikat: p.fabrikat,
    typeBetegnelse: p.typeBetegnelse,
    ean: p.ean,
    nrf: p.nrf,
    // Gamle varer (opprettet for hånd, eller importert før 19. august) har ingen
    // search_text. Bygg den på farten så de ikke blir usynlige i søket.
    sokeTekst: p.searchText ?? byggSokeTekst([p.name, p.elnummer, p.fabrikat, p.typeBetegnelse, p.ean, p.nrf]),
  }
}

function tilGrossistpris(r: ProductPrice): Grossistpris {
  const rad = {
    grossist: r.supplier,
    nettoPris: r.netPrice,
    priceType: r.priceType,
    rabattProsent: r.discountPercent,
  }
  return {
    ...rad,
    erListepris: erListepris(rad),
    lagerfoert: r.stocked,
    utgaatt: !!r.discontinued,
    salgspakning: r.salesPack,
    importertDato: r.importedAt ?? null,
  }
}

/**
 * Reaktivt varesøk.
 *
 * `sok` og `filter` styrer hva som hentes. Beholdning er sum(bevegelser), aldri
 * et lagret tall — et lagret antall og en bevegelseslogg som ikke stemmer
 * overens er verre enn ingen beholdning.
 */
export function useVaresok(sok: string, filter?: Varefilter, sortering: Sortering = 'relevans'): Varetreff[] {
  const [treff, setTreff] = useState<Varetreff[]>([])
  // Filteret er et objektliteral hos kalleren og ville ellers laget et nytt
  // abonnement ved hver render.
  const filterNokkel = JSON.stringify(filter ?? {})

  useEffect(() => {
    const f: Varefilter = JSON.parse(filterNokkel)
    let levende = true

    const klausuler = []
    const monster = likeMonster(sok)
    if (monster) klausuler.push(Q.where('search_text', Q.like(monster)))
    if (f.fabrikat) klausuler.push(Q.where('fabrikat', f.fabrikat))
    if (f.rabattGruppe) klausuler.push(Q.where('discount_group', f.rabattGruppe))
    if (f.kategori) klausuler.push(Q.where('category', f.kategori))

    const sub = database.get<Product>('products')
      .query(...klausuler)
      // observeWithColumns på et FILTRERT sett: endres en pris, kommer den
      // gjennom product_prices-oppslaget under, ikke gjennom et nytt abonnement.
      .observeWithColumns(['name', 'elnummer', 'fabrikat', 'type_betegnelse', 'ean', 'nrf', 'search_text', 'unit_price', 'cost_price', 'supplier', 'category'])
      .subscribe(async varer => {
        const rangert = sorterTreff(varer.map(p => ({ vare: tilSokbar(p), p })), sok)
        const ider = rangert.map(x => x.p.id)
        if (ider.length === 0) { if (levende) setTreff([]); return }

        const [bevegelser, prisrader] = await Promise.all([
          database.get<StockMovement>('stock_movements').query(Q.where('product_id', Q.oneOf(ider))).fetch(),
          database.get<ProductPrice>('product_prices').query(Q.where('product_id', Q.oneOf(ider))).fetch(),
        ])
        if (!levende) return

        const perVare = new Map<string, number>()
        for (const b of bevegelser) perVare.set(b.productId, (perVare.get(b.productId) ?? 0) + b.quantity)
        const prisPerVare = new Map<string, Grossistpris[]>()
        for (const r of prisrader) {
          const liste = prisPerVare.get(r.productId) ?? []
          liste.push(tilGrossistpris(r))
          prisPerVare.set(r.productId, liste)
        }

        const ut: Varetreff[] = []
        for (const { p } of rangert) {
          const n = perVare.get(p.id)
          const rader = prisPerVare.get(p.id) ?? []
          const beholdning = n === undefined || Math.abs(n) < EPS ? null : n

          if (f.kunPaaLager && (beholdning === null || beholdning <= 0)) continue
          if (f.grossist && !rader.some(x => x.grossist === f.grossist)) continue
          if (f.kunLagerfoert && !rader.some(x => x.lagerfoert === true)) continue

          const pris = byggPrisbilde(rader) as Prisbilde & { priser: Grossistpris[]; billigste: Grossistpris | null }
          ut.push({
            product: p,
            beholdning,
            pris,
            priser: pris.priser,
            billigste: pris.billigste,
            besparelse: pris.besparelse,
          })
        }
        // Sorteringen skjer ETTER filtrering, på hele treffmengden — ikke inne i
        // rangeringen. «Laveste pris» skal være laveste pris, ikke laveste pris
        // blant de mest relevante.
        if (sortering === 'pris') {
          ut.sort((a, b) => (a.billigste?.nettoPris ?? Infinity) - (b.billigste?.nettoPris ?? Infinity))
        } else if (sortering === 'navn') {
          ut.sort((a, b) => a.product.name.localeCompare(b.product.name, 'nb'))
        }
        setTreff(ut)
      })

    return () => { levende = false; sub.unsubscribe() }
  }, [sok, filterNokkel, sortering])

  return treff
}

/**
 * Varesøk uten hook — for AI-assistenten og andre som ikke rendrer.
 *
 * Samme rangering og samme prisbilde som skjermen bruker, så assistenten og
 * søkefeltet aldri kan gi to forskjellige svar på samme spørsmål.
 */
export async function finnVarer(sok: string, maks = 5): Promise<Varetreff[]> {
  const monster = likeMonster(sok)
  const varer = await database.get<Product>('products')
    .query(...(monster ? [Q.where('search_text', Q.like(monster))] : []))
    .fetch()
  const rangert = sorterTreff(varer.map(p => ({ vare: tilSokbar(p), p })), sok, maks)
  if (rangert.length === 0) return []

  const ider = rangert.map(x => x.p.id)
  const [bevegelser, prisrader] = await Promise.all([
    database.get<StockMovement>('stock_movements').query(Q.where('product_id', Q.oneOf(ider))).fetch(),
    database.get<ProductPrice>('product_prices').query(Q.where('product_id', Q.oneOf(ider))).fetch(),
  ])
  const perVare = new Map<string, number>()
  for (const b of bevegelser) perVare.set(b.productId, (perVare.get(b.productId) ?? 0) + b.quantity)
  const prisPerVare = new Map<string, Grossistpris[]>()
  for (const r of prisrader) {
    const liste = prisPerVare.get(r.productId) ?? []
    liste.push(tilGrossistpris(r))
    prisPerVare.set(r.productId, liste)
  }

  return rangert.map(({ p }) => {
    const n = perVare.get(p.id)
    const pris = byggPrisbilde(prisPerVare.get(p.id) ?? []) as Prisbilde & { priser: Grossistpris[]; billigste: Grossistpris | null }
    return {
      product: p,
      beholdning: n === undefined || Math.abs(n) < EPS ? null : n,
      pris,
      priser: pris.priser,
      billigste: pris.billigste,
      besparelse: pris.besparelse,
    }
  })
}

/** Første treff, eller null. Assistenten trenger ofte bare «hvilken vare». */
export async function finnVare(sok: string): Promise<Varetreff | null> {
  return (await finnVarer(sok, 1))[0] ?? null
}

/** Én vare med hele prisbildet — grunnlaget for varekortet. */
export function useVare(id: string | null | undefined): {
  product: Product | null
  priser: Grossistpris[]
  pris: Prisbilde & { priser: Grossistpris[]; billigste: Grossistpris | null }
} {
  const [product, setProduct] = useState<Product | null>(null)
  const [priser, setPriser] = useState<Grossistpris[]>([])

  useEffect(() => {
    if (!id) { setProduct(null); setPriser([]); return }
    const sub = database.get<Product>('products').findAndObserve(id).subscribe({
      next: setProduct,
      error: () => setProduct(null),
    })
    return () => sub.unsubscribe()
  }, [id])

  useEffect(() => {
    if (!id) { setPriser([]); return }
    const sub = database.get<ProductPrice>('product_prices')
      .query(Q.where('product_id', id))
      .observe()
      .subscribe(rader => setPriser(rader.map(tilGrossistpris)))
    return () => sub.unsubscribe()
  }, [id])

  const pris = useMemo(
    () => byggPrisbilde(priser) as Prisbilde & { priser: Grossistpris[]; billigste: Grossistpris | null },
    [priser],
  )
  return { product, priser: pris.priser, pris }
}

export type Kategoritelling = {
  kategori: string
  antall: number
  /** Bilde fra en vare i gruppen — nok til å kjenne igjen gruppen visuelt. */
  bilde: string | null
}

/**
 * Varegruppene med antall — grunnlaget for å BLA i stedet for å søke.
 *
 * Det er dette grossistens nettbutikk har og et søkefelt ikke gir: du vet ikke
 * alltid hva varen heter, men du vet at du skal ha en koblingsboks.
 */
export function useKategorier(): Kategoritelling[] {
  const [rader, setRader] = useState<Kategoritelling[]>([])
  useEffect(() => {
    const sub = database.get<Product>('products')
      .query()
      .observeWithColumns(['category', 'image_url'])
      .subscribe(varer => {
        const per = new Map<string, { antall: number; bilde: string | null }>()
        for (const v of varer) {
          const k = kategoriNavn(v.category)
          const rad = per.get(k) ?? { antall: 0, bilde: null }
          rad.antall++
          // Første bilde vinner — gruppen skal ha ETT ansikt, ikke et tilfeldig
          // som skifter når kartoteket sorteres om.
          if (!rad.bilde && v.imageUrl) rad.bilde = v.imageUrl
          per.set(k, rad)
        }
        setRader([...per.entries()]
          .map(([kategori, r]) => ({ kategori, antall: r.antall, bilde: r.bilde }))
          // Størst gruppe først: det er der sjansen for treff er høyest.
          // «Annet» sist uansett — den er en restpost, ikke en varegruppe.
          .sort((a, b) => (a.kategori === 'Annet' ? 1 : 0) - (b.kategori === 'Annet' ? 1 : 0)
            || b.antall - a.antall || a.kategori.localeCompare(b.kategori, 'nb')))
      })
    return () => sub.unsubscribe()
  }, [])
  return rader
}

/**
 * «Mente du …» — nærmeste kjente varegruppe eller produsent.
 *
 * Måles kun mot de ordene, ikke mot hele katalogen: en redigeringsavstand mot
 * 40 000 varenavn per tastetrykk ville stått i veien for det den skal hjelpe med.
 */
export function useMenteDu(sok: string, harTreff: boolean): string | null {
  const kategorier = useKategorier()
  const fabrikater = useFabrikater()
  return useMemo(() => {
    if (harTreff || !sok.trim()) return null
    return foreslaaRetting(sok, [...kategorier.map(k => k.kategori), ...fabrikater])
  }, [sok, harTreff, kategorier, fabrikater])
}

/** Alle fabrikater i kartoteket, alfabetisk. Grunnlaget for produsentfilteret. */
export function useFabrikater(): string[] {
  const [navn, setNavn] = useState<string[]>([])
  useEffect(() => {
    const sub = database.get<Product>('products')
      .query(Q.where('fabrikat', Q.notEq(null)))
      .observeWithColumns(['fabrikat'])
      .subscribe(varer => {
        setNavn([...new Set(varer.map(p => p.fabrikat).filter((x): x is string => !!x))]
          .sort((a, b) => a.localeCompare(b, 'nb')))
      })
    return () => sub.unsubscribe()
  }, [])
  return navn
}

/** Alle grossister vi har priser fra. Grunnlaget for grossistfilteret. */
export function useGrossister(): string[] {
  const [navn, setNavn] = useState<string[]>([])
  useEffect(() => {
    const sub = database.get<ProductPrice>('product_prices')
      .query()
      .observeWithColumns(['supplier'])
      .subscribe(rader => {
        setNavn([...new Set(rader.map(r => r.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nb')))
      })
    return () => sub.unsubscribe()
  }, [])
  return navn
}

/** Hvor mange varer kartoteket inneholder. Vises når søket er tomt. */
export function useVareantall(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const sub = database.get<Product>('products').query().observeCount().subscribe(setN)
    return () => sub.unsubscribe()
  }, [])
  return n
}

/**
 * Finn eller opprett på el-nummer, ellers navn.
 *
 * El-nummer først med vilje: det er den universelle nøkkelen på tvers av
 * grossister, og to montører som skriver navnet ulikt skal likevel treffe samme
 * vare når nummeret stemmer.
 */
export async function finnEllerOpprettVare(input: {
  navn: string; elnummer?: string | null; enhet?: string
}): Promise<Product> {
  const collection = database.get<Product>('products')
  const el = input.elnummer?.trim() || null
  if (el) {
    const [treff] = await collection.query(Q.where('elnummer', el)).fetch()
    if (treff) return treff
  }
  const navn = input.navn.trim()
  const alle = await collection.query().fetch()
  const påNavn = alle.find(p => p.name.trim().toLowerCase() === navn.toLowerCase())
  if (påNavn) return påNavn
  const ny = await database.write(async () =>
    collection.create(p => {
      p.name = navn
      p.elnummer = el
      p.unit = input.enhet ?? 'stk'
      p.vatType = 'hoy'
      p.searchText = byggSokeTekst([navn, el])
    }),
  )
  syncQuietly()
  return ny
}

export function formatBeholdning(n: number | null, enhet: string): string {
  if (n === null) return '—'
  const tall = Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')
  return `${tall} ${enhet}`
}

export { type Varefilter } from './product-search'
