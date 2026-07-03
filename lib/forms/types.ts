// Skjemamotor — én JSON-definisjon per mal, én renderer for alle.
// Ampex-maler bundles i appen; firmadefinerte maler kommer i egen tabell senere
// (samme format). En mal endres ALDRI in-place — bump version.

export type FormFieldType =
  | 'text'      // énlinjes tekst
  | 'multiline' // fritekst
  | 'choice'    // chips, ett valg
  | 'info'      // statisk tekst (erklæringer, veiledning) — lagres ikke
  | 'table'     // repeterende rader med kolonner (f.eks. kursfortegnelse)

/** Prefill-kilder — hentes fra ordren ved første åpning, kan alltid overstyres */
export type FormPrefill = 'customerName' | 'address' | 'orderTitle' | 'orderDescription' | 'today'

export type FormField = {
  key: string
  label: string
  type: FormFieldType
  choices?: string[]                             // for choice
  columns?: { key: string; label: string }[]     // for table
  prefill?: FormPrefill
  placeholder?: string
}

export type FormSection = {
  title: string
  fields: FormField[]
}

export type FormTemplate = {
  id: string          // 'ampex.<slug>' for våre; '<companyId>.<slug>' for firmaets egne senere
  version: number
  name: string
  /** Forskrift/norm malen bygger på — vises i skjemaet */
  source: string
  /** Advarsel/etterord som vises øverst i skjemaet */
  reviewNote?: string
  sections: FormSection[]
}

/** Verdi per felt: string (text/multiline/choice) eller rader (table) */
export type FormValues = Record<string, string | Record<string, string>[]>

export const JA_NEI_IA = ['Ja', 'Nei', 'Ikke aktuelt']
