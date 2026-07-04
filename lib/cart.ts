import { useEffect, useState } from 'react'
import { combineLatest } from 'rxjs'
import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import { Product } from './db/models/product'
import { StockMovement } from './db/models/stock-movement'
import { OrderMaterial } from './db/models/order-material'
import { syncQuietly } from './db/sync'

/**
 * Handlekurv = uplasserte lager-uttak (kind='ut', order_id=null). Uttaket trekker
 * fra lageret ved skann/registrering; kurven er «trukket, men uplassert». Å plassere
 * på en ordre setter order_id + skriver en materiallinje (§36/faktura).
 * v1-forenkling: én montør per enhet → kurven er uplasserte uttak på denne enheten.
 */
export type CartLine = { movement: StockMovement; product: Product }

/** Antall tatt vises positivt; bevegelsen lagrer det negativt (ut fra lager). */
export function takenQty(m: StockMovement): number {
  return Math.abs(m.quantity)
}

export function useCart(): CartLine[] {
  const [lines, setLines] = useState<CartLine[]>([])
  useEffect(() => {
    const movements$ = database.get<StockMovement>('stock_movements')
      .query(Q.where('kind', 'ut'), Q.where('order_id', null), Q.sortBy('created_at', Q.asc))
      .observe()
    const products$ = database.get<Product>('products').query().observe()
    const sub = combineLatest([movements$, products$]).subscribe(([movements, products]) => {
      const pMap = new Map(products.map(p => [p.id, p]))
      setLines(
        movements
          .map(m => ({ movement: m, product: pMap.get(m.productId) }))
          .filter((l): l is CartLine => !!l.product),
      )
    })
    return () => sub.unsubscribe()
  }, [])
  return lines
}

/** +/− på en kurvlinje. Ned til 0 fjerner linja (returnerer beholdning til lager). */
export async function adjustCartLine(m: StockMovement, delta: number) {
  const next = takenQty(m) + delta
  await database.write(async () => {
    if (next <= 0) await m.markAsDeleted()
    else await m.update(x => { x.quantity = -next })
  })
  syncQuietly()
}

export async function clearCart(lines: CartLine[]) {
  await database.write(async () => {
    for (const l of lines) await l.movement.markAsDeleted()
  })
  syncQuietly()
}

/** Plasser kurv på ordre: lås uttaket til ordren + skriv materiallinjer (docs/faktura). */
export async function assignCartToOrder(lines: CartLine[], orderId: string) {
  await database.write(async () => {
    for (const { movement, product } of lines) {
      await movement.update(m => { m.orderId = orderId })
      await database.get<OrderMaterial>('order_materials').create(om => {
        om.orderId = orderId
        om.elnummer = product.elnummer
        om.description = product.name
        om.quantity = takenQty(movement)
        om.unit = product.unit
      })
    }
  })
  syncQuietly()
}
