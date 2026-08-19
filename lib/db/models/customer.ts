import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Kunde. Fantes ikke før v22 — ordren bar navn og telefon som løse felt.
 * Begge regnskaps-API-ene (Fiken `contact`, Tripletex `customer`) krever en
 * kunde med ID for å henge en faktura på; uten denne tabellen lager hver
 * fakturasynk et navneoppslag som duplikerer kunder i regnskapet.
 *
 * `source_system` + `external_id` er speilingsnøkkelen: er kunden hentet fra
 * Fiken, eier Fiken den, og vi skriver ikke over navnet ved neste synk.
 */
export class Customer extends Model {
  static table = 'customers'

  @text('name') name: string
  @text('org_nr') orgNr: string | null
  @field('is_company') isCompany: boolean
  @text('email') email: string | null
  @text('phone') phone: string | null
  @text('address') address: string | null
  @text('postal_code') postalCode: string | null
  @text('city') city: string | null
  @text('note') note: string | null
  @text('source_system') sourceSystem: string | null
  @text('external_id') externalId: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  /** Én linje til liste og fakturahode: «Storgata 4, 0155 Oslo» */
  get postalAddress(): string {
    return [this.address, [this.postalCode, this.city].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ')
  }
}
