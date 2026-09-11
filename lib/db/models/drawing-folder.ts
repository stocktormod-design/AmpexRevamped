import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Mappe for tegninger — bygg → fag → tegninger, nestet via parentId.
 * En tegning uten folderId ligger på prosjektets rot.
 */
export class DrawingFolder extends Model {
  static table = 'drawing_folders'

  @text('project_id') projectId: string
  @text('parent_id') parentId: string | null
  @text('name') name: string
  @field('sort_order') sortOrder: number
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
