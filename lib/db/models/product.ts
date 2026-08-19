import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/** Vare. el-nummer er den universelle nøkkelen som gjør beholdning aggregerbar. */
export class Product extends Model {
  static table = 'products'

  @text('elnummer') elnummer: string | null
  @text('name') name: string
  @text('unit') unit: string
  /** Utsalgspris eks. mva. Fiken krever den for å opprette varen i regnskapet. */
  @field('unit_price') unitPrice: number | null
  /** Nettopris fra grossistens prisfil — grunnlaget for dekningsbidrag. */
  @field('cost_price') costPrice: number | null
  @text('vat_type') vatType: string | null
  @text('income_account') incomeAccount: string | null
  /** Hvilken grossist prisen kom fra. Ferskhet må kunne vises per grossist. */
  @text('supplier') supplier: string | null
  @date('price_updated_at') priceUpdatedAt: Date | null
  @text('source_system') sourceSystem: string | null
  @text('external_id') externalId: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
