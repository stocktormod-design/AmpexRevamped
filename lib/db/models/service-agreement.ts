import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Serviceavtale: gjentakende arbeid hos en kunde (årskontroll, internkontroll,
 * nødlys, brannvarsling).
 *
 * Avtalen EIER ikke ordrene sine. Den vet når neste kontroll forfaller og
 * hvilket skjema den krever; hver utførelse blir en helt vanlig ordre med
 * `serviceAgreementId` satt, slik at timer, materiell, fakturering og arkiv
 * virker som ellers.
 */
export class ServiceAgreement extends Model {
  static table = 'service_agreements'

  @text('customer_id') customerId: string | null
  @text('tittel') tittel: string
  @text('beskrivelse') beskrivelse: string | null
  @text('adresse') adresse: string | null
  @field('intervall_maneder') intervallManeder: number
  @date('neste_forfall') nesteForfall: Date
  @field('varsel_dager') varselDager: number
  @text('skjema_mal_id') skjemaMalId: string | null
  @field('estimert_timer') estimertTimer: number | null
  @field('aktiv') aktiv: boolean
  @date('sist_utfort_at') sistUtfortAt: Date | null
  @text('sist_ordre_id') sistOrdreId: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
