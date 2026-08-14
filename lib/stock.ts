import { useEffect, useState } from 'react'
import { combineLatest } from 'rxjs'
import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import { Product } from './db/models/product'
import { StockMovement } from './db/models/stock-movement'

export type StockLine = { product: Product; qty: number }

const EPS = 1e-9

/** Beholdning per vare på én lokasjon — utledet av sum(bevegelser). Reaktivt. */
export function useLocationStock(locationId: string): StockLine[] {
  const [rows, setRows] = useState<StockLine[]>([])
  useEffect(() => {
    if (!locationId) return
    const movements$ = database.get<StockMovement>('stock_movements')
      .query(Q.where('location_id', locationId)).observeWithColumns(['quantity'])
    const products$ = database.get<Product>('products').query().observe()
    const sub = combineLatest([movements$, products$]).subscribe(([movements, products]) => {
      const byProduct = new Map<string, number>()
      for (const m of movements) byProduct.set(m.productId, (byProduct.get(m.productId) ?? 0) + m.quantity)
      const pMap = new Map(products.map(p => [p.id, p]))
      setRows(
        [...byProduct.entries()]
          .filter(([, qty]) => Math.abs(qty) > EPS)
          .map(([pid, qty]) => ({ product: pMap.get(pid), qty }))
          .filter((r): r is StockLine => !!r.product)
          .sort((a, b) => a.product.name.localeCompare(b.product.name)),
      )
    })
    return () => sub.unsubscribe()
  }, [locationId])
  return rows
}

/** Antall varelinjer (distinkte varer med beholdning) per lokasjon — for oversikten */
export function useLocationCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    const sub = database.get<StockMovement>('stock_movements').query().observeWithColumns(['quantity']).subscribe(movements => {
      // location -> product -> sum
      const perLoc = new Map<string, Map<string, number>>()
      for (const m of movements) {
        let byProduct = perLoc.get(m.locationId)
        if (!byProduct) { byProduct = new Map(); perLoc.set(m.locationId, byProduct) }
        byProduct.set(m.productId, (byProduct.get(m.productId) ?? 0) + m.quantity)
      }
      const out: Record<string, number> = {}
      for (const [loc, byProduct] of perLoc) {
        out[loc] = [...byProduct.values()].filter(q => Math.abs(q) > EPS).length
      }
      setCounts(out)
    })
    return () => sub.unsubscribe()
  }, [])
  return counts
}

export function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')
}
