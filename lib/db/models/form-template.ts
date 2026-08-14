import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

export type FormFieldType = 'check' | 'text' | 'number' | 'photo'
export type FormField = { id: string; type: FormFieldType; label: string; required?: boolean }
export type FormSchema = { items: FormField[] }

/** Firmaets skjema. Innhold ligger i revisjoner (versjonert); dette er «hodet». */
export class FormTemplate extends Model {
  static table = 'form_templates'

  @text('key') key: string | null
  @text('title') title: string
  @text('category') category: string
  @field('current_version') currentVersion: number
  @text('status') status: string
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
