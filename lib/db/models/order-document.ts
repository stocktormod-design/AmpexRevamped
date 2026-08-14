import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type OrderDocumentStatus = 'utkast' | 'fullfort'

/** Sporer om et felt kom fra AI-diktering eller ble skrevet/redigert av et menneske. */
export type AiFieldOrigin = { origin: 'ai' | 'human'; reason?: string }
export type AiFieldOriginMap = Record<string, AiFieldOrigin>

export class OrderDocument extends Model {
  static table = 'order_documents'

  @text('order_id') orderId: string
  @text('template_id') templateId: string
  @field('template_version') templateVersion: number
  @text('status') status: OrderDocumentStatus
  @text('data') data: string | null // JSON: Record<fieldKey, verdi>
  @text('ai_field_origin') aiFieldOrigin: string | null // JSON: AiFieldOriginMap
  @text('completed_by') completedBy: string | null
  @date('completed_at') completedAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  get aiOriginMap(): AiFieldOriginMap {
    if (!this.aiFieldOrigin) return {}
    try { return JSON.parse(this.aiFieldOrigin) as AiFieldOriginMap } catch { return {} }
  }
}
