import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'
import type { FormSchema, FormField } from './form-template'

/** Uforanderlig revisjon av et skjema: snapshot av schema + HVORFOR det ble endret. */
export class FormRevision extends Model {
  static table = 'form_template_revisions'

  @text('template_id') templateId: string
  @field('version') version: number
  @text('schema') schema: string | null
  @text('change_note') changeNote: string | null
  @text('changed_by') changedBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  get items(): FormField[] {
    if (!this.schema) return []
    try { return (JSON.parse(this.schema) as FormSchema).items ?? [] } catch { return [] }
  }
}
