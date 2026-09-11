import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'
import { disciplines, type Discipline } from './drawing'

export type RoomProgress = Partial<Record<Discipline, number>>
/** Firkant på tegningen i normaliserte side-koordinater (0..1). */
export type RoomRect = { x: number; y: number; w: number; h: number }
/** Polygon på tegningen i normaliserte side-koordinater (0..1). */
export type RoomPoly = { points: [number, number][] }
/**
 * Rommets form. Eldre rom er firkanter; romdelingen gir polygoner. Begge
 * leses av `shapePoints`, så resten av appen slipper å vite forskjellen.
 */
export type RoomShape = RoomRect | RoomPoly

export function erPolygon(s: RoomShape): s is RoomPoly {
  return Array.isArray((s as RoomPoly).points)
}

/** Formen som punkter, uansett om den er lagret som firkant eller polygon. */
export function tilPunkter(s: RoomShape): [number, number][] {
  if (erPolygon(s)) return s.points
  return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]]
}

/** Omsluttende firkant — til etiketter, treffområde og listevisning. */
export function omsluttende(pts: [number, number][]): RoomRect {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

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

  get shapeRect(): RoomRect | null {
    const pts = this.shapePoints
    return pts ? omsluttende(pts) : null
  }

  /** Formens hjørner (normalisert). Null når rommet ikke er tegnet inn ennå. */
  get shapePoints(): [number, number][] | null {
    if (!this.shape) return null
    try {
      const s = JSON.parse(this.shape) as RoomShape
      const pts = tilPunkter(s)
      return pts.length >= 3 ? pts : null
    } catch { return null }
  }
}

/** Snitt-framdrift over fagfeltene (0-100) — for oppsummering per rom/prosjekt. */
export function overallProgress(p: RoomProgress): number {
  const vals = disciplines.map(d => p[d] ?? 0)
  return Math.round(vals.reduce((a, b) => a + b, 0) / disciplines.length)
}
