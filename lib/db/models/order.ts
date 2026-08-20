import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type OrderStatus = 'mottatt' | 'planlagt' | 'pagaar' | 'fakturaklar' | 'fakturert'

/** Naturlig rekkefølge i flyten: mottatt → planlagt → pågår → fakturaklar → fakturert */
export const orderStatuses: OrderStatus[] = ['mottatt', 'planlagt', 'pagaar', 'fakturaklar', 'fakturert']

export const orderStatusLabel: Record<OrderStatus, string> = {
  mottatt: 'Mottatt',
  planlagt: 'Planlagt',
  pagaar: 'Pågår',
  fakturaklar: 'Fakturaklar',
  fakturert: 'Fakturert',
}

export class Order extends Model {
  static table = 'orders'

  @field('order_number') orderNumber: number | null
  @text('title') title: string
  @text('description') description: string | null
  @text('customer_name') customerName: string | null
  @text('customer_phone') customerPhone: string | null
  @text('address') address: string | null
  @text('status') status: OrderStatus
  @text('assigned_to') assignedTo: string | null
  @date('scheduled_at') scheduledAt: Date | null
  /**
   * Kunderegisteret eier kunden; customer_name/-phone/address på ordren er et
   * snapshot fra da ordren ble laget. Rettes kunden i ettertid, skal en gammel
   * ordre fortsatt vise adressen jobben faktisk ble utført på.
   */
  @text('customer_id') customerId: string | null
  /** Tilbudet ordren ble akseptert fra, når den kom den veien. */
  @text('quote_id') quoteId: string | null
  @text('source_system') sourceSystem: string | null
  @text('external_id') externalId: string | null
  @text('invoice_external_id') invoiceExternalId: string | null
  @date('invoiced_at') invoicedAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
