import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

/** Diskusjon på et skjema (evt. et enkelt felt). Løses av en revisjon. */
export class FormComment extends Model {
  static table = 'form_comments'

  @text('template_id') templateId: string
  @text('field_id') fieldId: string | null
  @field('version') version: number | null
  @text('body') body: string
  @text('author_name') authorName: string | null
  @field('resolved') resolved: boolean
  @field('resolved_revision') resolvedRevision: number | null
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
