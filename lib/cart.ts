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
      .observeWithColumns(['quantity'])
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
        // Pris-snapshot fra varen. Uten dette får linja ingen pris, og
        // fakturagrunnlaget lister den som «mangler pris» i stedet for å
        // stilltiende fakturere den til null.
        om.productId = product.id
        om.unitPrice = product.unitPrice
        om.costPrice = product.costPrice
        om.vatType = product.vatType ?? 'hoy'
      })
    }
  })
  syncQuietly()
}

/**
 * ── Å slette en materiallinje er ikke bare å slette en rad ──────────────────
 *
 * Et uttak fra bilen finnes som TO rader: `stock_movements` (varen er fysisk
 * ute av lageret) og `order_materials` (den skal på fakturaen). Slettet man
 * bare den siste, ble beholdningen stående for lav for alltid — uten spor, og
 * uten at noen kunne se hvorfor bilen manglet ti downlights.
 *
 * De to utfallene er fysisk forskjellige og bare mennesket vet hvilket som
 * gjelder, så vi gjetter ikke:
 *
 *   'tilbake'   varen ble lagt tilbake i bilen → uttaket slettes, beholdningen
 *               er som før
 *   'beholdt'   varen er fortsatt ute, bare ikke på DENNE ordren → uttaket
 *               løsnes fra ordren og ligger igjen som uplassert (kurven)
 */
export type SlettMateriellValg = 'tilbake' | 'beholdt'

/** Uttak som hører til denne materiallinja. Kobles på ordre + vare — det er
 *  det eneste båndet som finnes mellom de to radene. */
export async function uttakForMateriell(material: OrderMaterial): Promise<StockMovement[]> {
  if (!material.productId) return []
  return database.get<StockMovement>('stock_movements')
    .query(
      Q.where('order_id', material.orderId),
      Q.where('product_id', material.productId),
      Q.where('kind', 'ut'),
    )
    .fetch()
}

export async function slettMateriell(material: OrderMaterial, valg: SlettMateriellValg): Promise<void> {
  const uttak = await uttakForMateriell(material)
  await database.write(async () => {
    for (const m of uttak) {
      if (valg === 'tilbake') await m.markAsDeleted()
      else await m.update(x => { x.orderId = null })
    }
    await material.markAsDeleted()
  })
  syncQuietly()
}
