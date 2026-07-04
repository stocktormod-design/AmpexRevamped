import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Materiell-linje på en ordre. Bærebjelken: forbruks-motor (→ lagertrekk),
 * autofyller §36-dokumentasjon, og blir fakturagrunnlag. elnummer er valgfritt
 * i v1 (fri beskrivelse holder), men er bestillingsnøkkelen når det finnes.
 */
export class OrderMaterial extends Model {
  static table = 'order_materials'

  @text('order_id') orderId: string
  @text('elnummer') elnummer: string | null
  @text('description') description: string
  @field('quantity') quantity: number
  @text('unit') unit: string
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
