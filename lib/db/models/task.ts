import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

export type TaskKind = 'general' | 'lidar_scan'
export type TaskStatus = 'open' | 'done'

/** Oppgave i et prosjekt (oppgaveliste + inbox). «Etterspør LiDAR» lager en med kind=lidar_scan. */
export class Task extends Model {
  static table = 'tasks'

  @text('project_id') projectId: string
  @text('room_id') roomId: string | null
  @text('kind') kind: TaskKind
  @text('title') title: string
  @text('status') status: TaskStatus
  @text('assigned_to') assignedTo: string | null
  @text('created_by') createdBy: string | null
  @date('done_at') doneAt: Date | null
  // Pin-feltene (serverkolonner som fantes før klienten — norske navn er serverens):
  // en oppgave kan festes på et punkt på en tegning; pinnen vises KUN for tildelt
  // bruker og forsvinner ved done (ikke permanent).
  @text('beskrivelse') beskrivelse: string | null
  @date('frist_at') fristAt: Date | null
  @text('drawing_id') drawingId: string | null
  @field('pin_x') pinX: number | null // normalisert 0..1
  @field('pin_y') pinY: number | null
  @text('synlighet') synlighet: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
