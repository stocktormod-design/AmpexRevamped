import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

// Skjemaformatet bor i lib/forms/schema.ts — det er data, ikke en
// databasemodell, og må kunne leses uten å dra inn WatermelonDB.
// Re-eksporteres her fordi resten av appen alltid har importert det herfra.
export * from '../../forms/schema'

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
