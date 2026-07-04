import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

/** Vare. el-nummer er den universelle nøkkelen som gjør beholdning aggregerbar. */
export class Product extends Model {
  static table = 'products'

  @text('elnummer') elnummer: string | null
  @text('name') name: string
  @text('unit') unit: string
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
