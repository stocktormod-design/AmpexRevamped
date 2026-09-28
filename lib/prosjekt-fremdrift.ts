/**
 * Prosjektets ene tall — delt av montørappen og kontoret (@delt).
 *
 * Har prosjektet brannkomponenter, er fremdriften montert av registrert: det er
 * det planen viser, symbol for symbol. Ellers oppgaver ferdig av alle. Uten noen
 * av delene finnes det ikke noe ærlig tall, og da vises heller ikke ringen.
 */
export type FremdriftEnhet = { montert: boolean }
export type FremdriftOppgave = { apen: boolean; frist: Date | null }
export type Fremdrift = { andel: number; hoved: string; aapne: number; forfalt: number }

export function fremdrift(enheter: FremdriftEnhet[], oppgaver: FremdriftOppgave[], naa: Date): Fremdrift | null {
  const aapne = oppgaver.filter(o => o.apen)
  const forfalt = aapne.filter(o => o.frist && o.frist < naa).length
  if (enheter.length) {
    const montert = enheter.filter(e => e.montert).length
    return { andel: montert / enheter.length, hoved: `${montert} av ${enheter.length} montert`, aapne: aapne.length, forfalt }
  }
  if (oppgaver.length) {
    const ferdig = oppgaver.length - aapne.length
    return { andel: ferdig / oppgaver.length, hoved: `${ferdig} av ${oppgaver.length} oppgaver ferdig`, aapne: aapne.length, forfalt }
  }
  return null
}

export function aapneTekst(f: Fremdrift): string {
  if (f.aapne === 0) return 'Ingen åpne oppgaver'
  return `${f.aapne} ${f.aapne === 1 ? 'åpen oppgave' : 'åpne oppgaver'}${f.forfalt ? ` · ${f.forfalt} forfalt` : ''}`
}
