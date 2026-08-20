import { database } from './db'
import { syncQuietly } from './db/sync'
import { supabase } from './supabase'
import { FormTemplate, type FormSection } from './db/models/form-template'
import { FormRevision } from './db/models/form-revision'
import { FormComment } from './db/models/form-comment'

/** Visningsnavn for kommentar-signatur (metadata → e-post-prefiks som fallback). */
async function displayName(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const u = data.user
  const meta = (u?.user_metadata ?? {}) as Record<string, unknown>
  const name = (meta.full_name ?? meta.name) as string | undefined
  if (name) return name
  const email = u?.email ?? ''
  return email ? email.split('@')[0] : 'Ukjent'
}

/** Nytt skjema + første revisjon (v1). */
export async function createTemplate(input: { title: string; category: string; sections?: FormSection[] }): Promise<string> {
  let id = ''
  await database.write(async () => {
    const tpl = await database.get<FormTemplate>('form_templates').create(t => {
      t.title = input.title.trim()
      t.category = input.category.trim() || 'Diverse'
      t.currentVersion = 1
      t.status = 'published'
    })
    id = tpl.id
    await database.get<FormRevision>('form_template_revisions').create(r => {
      r.templateId = tpl.id
      r.version = 1
      r.schema = JSON.stringify({ sections: input.sections ?? [] })
      r.changeNote = 'Opprettet'
    })
  })
  syncQuietly()
  return id
}

/** Ny revisjon: bump versjon, snapshot av seksjonene + HVORFOR. */
export async function saveRevision(template: FormTemplate, sections: FormSection[], changeNote: string): Promise<void> {
  const next = template.currentVersion + 1
  await database.write(async () => {
    await database.get<FormRevision>('form_template_revisions').create(r => {
      r.templateId = template.id
      r.version = next
      r.schema = JSON.stringify({ sections })
      r.changeNote = changeNote.trim() || 'Endret'
    })
    await template.update(t => { t.currentVersion = next })
  })
  syncQuietly()
}

/** Ny kommentar i diskusjonen (evt. på et felt). */
export async function addComment(template: FormTemplate, body: string, opts?: { version?: number; fieldId?: string }): Promise<void> {
  const author = await displayName()
  await database.write(async () => {
    await database.get<FormComment>('form_comments').create(c => {
      c.templateId = template.id
      c.body = body.trim()
      c.version = opts?.version ?? template.currentVersion
      c.fieldId = opts?.fieldId ?? null
      c.authorName = author
      c.resolved = false
      c.resolvedRevision = null
    })
  })
  syncQuietly()
}

/** Marker tråd løst/åpen igjen (evt. lenk til revisjonen som fikset den). */
export async function toggleResolveComment(comment: FormComment, resolvingRevision?: number): Promise<void> {
  await database.write(async () => {
    await comment.update(c => {
      const now = !c.resolved
      c.resolved = now
      c.resolvedRevision = now ? (resolvingRevision ?? null) : null
    })
  })
  syncQuietly()
}
