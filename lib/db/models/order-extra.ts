import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type TilleggStatus = 'foreslatt' | 'godkjent' | 'avvist'
export type TilleggPrising = 'fastpris' | 'medgatt'
export type GodkjenningsMate = 'muntlig' | 'sms' | 'epost' | 'signert'

export const tilleggStatusLabel: Record<TilleggStatus, string> = {
  foreslatt: 'Foreslått',
  godkjent: 'Godkjent',
  avvist: 'Avvist',
}

export const prisingLabel: Record<TilleggPrising, string> = {
  fastpris: 'Fastpris',
  medgatt: 'Etter medgått',
}

export const godkjenningLabel: Record<GodkjenningsMate, string> = {
  muntlig: 'Muntlig',
  sms: 'SMS',
  epost: 'E-post',
  signert: 'Signert',
}

/**
 * Tilleggsarbeid — arbeid kunden ikke bestilte opprinnelig.
 *
 * Dette er den vanligste pengelekkasjen i faget: montøren gjør noe ekstra fordi
 * det åpenbart måtte gjøres, ingen skrev det ned, og kunden nekter å betale.
 * Håndverkertjenesteloven §9 krever at forbrukeren kontaktes først, og i en
 * tvist er det HVEM som sa ja, NÅR og HVORDAN som avgjør.
 *
 * Derfor er godkjenningen egne felter og ikke en setning i et notat: et felt
 * kan mangle synlig, en setning kan bare være uskrevet.
 */
export class OrderExtra extends Model {
  static table = 'order_extras'

  @text('order_id') orderId: string
  @text('title') title: string
  @text('description') description: string | null
  @text('pricing') pricing: TilleggPrising
  /** Kr eks. mva. Kun meningsfylt ved fastpris. */
  @field('price') price: number | null
  @text('vat_type') vatType: string | null
  @text('status') status: TilleggStatus
  /** Navnet på personen hos kunden som sa ja. */
  @text('approved_by') approvedBy: string | null
  @date('approved_at') approvedAt: Date | null
  @text('approval_method') approvalMethod: GodkjenningsMate | null
  @date('invoiced_at') invoicedAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  /** Kan faktureres: godkjent, og enten fastpris med beløp eller etter medgått. */
  get erFakturerbar(): boolean {
    if (this.status !== 'godkjent') return false
    return this.pricing === 'medgatt' || this.price != null
  }
}
