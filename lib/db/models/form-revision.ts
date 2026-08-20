import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'
import { parseSchema, type FormField, type FormSection } from '../../forms/schema'

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

  /** Seksjoner — gamle v1-revisjoner løftes til én navnløs seksjon. */
  get sections(): FormSection[] {
    return parseSchema(this.schema)
  }

  /** Alle felt flatet ut, uansett seksjon. Brukes til telling og oppslag. */
  get items(): FormField[] {
    return this.sections.flatMap(s => s.fields)
  }
}
