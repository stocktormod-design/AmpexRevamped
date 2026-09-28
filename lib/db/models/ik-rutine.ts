import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/** En rutine under et IK-punkt. Lesing kun, se `IkPunkt`. */
export class IkRutine extends Model {
  static table = 'ik_rutiner'

  @text('punkt_id') punktId: string
  @text('tittel') tittel: string
  @text('innhold') innhold: string | null
  @text('ansvarlig') ansvarlig: string | null
  @text('status') status: 'utkast' | 'vedtatt' | 'utgatt'
  @field('gjeldende_versjon') gjeldendeVersjon: number
  @field('sort_order') sortOrder: number
  @date('vedtatt_at') vedtattAt: Date | null
  @text('vedtatt_av') vedtattAv: string | null
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
