import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { FormTemplate as FirmTemplate } from '../db/models/form-template'
import { FormRevision } from '../db/models/form-revision'
import { getTemplate as getBundledTemplate, AMPEX_TEMPLATES } from './templates'
import type { FormTemplate } from './types'
import { convertFirmSections } from './firm-schema'

/**
 * Én oppslagsvei for BEGGE skjemakilder: Ampex-malene som bundles i appen
 * ('ampex.*', lib/forms/templates.ts) og firmaets egne maler (form_templates +
 * revisjoner, laget i skjema-editoren). Firmamalene konverteres til samme
 * seksjonsbaserte form som rendereren og voice-fill allerede forstår — AI-en
 * «lærer» dermed firmaets skjemaer automatisk i det de publiseres, uten egen
 * kodevei per firma.
 */

async function resolveFirmTemplate(id: string): Promise<FormTemplate | undefined> {
  const row = await database.get<FirmTemplate>('form_templates').find(id).catch(() => null)
  if (!row) return undefined
  const [revision] = await database
    .get<FormRevision>('form_template_revisions')
    .query(Q.where('template_id', row.id), Q.where('version', row.currentVersion))
    .fetch()
  if (!revision) return undefined
  const sections = revision.sections
  if (sections.length === 0) return undefined
  return {
    id: row.id,
    version: row.currentVersion,
    name: row.title,
    source: `Firmaskjema · ${row.category}`,
    sections: convertFirmSections(sections, row.title),
  }
}

/** Bundlet Ampex-mal ('ampex.*') eller firmamal (rad-id) — samme returform. */
export async function resolveTemplate(id: string): Promise<FormTemplate | undefined> {
  return getBundledTemplate(id) ?? (await resolveFirmTemplate(id))
}

/**
 * Malen slik den så ut i en BESTEMT versjon.
 *
 * Arkivet må sitere ordlyden dokumentet faktisk ble fylt mot. Bruker vi
 * gjeldende versjon, vil et skjema som ble revidert etterpå få frosne svar
 * merket med nye spørsmål — og da lyver arkivet, stille og troverdig.
 *
 * Finner vi ikke akkurat den versjonen (bundlet mal som er oppdatert i en ny
 * app-utgivelse, eller en revisjon som aldri rakk å synke hit), returneres det
 * vi HAR sammen med versjonen det er — kalleren skal si fra, ikke skjule det.
 */
export async function resolveTemplateAt(
  id: string,
  version: number,
): Promise<{ template: FormTemplate; version: number } | undefined> {
  const bundled = getBundledTemplate(id)
  if (bundled) return { template: bundled, version: bundled.version }

  const row = await database.get<FirmTemplate>('form_templates').find(id).catch(() => null)
  if (!row) return undefined
  const [revision] = await database
    .get<FormRevision>('form_template_revisions')
    .query(Q.where('template_id', row.id), Q.where('version', version))
    .fetch()
  if (revision) {
    const sections = revision.sections
    if (sections.length > 0) {
      return {
        template: {
          id: row.id,
          version,
          name: row.title,
          source: `Firmaskjema · ${row.category}`,
          sections: convertFirmSections(sections, row.title),
        },
        version,
      }
    }
  }
  const naa = await resolveFirmTemplate(id)
  return naa ? { template: naa, version: naa.version } : undefined
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
