import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { combineLatest } from 'rxjs'
import { database } from './db'
import { Product } from './db/models/product'
import { StockMovement } from './db/models/stock-movement'
import { syncQuietly } from './db/sync'

/**
 * Varesøk. Fantes ikke før — varer ble kun opprettet ved å skrive navnet på nytt
 * hver gang, så «PFSP 3G2,5» og «PFSP 3g2.5» ble to varer med hver sin pris.
 *
 * Rangeringen er ikke alfabetisk, den er «hva mente han sannsynligvis»:
 * el-nummer treffer eksakt før navn, og navn som BEGYNNER med søket før navn
 * som bare inneholder det. En elektriker som taster «pfsp» vil ha kabelen, ikke
 * en artikkel med «pfsp» langt inne i beskrivelsen.
 */

export type Varetreff = {
  product: Product
  /** Total beholdning over alle lokasjoner. null når varen aldri er talt. */
  beholdning: number | null
}

const EPS = 1e-9

/** Kun siffer — el-nummer er sjusifret, så et rent talls√∏k er nesten alltid det. */
function erTall(s: string): boolean {
  return /^\d+$/.test(s)
}

function rangering(p: Product, q: string): number {
  const el = (p.elnummer ?? '').toLowerCase()
  const navn = p.name.toLowerCase()
  if (el && el === q) return 0
  if (el && el.startsWith(q)) return 1
  if (navn === q) return 2
  if (navn.startsWith(q)) return 3
  if (navn.includes(q)) return 4
  return 5
}

export function sokVarer(alle: Product[], sok: string, maks = 40): Product[] {
  const q = sok.trim().toLowerCase()
  if (!q) return alle.slice(0, maks)
  return alle
    .map(p => ({ p, r: rangering(p, q) }))
    .filter(x => x.r < 5)
    .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name, 'nb'))
    .slice(0, maks)
    .map(x => x.p)
}

/** Reaktivt varesøk med beholdning. Beholdning er sum(bevegelser), aldri et lagret tall. */
export function useVaresok(sok: string): Varetreff[] {
  const [treff, setTreff] = useState<Varetreff[]>([])
  useEffect(() => {
    const varer$ = database.get<Product>('products').query()
      .observeWithColumns(['name', 'elnummer', 'unit_price', 'cost_price', 'supplier'])
    const bevegelser$ = database.get<StockMovement>('stock_movements').query()
      .observeWithColumns(['quantity'])
    const sub = combineLatest([varer$, bevegelser$]).subscribe(([varer, bevegelser]) => {
      const perVare = new Map<string, number>()
      for (const b of bevegelser) perVare.set(b.productId, (perVare.get(b.productId) ?? 0) + b.quantity)
      setTreff(sokVarer(varer, sok).map(p => {
        const n = perVare.get(p.id)
        return { product: p, beholdning: n === undefined || Math.abs(n) < EPS ? null : n }
      }))
    })
    return () => sub.unsubscribe()
  }, [sok])
  return treff
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
