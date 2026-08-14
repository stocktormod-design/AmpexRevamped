import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

/** Én strek: punkter i normaliserte side-koordinater (0-1), farge og pennbredde. */
export type Stroke = {
  points: [number, number][] // [x, y] i 0..1 av sidens bredde/høyde
  color: string
  width: number // px ved base-visning (fit)
}

/** Markup (frihånds-streker) for én tegning. Én rad per tegning, data = JSON av streker. */
export class DrawingMarkup extends Model {
  static table = 'drawing_markup'

  @text('drawing_id') drawingId: string
  @text('data') data: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  get strokes(): Stroke[] {
    if (!this.data) return []
    try { return JSON.parse(this.data) as Stroke[] } catch { return [] }
  }
}
