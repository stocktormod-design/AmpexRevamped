import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Fakturerbar aktivitet — «Montasje», «Feilsøking», «Kjøring».
 *
 * Både Fiken og Tripletex modellerer timer som aktivitet × person × dato, ikke
 * som timer på en ordre. Uten aktivitet kan en timeføring ikke bli en
 * fakturalinje, og timeprisen har ingen hjem.
 */
export class Activity extends Model {
  static table = 'activities'

  @text('name') name: string
  @field('hourly_rate') hourlyRate: number | null
  @field('billable') billable: boolean
  @text('vat_type') vatType: string | null
  @field('archived') archived: boolean
  @text('source_system') sourceSystem: string | null
  @text('external_id') externalId: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
