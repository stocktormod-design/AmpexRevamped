import type { FormField, FormSection, FormTemplate, FormValues } from './types'

/**
 * Betinget visning. Ett nivå, ingen kjede: `showIf` peker på et annet felt i
 * samme mal og lister verdiene som slår feltet på.
 *
 * Med vilje uten rekursjon (A synlig hvis B, B synlig hvis C): et skjema som
 * kan gjemme et påkrevd felt bak to nivåer er et skjema ingen kan revidere
 * trygt, og importerte skjema trenger det ikke — de er flate lister med
 * «hvis avvik, beskriv».
 */
export function isFieldVisible(field: FormField, values: FormValues): boolean {
  if (!field.showIf) return true
  const v = values[field.showIf.field]
  return typeof v === 'string' && field.showIf.equals.includes(v)
}

/** Seksjonene med bare de synlige feltene. Tomme seksjoner faller bort. */
export function visibleSections(template: FormTemplate, values: FormValues): FormSection[] {
  return template.sections
    .map(s => ({ ...s, fields: s.fields.filter(f => isFieldVisible(f, values)) }))
    .filter(s => s.fields.length > 0)
}

/** Alle synlige felt flatet ut. */
export function visibleFields(template: FormTemplate, values: FormValues): FormField[] {
  return template.sections.flatMap(s => s.fields).filter(f => isFieldVisible(f, values))
}

/**
 * Verdier for lagring: felt som er skjult NÅ tas ut.
 *
 * Uten dette blir «Avvik: Nei» sittende igjen med en avviksbeskrivelse fra da
 * svaret var Ja, og den beskrivelsen havner i dokumentasjonen uten å vises
 * noe sted i appen. Verdien skal forsvinne i det feltet forsvinner.
 */
export function pruneHidden(template: FormTemplate, values: FormValues): FormValues {
  const visible = new Set(visibleFields(template, values).map(f => f.key))
  const conditional = new Set(
    template.sections.flatMap(s => s.fields).filter(f => f.showIf).map(f => f.key),
  )
  const out: FormValues = {}
  for (const [key, value] of Object.entries(values)) {
    if (conditional.has(key) && !visible.has(key)) continue
    out[key] = value
  }
  return out
}
