import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

/** Node på en sløyfe: en utsatt enhet i normaliserte side-koord (0..1). `sym` = symbol-id. */
export type LoopNode = {
  x: number; y: number; sym?: string; label?: string
  /** Noden sitter PÅ en brannkomponent — sløyfa kjeder detektor til detektor,
   *  og rekkefølgen her er den adresserte rekkefølgen på sløyfa. */
  deviceId?: string
}

/** Sløyfe (detektorsløyfe/kurs): rute av tilkoblede noder på en tegning. As-built, delt. */
export class DrawingLoop extends Model {
  static table = 'drawing_loops'

  @text('drawing_id') drawingId: string
  @text('name') name: string
  @field('number') number: number
  @text('color') color: string
  @text('nodes') nodes: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  get nodeList(): LoopNode[] {
    if (!this.nodes) return []
    try { return JSON.parse(this.nodes) as LoopNode[] } catch { return [] }
  }
}
