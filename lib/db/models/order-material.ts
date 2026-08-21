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
  @text('product_id') productId: string | null
  /**
   * Pris-snapshot fra registreringstidspunktet. Varen kan prises om i morgen —
   * en ordre som allerede er utført skal ikke endre beløp av seg selv.
   */
  @field('unit_price') unitPrice: number | null
  /** Rabatt avtalt i tilbudet. Følger med når tilbudet blir ordre. */
  @field('discount_percent') discountPercent: number | null
  @field('cost_price') costPrice: number | null
  @text('vat_type') vatType: string | null
  /** null = ja. Eksplisitt false for garanti/omlevering. */
  @field('billable') billable: boolean | null
  @date('invoiced_at') invoicedAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
