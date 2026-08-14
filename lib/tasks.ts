import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import { syncQuietly } from './db/sync'
import { Task } from './db/models/task'
import { ProjectMember } from './db/models/project-member'
import { Room } from './db/models/room'

/**
 * PL etterspør LiDAR-skann av et rom → lager en oppgave tilordnet prosjektets
 * LiDAR-ansvarlig (er ingen satt, blir oppgaven uten mottaker og synlig i lista).
 */
export async function requestLidarScan(room: Room): Promise<void> {
  const responsible = await database.get<ProjectMember>('project_members')
    .query(Q.where('project_id', room.projectId), Q.where('is_scan_responsible', true))
    .fetch()
  const assignee = responsible[0]?.userId ?? null
  await database.write(async () => {
    await database.get<Task>('tasks').create(tk => {
      tk.projectId = room.projectId
      tk.roomId = room.id
      tk.kind = 'lidar_scan'
      tk.title = `LiDAR-skann: ${room.name}`
      tk.status = 'open'
      tk.assignedTo = assignee
    })
  })
  syncQuietly()
}

/** Marker oppgave ferdig/åpen igjen. */
export async function toggleTaskDone(task: Task): Promise<void> {
  await database.write(async () => {
    await task.update(t => {
      const wasDone = t.status === 'done'
      t.status = wasDone ? 'open' : 'done'
      t.doneAt = wasDone ? null : new Date()
    })
  })
  syncQuietly()
}
