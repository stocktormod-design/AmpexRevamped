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
 * Påkrevde felt som ikke er besvart — bare de som faktisk vises nå.
 *
 * Et skjult påkrevd punkt er ikke «manglende»: spørsmålet er ikke stilt.
 * Regelen er den samme i framdriften, i AI-ens gap-sjekk og i porten som
 * avgjør om dokumentet kan fullføres. Ligger her (og ikke i gap-check) fordi
 * den er ren logikk uten database — den skal kunne selvtestes alene.
 */
export function findUnfilledRequired(template: FormTemplate, values: FormValues): FormField[] {
  const out: FormField[] = []
  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.type === 'info' || !field.required) continue
      if (!isFieldVisible(field, values)) continue
      const v = values[field.key]
      const isEmpty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
      if (isEmpty) out.push(field)
    }
  }
  return out
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

/**
 * Temavalget i en `velger`-seksjon: hvilke temaer ordren nevner, som forhåndsavkryssing.
 * Bare et forslag — montøren krysser av og fra før skjemaet lages.
 */
export function foreslatteTemaer(template: FormTemplate, ordretekst: string): string[] {
  const tekst = ordretekst.toLowerCase()
  return template.sections.flatMap(s => s.velger
    ? s.fields.filter(f => s.velger!.match[f.key]?.test(tekst)).map(f => f.key)
    : [])
}

/** Verdiene temavalget skriver: «Ja» på det som er valgt, «Nei» på resten — så valget står i dokumentet. */
export function temaVerdier(template: FormTemplate, valgt: string[]): FormValues {
  const ut: FormValues = {}
  for (const s of template.sections) if (s.velger) for (const f of s.fields) ut[f.key] = valgt.includes(f.key) ? 'Ja' : 'Nei'
  return ut
}
