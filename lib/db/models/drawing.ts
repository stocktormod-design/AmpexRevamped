import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type Discipline = 'elkraft' | 'svakstrom' | 'automasjon' | 'annet'

export const disciplines: Discipline[] = ['elkraft', 'svakstrom', 'automasjon', 'annet']

export const disciplineLabel: Record<Discipline, string> = {
  elkraft: 'Elkraft',
  svakstrom: 'Svakstrøm',
  automasjon: 'Automasjon',
  annet: 'Annet',
}

/** Tegning — metadata; PDF-filen bor i R2 (file_path), gruppert på plan + fagfelt. */
export class Drawing extends Model {
  static table = 'drawings'

  @text('project_id') projectId: string
  @text('plan') plan: string
  @text('discipline') discipline: Discipline
  @text('name') name: string
  @text('file_path') filePath: string | null
  @field('page_count') pageCount: number | null
  @text('source') source: string | null // null/'lokal' | 'ekstern' (skrivebeskyttet grunnlag)
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}
