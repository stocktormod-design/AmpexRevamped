import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type MovementKind = 'inn' | 'ut' | 'overfor' | 'justering'

/**
 * Bevegelses-logg — eneste sannhet for beholdning.
 * beholdning per (product, location) = sum(quantity). Append-only i praksis:
 * en korreksjon er en ny 'justering', ikke en redigering.
 */
export class StockMovement extends Model {
  static table = 'stock_movements'

  @text('product_id') productId: string
  @text('location_id') locationId: string
  @field('quantity') quantity: number // fortegn: + inn, - ut
  @text('kind') kind: MovementKind
  @text('order_id') orderId: string | null
  @text('note') note: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
