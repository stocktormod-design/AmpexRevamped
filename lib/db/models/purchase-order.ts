import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Bestilling til grossist. En bestilling i `utkast` ER handlelista: montøren
 * legger på det som mangler, og lista blir en bestilling i det den sendes.
 */
export type BestillingStatus = 'utkast' | 'sendt' | 'mottatt' | 'avbrutt'
export const bestillingStatusLabel: Record<BestillingStatus, string> = {
  utkast: 'Handleliste',
  sendt: 'Sendt',
  mottatt: 'Mottatt',
  avbrutt: 'Avbrutt',
}

export class PurchaseOrder extends Model {
  static table = 'purchase_orders'

  @text('grossist') grossist: string
  @text('grossist_epost') grossistEpost: string | null
  @text('kundenummer') kundenummer: string | null
  @text('status') status: BestillingStatus
  @text('order_id') orderId: string | null
  @text('location_id') locationId: string | null
  @text('referanse') referanse: string | null
  @text('merknad') merknad: string | null
  @date('sendt_at') sendtAt: Date | null
  @text('sendt_av') sendtAv: string | null
  @text('ekstern_ordrenr') eksternOrdrenr: string | null
  @date('mottatt_at') mottattAt: Date | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

export class PurchaseOrderLine extends Model {
  static table = 'purchase_order_lines'

  @text('purchase_order_id') purchaseOrderId: string
  @text('product_id') productId: string | null
  @text('elnummer') elnummer: string | null
  @text('beskrivelse') beskrivelse: string
  @field('antall') antall: number
  @text('enhet') enhet: string
  @field('mottatt_antall') mottattAntall: number
  @field('sort_order') sortOrder: number
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  /** Delvis mottak er normalen — dette er det som fortsatt venter. */
  get gjenstar(): number {
    return Math.max(0, this.antall - this.mottattAntall)
  }
}
