import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'
import { effektivStatus, type TilbudStatus } from '../../quoting'

export type BeslutningsMate = 'muntlig' | 'sms' | 'epost' | 'signert'

export const beslutningLabel: Record<BeslutningsMate, string> = {
  muntlig: 'Muntlig',
  sms: 'SMS',
  epost: 'E-post',
  signert: 'Signert',
}

/**
 * Tilbud — steget før ordren.
 *
 * Uten dette kan Ampex fakturere arbeid, men ikke vinne det: en ordre måtte
 * oppstå av ingenting. Tilbudet er også det eneste stedet dekningsbidraget kan
 * ses FØR prisen er lovet bort.
 *
 * Linjene ligger i quote_lines og er SNAPSHOT: et sendt tilbud er bindende, og
 * skal ikke endre beløp fordi en vare ble priset om i mellomtiden.
 */
export class Quote extends Model {
  static table = 'quotes'

  @field('quote_number') quoteNumber: number | null
  @text('title') title: string
  @text('description') description: string | null
  /** Snapshot fra da tilbudet ble laget — samme grunn som på Order. */
  @text('customer_id') customerId: string | null
  @text('customer_name') customerName: string | null
  @text('customer_phone') customerPhone: string | null
  @text('address') address: string | null
  @text('status') status: TilbudStatus
  @date('valid_until') validUntil: Date | null
  @date('sent_at') sentAt: Date | null
  @date('decided_at') decidedAt: Date | null
  /** Navnet på personen hos KUNDEN som svarte — ikke vår egen bruker. */
  @text('decided_by') decidedBy: string | null
  @text('decision_method') decisionMethod: BeslutningsMate | null
  /** Hvorfor. Det eneste som gjør tapte tilbud lærerike. */
  @text('decision_note') decisionNote: string | null
  @text('order_id') orderId: string | null
  @text('project_id') projectId: string | null
  @text('source_system') sourceSystem: string | null
  @text('external_id') externalId: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  /**
   * Statusen slik den skal VISES. «Utløpt» lagres aldri — det er en funksjon av
   * dato, og en rad som må skrives om ved midnatt trenger en jobb ingen har
   * skrevet.
   */
  get visStatus(): TilbudStatus {
    return effektivStatus(this.status, this.validUntil?.getTime() ?? null, Date.now())
  }
}
