import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

export type ReminderStatus = 'open' | 'done'

/**
 * Personlig påminnelse («ta med varmekabler i morgen») — IKKE det samme som
 * tasks: tasks er bas' arbeidsfordeling på prosjekter, reminders er brukerens
 * egen huskeliste. Første forbruker er AI-assistenten; forfalte/dagens
 * påminnelser leses inn i øktens systeminstruks (lib/ai/live-session.ts).
 */
export class Reminder extends Model {
  static table = 'reminders'

  @text('user_id') userId: string
  @text('title') title: string
  @date('due_at') dueAt: Date
  @text('order_id') orderId: string | null
  @text('note') note: string | null
  @text('status') status: ReminderStatus
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
