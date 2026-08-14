import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

export type ScanKind = 'planlegging' | 'dokumentasjon'
export const scanKindLabel: Record<ScanKind, string> = {
  planlegging: 'Planlegging',
  dokumentasjon: 'Dokumentasjon',
}

/** LiDAR-skann på en ordre. `kind` holder planleggings- og dokumentasjons-skann adskilt. */
export class OrderScan extends Model {
  static table = 'order_scans'

  @text('order_id') orderId: string
  @text('kind') kind: ScanKind
  @text('title') title: string
  @text('scan_path') scanPath: string | null
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
