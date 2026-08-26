import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

export type FireDeviceKind =
  | 'royk' | 'varme' | 'multi' | 'melder' | 'klokke' | 'sirene' | 'sentral' | 'annet'

export const fireDeviceKindLabel: Record<FireDeviceKind, string> = {
  royk: 'Røykdetektor',
  varme: 'Varmedetektor',
  multi: 'Multikriteriedetektor',
  melder: 'Manuell melder',
  klokke: 'Brannklokke',
  sirene: 'Sirene',
  sentral: 'Brannsentral',
  annet: 'Annet',
}

/**
 * Brannkomponent på en tegning — den ENESTE symboltypen som bærer registerdata
 * (tag `sløyfe.adresse` som 01.023, serienummer, modell). Andre symboler er rene
 * tegneelementer i drawing_loops. Detektorlista per prosjekt genereres herfra.
 */
export class FireDevice extends Model {
  static table = 'fire_devices'

  @text('project_id') projectId: string
  @text('drawing_id') drawingId: string | null
  @text('room_id') roomId: string | null
  @text('loop_id') loopId: string | null
  @field('x') x: number // normalisert 0..1 på tegningen
  @field('y') y: number
  @text('kind') kind: FireDeviceKind
  @text('tag') tag: string
  @text('serial') serial: string | null
  @text('model') model: string | null
  @date('placed_at') placedAt: Date | null
  @text('note') note: string | null
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
