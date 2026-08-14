import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Assistentens hukommelse om DENNE montøren («foretrekker Elektroskandia»,
 * «jobber alltid i team med Glenn») — lagres kun etter brukerens eksplisitte ja
 * («vil du at jeg husker dette?»), leses inn i øktens systeminstruks ved start,
 * og kan slettes via glem_notat. Lokal per enhet (som reminders).
 */
export class AssistantNote extends Model {
  static table = 'assistant_notes'

  @text('user_id') userId: string
  @text('content') content: string
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
