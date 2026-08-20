import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type Beslutning = 'godkjent' | 'avvist'

/**
 * Faglig godkjenning av en ordre.
 *
 * Faglig ansvarlig er en forskriftsfestet rolle i et registrert elektroforetak.
 * Denne raden er der beslutningen bor — ikke en status på ordren, fordi en
 * status ikke husker HVEM som bestemte og HVORFOR.
 *
 * Snapshotet er det som gjør godkjenningen etterprøvbar: godkjennes en ordre på
 * 12 400 kr og noen fører to timer til etterpå, gjelder den ikke lenger. Med
 * snapshotet kan skjermen si «godkjent 20. august — endret siden». Uten det ser
 * alt riktig ut.
 */
export class OrderApproval extends Model {
  static table = 'order_approvals'

  @text('order_id') orderId: string
  @text('beslutning') beslutning: Beslutning
  @text('godkjenner_id') godkjennerId: string | null
  /** Snapshot. Slutter faglig ansvarlig, skal navnet fortsatt stå her. */
  @text('godkjenner_navn') godkjennerNavn: string
  /** Påkrevd ved avslag — databasen håndhever det. */
  @text('begrunnelse') begrunnelse: string | null
  @field('sum_ore') sumOre: number | null
  @field('timer') timer: number | null
  @field('antall_materiell') antallMateriell: number | null
  @field('antall_dokumenter') antallDokumenter: number | null
  @field('antall_signaturer') antallSignaturer: number | null
  @date('besluttet_at') besluttetAt: Date
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
