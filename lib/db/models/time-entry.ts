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
  @text('note') note: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
