import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

/** Person på et prosjekt. user_name er snapshot så navn vises offline. */
export class ProjectMember extends Model {
  static table = 'project_members'

  @text('project_id') projectId: string
  @text('user_id') userId: string
  @text('user_name') userName: string
  @text('role') role: string
  @field('is_scan_responsible') isScanResponsible: boolean | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
