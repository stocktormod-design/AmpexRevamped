import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Person på en ordre. Medlemskap styrer hva AI-assistenten får omtale (full info
 * kun for ordrer du er med på — se lib/order-access.ts), og er tenkt gjenbrukt av
 * ordre-skjermene senere. user_name er snapshot så navn vises offline.
 */
export class OrderMember extends Model {
  static table = 'order_members'

  @text('order_id') orderId: string
  @text('user_id') userId: string
  @text('user_name') userName: string
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
