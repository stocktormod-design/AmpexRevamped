import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { FormTemplate as FirmTemplate, type FormSchema } from '../db/models/form-template'
import { FormRevision } from '../db/models/form-revision'
import { getTemplate as getBundledTemplate, AMPEX_TEMPLATES } from './templates'
import type { FormField, FormTemplate } from './types'

/**
 * Én oppslagsvei for BEGGE skjemakilder: Ampex-malene som bundles i appen
 * ('ampex.*', lib/forms/templates.ts) og firmaets egne maler (form_templates +
 * revisjoner, laget i skjema-editoren). Firmamalene konverteres til samme
 * seksjonsbaserte form som rendereren og voice-fill allerede forstår — AI-en
 * «lærer» dermed firmaets skjemaer automatisk i det de publiseres, uten egen
 * kodevei per firma.
 */

// Firmafelt → renderer-/voice-fill-vokabular. 'check' er et avkrysningspunkt →
// choice Ja/Nei/Ikke aktuelt (samme konvensjon som Ampex-malene). 'photo' kan
// verken fylles via tale eller dagens renderer — vises som info-punkt så
// mennesket ser at bildet gjenstår i appen.
function convertField(f: { id: string; type: string; label: string; required?: boolean }): FormField {
  switch (f.type) {
    case 'check':
      return { key: f.id, label: f.label, type: 'choice', choices: ['Ja', 'Nei', 'Ikke aktuelt'], required: f.required }
    case 'number':
      return { key: f.id, label: f.label, type: 'text', placeholder: 'Tall', required: f.required }
    case 'photo':
      return { key: f.id, label: `📷 ${f.label} — bilde legges til i appen`, type: 'info' }
    default:
      return { key: f.id, label: f.label, type: 'multiline', required: f.required }
  }
}

async function resolveFirmTemplate(id: string): Promise<FormTemplate | undefined> {
  const row = await database.get<FirmTemplate>('form_templates').find(id).catch(() => null)
  if (!row) return undefined
  const [revision] = await database
    .get<FormRevision>('form_template_revisions')
    .query(Q.where('template_id', row.id), Q.where('version', row.currentVersion))
    .fetch()
  if (!revision?.schema) return undefined
  let schema: FormSchema
  try {
    schema = JSON.parse(revision.schema) as FormSchema
  } catch {
    return undefined
  }
  return {
    id: row.id,
    version: row.currentVersion,
    name: row.title,
    source: `Firmaskjema · ${row.category}`,
    sections: [{ title: row.title, fields: (schema.items ?? []).map(convertField) }],
  }
}

/** Bundlet Ampex-mal ('ampex.*') eller firmamal (rad-id) — samme returform. */
export async function resolveTemplate(id: string): Promise<FormTemplate | undefined> {
  return getBundledTemplate(id) ?? (await resolveFirmTemplate(id))
}

export type TemplateCatalogEntry = { id: string; name: string; source: string }

/** Alle maler AI-en kan tilby: bundlede + publiserte firmamaler. */
export async function listAllTemplates(): Promise<TemplateCatalogEntry[]> {
  const firm = await database.get<FirmTemplate>('form_templates').query(Q.where('status', 'published')).fetch()
  return [
    ...AMPEX_TEMPLATES.map(t => ({ id: t.id, name: t.name, source: t.source })),
    ...firm.map(t => ({ id: t.id, name: t.title, source: `Firmaskjema · ${t.category}` })),
  ]
}
