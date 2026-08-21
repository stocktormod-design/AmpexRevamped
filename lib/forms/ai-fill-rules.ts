/**
 * Hva AI-en får skrive i et skjema — ÉN regel, delt av begge veiene inn.
 *
 * Det finnes to: gap-check (lib/forms/gap-check.ts, ett opptak → felter) og
 * Live-assistenten (lib/forms/voice-fill.ts, felt fylles underveis i samtalen).
 * De hadde hver sin regel, og de var ikke like — gap-check slapp gjennom det
 * voice-fill avviste. Da avhenger innholdet i et dokument av hvilken knapp som
 * ble trykt, og det er ikke en forskjell noen kan se i ettertid.
 *
 * Ren fil, ingen database og ingen React Native — selvtestet i verify:forms.
 */

/**
 * 'table' er den viktige. En tabell lagres som RADER. Skriver AI-en en
 * tekststreng dit, faller rendereren tilbake til en tom liste
 * (components/form-field-view.tsx), og skjemaet ser komplett ut mens svaret
 * ikke finnes noe sted. Montøren signerer på et hull.
 *
 * 'info' er ikke et spørsmål og lagres aldri.
 *
 * Begge fylles av mennesket i appen. Det er ikke en begrensning i modellen,
 * det er en begrensning i hva tale er egnet til.
 */
const IKKE_AI: ReadonlySet<string> = new Set(['table', 'info'])

export function aiKanFylle(type: string): boolean {
  return !IKKE_AI.has(type)
}

/** Setningen modellen får tilbake. Den skal kunne spørre om noe annet i stedet. */
export function avvisningsgrunn(type: string): string | null {
  if (type === 'table') return 'Tabellfelt fylles i appen, ikke via tale.'
  if (type === 'info') return 'Dette er informasjonstekst, ikke et spørsmål.'
  return null
}
