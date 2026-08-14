import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

export type NfcTargetType = 'material' | 'location'

/** Kobler en NFC-tag-uid til et mål (vare eller lokasjon). Simulert i dev (lib/nfc.ts)
 * inntil ekte expo-nfc kobles på — samme handler, kun kilden til `uid` endres. */
export class NfcTag extends Model {
  static table = 'nfc_tags'

  @text('tag_uid') tagUid: string
  @text('target_type') targetType: NfcTargetType
  @text('target_id') targetId: string
  @field('default_qty') defaultQty: number | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
