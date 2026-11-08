import type { FormFieldType } from './schema'

/**
 * Svartypene, med ÉN ordliste for hele produktet.
 *
 * Telefonen og kontoret tegner hver sin bygger (delt UI er forbudt — se
 * `desktop/README.md`), men de må ikke finne på hvert sitt språk. Alt som
 * brukeren leser og rekkefølgen det leses i, bor her; hver flate mapper
 * `icon` til sin egen ikonpakke.
 *
 * Rekkefølgen er «vanligst først», ikke alfabetisk: en elektriker som lager en
 * sjekkliste trenger Ja/Nei og tekst lenge før hen trenger en tabell.
 *
 * `description` er den ene setningen som står under typen når den er valgt.
 * `example` er det ekte spørsmålet vi viser som plassholder — ikke en
 * forklaring på hva et spørsmål er.
 */
export type AnswerType = {
  id: FormFieldType
  /** Kort navn på pillen. */
  label: string
  /** Én setning: hva svaret blir. */
  description: string
  /** Et ekte eksempel, brukt som plassholder. */
  example: string
  /** Ikonnøkkel — hver flate mapper den til lucide-react eller -native. */
  icon: 'check' | 'text' | 'multiline' | 'number' | 'choice' | 'table' | 'photo' | 'info'
}

export const ANSWER_TYPES: readonly AnswerType[] = [
  {
    id: 'check',
    label: 'Ja / Nei',
    description: 'Ja, nei eller ikke aktuelt',
    example: 'Er jordfeilbryteren testet?',
    icon: 'check',
  },
  {
    id: 'text',
    label: 'Tekst',
    description: 'Én linje',
    example: 'Hvem utførte kontrollen?',
    icon: 'text',
  },
  {
    id: 'multiline',
    label: 'Fritekst',
    description: 'Flere linjer',
    example: 'Beskriv avvik og tiltak',
    icon: 'multiline',
  },
  {
    id: 'number',
    label: 'Tall',
    description: 'Et tall, om du vil med enhet',
    example: 'Isolasjonsmotstand',
    icon: 'number',
  },
  {
    id: 'choice',
    label: 'Valg',
    description: 'Dine egne alternativer',
    example: 'Hvilket nettsystem?',
    icon: 'choice',
  },
  {
    id: 'table',
    label: 'Tabell',
    description: 'Rader og kolonner',
    example: 'Kursfortegnelse',
    icon: 'table',
  },
  {
    id: 'photo',
    label: 'Bilde',
    description: 'Bilde fra kamera',
    example: 'Bilde av tavla etter arbeidet',
    icon: 'photo',
  },
  {
    id: 'info',
    label: 'Info',
    description: 'Bare tekst, ikke et svar',
    example: 'Tekst montøren leser før neste punkt',
    icon: 'info',
  },
]

/** Typen med denne id-en, eller `undefined` for en ukjent/eldre verdi. */
export function answerType(id: FormFieldType): AnswerType | undefined {
  return ANSWER_TYPES.find(type => type.id === id)
}

/** Kort navn, alltid en streng — også for en type vi ikke kjenner. */
export function answerTypeLabel(id: FormFieldType): string {
  return answerType(id)?.label ?? 'Tekst'
}
