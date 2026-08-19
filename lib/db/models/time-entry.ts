import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Timeføring på ordre. Første forbruker er AI-assistenten (foer_timer-verktøyet i
 * lib/ai/live-session.ts) — egen timeliste-skjerm kommer senere og leser samme
 * tabell. user_name er snapshot så navn vises offline.
 */
export class TimeEntry extends Model {
  static table = 'time_entries'

  @text('order_id') orderId: string
  @text('user_id') userId: string
  @text('user_name') userName: string
  @date('date') date: Date
  @field('hours') hours: number
  /** Synlig på faktura (Fiken `description`, Tripletex `comment`). */
  @text('note') note: string | null
  /** Aldri med på faktura (Fiken `internalNote`). «Kunden var sur» hører hit. */
  @text('internal_note') internalNote: string | null
  @text('activity_id') activityId: string | null
  /** null = arv fra aktiviteten. Eksplisitt false overstyrer. */
  @field('billable') billable: boolean | null
  @date('invoiced_at') invoicedAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
