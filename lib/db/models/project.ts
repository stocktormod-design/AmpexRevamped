import { Model } from '@nozbe/watermelondb'
import { text, date, readonly } from '@nozbe/watermelondb/decorators'

export type ProjectStatus = 'aktiv' | 'ferdig' | 'arkivert'

export const projectStatusLabel: Record<ProjectStatus, string> = {
  aktiv: 'Aktiv',
  ferdig: 'Ferdig',
  arkivert: 'Arkivert',
}

export class Project extends Model {
  static table = 'projects'

  @text('name') name: string
  @text('customer_name') customerName: string | null
  @text('address') address: string | null
  @text('status') status: ProjectStatus
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
