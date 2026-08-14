import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

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
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
