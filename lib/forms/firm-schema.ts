import { JA_NEI_IA, type FormField, type FormSection, type FormTemplate } from './types'
import type { FormField as FirmField, FormSection as FirmSection } from './schema'

/**
 * Firmaskjema → rendermodell. REN funksjon, ingen database — derfor
 * selvtestbar (tools/verify-forms.ts), og derfor gjenbrukbar av en importør
 * som skal validere en konvertert mal før den lagres.
 *
 * Etter formatutvidelsen er dette nesten identitet. To oversettelser står
 * igjen: 'check' er et avkryssingspunkt → choice med Ja/Nei/Ikke aktuelt
 * (samme konvensjon som Ampex-malene, og formen gamle v1-revisjoner ligger i),
 * og 'photo' kan verken fylles via tale eller dagens renderer — vises som
 * info-punkt så mennesket ser at bildet gjenstår i appen.
 */
export function convertFirmField(f: FirmField): FormField {
  const base = {
    key: f.id,
    label: f.label,
    required: f.required,
    help: f.help,
    showIf: f.showIf,
  }
  switch (f.type) {
    case 'check':
      return { ...base, type: 'choice', choices: JA_NEI_IA }
    case 'choice':
      return { ...base, type: 'choice', choices: f.choices ?? [] }
    case 'number':
      return { ...base, type: 'number', unit: f.unit, placeholder: f.unit ? `Tall (${f.unit})` : 'Tall' }
    case 'table':
      return { ...base, type: 'table', columns: f.columns ?? [] }
    case 'text':
      return { ...base, type: 'text' }
    case 'info':
      return { key: f.id, label: f.label, type: 'info', showIf: f.showIf }
    case 'photo':
      return { key: f.id, label: `📷 ${f.label} — bilde legges til i appen`, type: 'info', showIf: f.showIf }
    default:
      return { ...base, type: 'multiline' }
  }
}

export function convertFirmSections(sections: FirmSection[], fallbackTitle: string): FormSection[] {
  return sections.map((s, i) => ({
    title: s.title?.trim() || (i === 0 && sections.length === 1 ? fallbackTitle : `Del ${i + 1}`),
    fields: s.fields.map(convertFirmField),
  }))
}

export function firmTemplate(input: {
  id: string; version: number; title: string; category: string; sections: FirmSection[]
}): FormTemplate {
  return {
    id: input.id,
    version: input.version,
    name: input.title,
    source: `Firmaskjema · ${input.category}`,
    sections: convertFirmSections(input.sections, input.title),
  }
}

/**
 * Problemer som gjør en mal ubrukelig i felt. Returnerer menneskelesbare
 * setninger, ikke koder — de skal kunne vises rått til den som redigerer, og
 * til den som importerer et fremmed skjema.
 */
export function validateFirmSections(sections: FirmSection[]): string[] {
  const problems: string[] = []
  const seenIds = new Set<string>()
  const optionsById = new Map<string, string[]>()
  const order: string[] = []

  for (const s of sections) {
    for (const f of s.fields) {
      order.push(f.id)
      if (seenIds.has(f.id)) problems.push(`To punkt har samme id «${f.id}» — svarene ville overskrevet hverandre.`)
      seenIds.add(f.id)
      if (f.type === 'check') optionsById.set(f.id, JA_NEI_IA)
      if (f.type === 'choice') optionsById.set(f.id, (f.choices ?? []).filter(c => c.trim()))
    }
  }

  for (const s of sections) {
    for (const f of s.fields) {
      const navn = f.label.trim() || `«${f.id}»`
      if (!f.label.trim()) problems.push(`Et punkt mangler tekst (${f.id}).`)
      if (f.type === 'choice' && (f.choices ?? []).filter(c => c.trim()).length < 1) {
        problems.push(`Klikklista «${navn}» har ingen alternativer.`)
      }
      if (f.type === 'table' && (f.columns ?? []).filter(c => c.label.trim()).length < 1) {
        problems.push(`Tabellen «${navn}» har ingen kolonner.`)
      }
      if (f.showIf) {
        const opts = optionsById.get(f.showIf.field)
        if (!opts) {
          problems.push(`«${navn}» er betinget av et punkt som ikke finnes, eller som ikke har svaralternativer.`)
        } else {
          if (order.indexOf(f.showIf.field) > order.indexOf(f.id)) {
            problems.push(`«${navn}» er betinget av et punkt lenger NED i skjemaet. Betingelser må peke oppover.`)
          }
          const ukjent = f.showIf.equals.filter(v => !opts.includes(v))
          if (ukjent.length > 0) problems.push(`«${navn}» venter på svaret ${ukjent.join('/')}, som ikke finnes i punktet den peker på.`)
          if (f.showIf.equals.length === 0) problems.push(`«${navn}» har en betingelse uten svar — punktet ville aldri vist seg.`)
        }
      }
    }
  }
  return problems
}
