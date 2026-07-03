import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type OrderDocumentStatus = 'utkast' | 'fullfort'

export class OrderDocument extends Model {
  static table = 'order_documents'

  @text('order_id') orderId: string
  @text('template_id') templateId: string
  @field('template_version') templateVersion: number
  @text('status') status: OrderDocumentStatus
  @text('data') data: string | null // JSON: Record<fieldKey, verdi>
  @text('completed_by') completedBy: string | null
  @date('completed_at') completedAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
