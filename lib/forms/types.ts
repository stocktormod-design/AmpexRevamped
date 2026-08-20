// Skjemamotor — én JSON-definisjon per mal, én renderer for alle.
// Ampex-maler bundles i appen; firmaets egne maler ligger i form_templates +
// form_template_revisions og konverteres hit av lib/forms/resolve.ts.
// En mal endres ALDRI in-place — bump version.

export type FormFieldType =
  | 'text'      // énlinjes tekst
  | 'multiline' // fritekst
  | 'number'    // tall, evt. med enhet
  | 'choice'    // chips, ett valg
  | 'info'      // statisk tekst (erklæringer, veiledning) — lagres ikke
  | 'table'     // repeterende rader med kolonner (f.eks. kursfortegnelse)

/** Prefill-kilder — hentes fra ordren ved første åpning, kan alltid overstyres */
export type FormPrefill = 'customerName' | 'address' | 'orderTitle' | 'orderDescription' | 'today'

/**
 * Vis feltet kun når `field` (en annen felt-key i SAMME mal) har en av
 * verdiene i `equals`. Skjulte felt rendres ikke, teller ikke som manglende
 * påkrevd, og tilbys ikke til AI-en — se lib/forms/visibility.ts.
 */
export type FormCondition = { field: string; equals: string[] }

export type FormField = {
  key: string
  label: string
  type: FormFieldType
  choices?: string[]                             // for choice
  columns?: { key: string; label: string }[]     // for table
  prefill?: FormPrefill
  placeholder?: string
  /** Veiledning under etiketten */
  help?: string
  /** Enhet som vises etter tallet (A, V, Ω, mm²) */
  unit?: string
  showIf?: FormCondition
  /** Om AI-utfylling (gap-check) skal spørre etter dette feltet hvis det står tomt.
   *  Dette er en compliance-avgjørelse (hvilke felt forskriften faktisk krever),
   *  ikke en teknisk en — sett av faglig ansvarlig, ikke gjettet av utviklere. */
  required?: boolean
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

/** Verdi per felt: string (text/multiline/number/choice) eller rader (table) */
export type FormValues = Record<string, string | Record<string, string>[]>

export const JA_NEI_IA = ['Ja', 'Nei', 'Ikke aktuelt']
