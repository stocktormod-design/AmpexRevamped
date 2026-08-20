/**
 * Lagringsformatet for firmaets egne skjemaer — v2.
 *
 * Bevisst FRI for WatermelonDB: formatet er data, ikke en databasemodell. Det
 * gjør fila importerbar fra selvtesten (tools/verify-forms.ts) og fra en
 * fremtidig importør, som begge må kunne lese og validere en mal uten å dra
 * inn en database.
 *
 * v1 hadde fire typer i en flat liste (check/text/number/photo). Det var for
 * tynt til å ta imot et ekte skjema fra SpeedyCraft, Cordel eller firmaets eget
 * Word-dokument: klikklister med egne alternativer, kursfortegnelser og
 * seksjoner fantes ikke. Vokabularet er nå det SAMME som Ampex-malene i
 * lib/forms/types.ts allerede kunne rendre, pluss det import trenger
 * (hjelpetekst, enhet, betinget visning).
 *
 * 'check' beholdes som egen type, ikke som choice med tre faste valg: den
 * betyr «ja/nei/ikke aktuelt» semantisk, og gamle revisjoner ligger lagret med
 * den.
 */
export type FormFieldType =
  | 'check'     // avkryssing — Ja/Nei/Ikke aktuelt
  | 'text'      // énlinjes tekst
  | 'multiline' // fritekst
  | 'number'    // tall, evt. med enhet
  | 'choice'    // klikkliste med firmaets egne alternativer
  | 'table'     // repeterende rader (kursfortegnelse, måleprotokoll)
  | 'info'      // statisk tekst — lagres aldri
  | 'photo'     // bilde (fylles i appen)

export type FormFieldColumn = { key: string; label: string }

/** Vis feltet kun når et annet felt har en av disse verdiene. */
export type FormFieldCondition = { field: string; equals: string[] }

export type FormField = {
  id: string
  type: FormFieldType
  label: string
  required?: boolean
  /** Veiledning under etiketten — der importerte skjema har «se pkt. 6.3» */
  help?: string
  /** choice: alternativene. Tom liste = feltet er ubrukelig, se validateFirmSections */
  choices?: string[]
  /** table: kolonnene */
  columns?: FormFieldColumn[]
  /** number: A, V, Ω, mm², °C … */
  unit?: string
  showIf?: FormFieldCondition
}

export type FormSection = { id: string; title: string; fields: FormField[] }

/**
 * Lagret form. `sections` er v2. `items` er v1 og finnes fortsatt i gamle
 * revisjonsrader — de skrives ALDRI om in-place (en revisjon er uforanderlig),
 * så leseveien må håndtere begge for alltid.
 */
export type FormSchema = { items?: FormField[]; sections?: FormSection[] }

export const V1_SECTION_ID = 'seksjon'

/** v1 flat liste ELLER v2 seksjoner → alltid seksjoner. Én lesevei for begge. */
export function toSections(schema: FormSchema | null | undefined): FormSection[] {
  if (!schema) return []
  if (Array.isArray(schema.sections) && schema.sections.length > 0) {
    return schema.sections.map(s => ({
      id: s.id || V1_SECTION_ID,
      title: s.title ?? '',
      fields: Array.isArray(s.fields) ? s.fields : [],
    }))
  }
  const items = Array.isArray(schema.items) ? schema.items : []
  if (items.length === 0) return []
  return [{ id: V1_SECTION_ID, title: '', fields: items }]
}

export function parseSchema(json: string | null | undefined): FormSection[] {
  if (!json) return []
  try {
    return toSections(JSON.parse(json) as FormSchema)
  } catch {
    return []
  }
}
