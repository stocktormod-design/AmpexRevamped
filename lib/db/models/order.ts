import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type OrderStatus = 'mottatt' | 'planlagt' | 'pagaar' | 'fakturaklar' | 'fakturert'

export const orderStatusLabel: Record<OrderStatus, string> = {
  mottatt: 'Mottatt',
  planlagt: 'Planlagt',
  pagaar: 'Pågår',
  fakturaklar: 'Fakturaklar',
  fakturert: 'Fakturert',
}

export class Order extends Model {
  static table = 'orders'

  @field('order_number') orderNumber: number | null
  @text('title') title: string
  @text('description') description: string | null
  @text('customer_name') customerName: string | null
  @text('customer_phone') customerPhone: string | null
  @text('address') address: string | null
  @text('status') status: OrderStatus
  @text('assigned_to') assignedTo: string | null
  @date('scheduled_at') scheduledAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
