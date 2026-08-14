import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * 3D-punkt på en teksturert GLB — knyttet til en KONKRET skann-revisjon (`scanPath`),
 * ikke bare rommet/ordren. Skannes rommet på nytt, følger punktene forrige GLB-versjon
 * og slutter å vises (ingen auto-transform til ny geometri).
 */
export class MeshMarker extends Model {
  static table = 'mesh_markers'

  @text('room_id') roomId: string | null
  @text('order_scan_id') orderScanId: string | null
  @text('scan_path') scanPath: string
  @field('x') x: number
  @field('y') y: number
  @field('z') z: number
  @text('symbol_id') symbolId: string
  @text('note') note: string | null
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
