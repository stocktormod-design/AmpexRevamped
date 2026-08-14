import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'
import { disciplines, type Discipline } from './drawing'

export type RoomProgress = Partial<Record<Discipline, number>>
/** Firkant på tegningen i normaliserte side-koordinater (0..1). */
export type RoomShape = { x: number; y: number; w: number; h: number }

/** Rom i et prosjekt: en firkant tegnet over rommet på en tegning. Framdrift per fagfelt + valgfri LiDAR-skann. */
export class Room extends Model {
  static table = 'rooms'

  @text('project_id') projectId: string
  @text('plan') plan: string
  @text('name') name: string
  @text('progress') progress: string | null
  @text('scan_path') scanPath: string | null
  @text('shape') shape: string | null
  @text('drawing_id') drawingId: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  get progressMap(): RoomProgress {
    if (!this.progress) return {}
    try { return JSON.parse(this.progress) as RoomProgress } catch { return {} }
  }

  get shapeRect(): RoomShape | null {
    if (!this.shape) return null
    try { return JSON.parse(this.shape) as RoomShape } catch { return null }
  }
}

/** Snitt-framdrift over fagfeltene (0-100) — for oppsummering per rom/prosjekt. */
export function overallProgress(p: RoomProgress): number {
  const vals = disciplines.map(d => p[d] ?? 0)
  return Math.round(vals.reduce((a, b) => a + b, 0) / disciplines.length)
}
