import type { UtfoertVerktoy } from './mind'

/**
 * Bekreftelser satt sammen lokalt, i stedet for hentet fra modellen.
 *
 * Tre gevinster på én gang:
 *  1. Modellen slipper å formulere «La ti meter PN 3x2,5 på ordre 1042» — utdata
 *     er den dyreste posten ($1,50/1M mot $0,50 for lyd inn), og dette er den
 *     halvparten av turene der setningen er helt forutsigbar.
 *  2. Setningen blir BIT-IDENTISK hver gang, så talecachen treffer. En setning
 *     modellen formulerer fritt er en ny cache-nøkkel hver gang.
 *  3. Stemmen blir deterministisk. Kravet om at assistenten ikke skal reagere på
 *     tonefall løses her ved konstruksjon, ikke ved å be modellen la være.
 *
 * VIKTIG OM `beskjed`: verktøyene returnerer et `beskjed`-felt, men det er skrevet
 * til MODELLEN, ikke til brukeren. Omtrent halvparten er instruksjoner («spør
 * brukeren hvilket de mener», «ikke start et intervju»). Å lese dem høyt ville
 * vært pinlig. Derfor er dette en KURATERT liste: kun verktøy der beskjeden er
 * verifisert brukervendt står her, resten faller gjennom til modellen.
 */

/**
 * Felt i et verktøysvar som betyr at MODELLEN må snakke.
 *
 * `oppfolging` er det viktigste: fører du timer uten kommentar, skal assistenten
 * spørre om hva som ble gjort — det kan ingen mal gjøre. `flertydig` betyr at
 * modellen må stille et valgspørsmål. Er noen av disse til stede, gir vi fra oss
 * turen selv om verktøyet ellers hadde en fin bekreftelse.
 */
const MODELLEN_MÅ_SNAKKE = ['oppfolging', 'flertydig', 'kandidater', 'feil'] as const

/**
 * Verktøy der `beskjed` er verifisert brukervendt og kan leses ordrett.
 *
 * Sjekk kilden før du legger til flere — `beskjed` er ikke garantert opplesbar,
 * og en feil her betyr at assistenten sier noe som var ment for modellen.
 */
const BESKJED_ER_BRUKERVENDT = new Set([
  'legg_til_materiell', // «La 10 meter PN 3x2,5 på ordre 1042.»
  'ta_ut_materiell', // «Tok ut 5 stk … fra Bilen. Ligger i kurven …»
  'foer_timer', // «Førte 3 timer på ordre 1042 som montasje.»
  'utfyll_timenotat',
  'legg_til_tilbudslinje',
])

/** Verktøy vi formulerer selv, fordi verktøyets egen beskjed er modellrettet. */
const EGNE_MALER: Record<string, (args: Record<string, unknown>) => string | null> = {
  opprett_ordre: args => {
    const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
    return tittel ? `Ordren «${tittel}» er opprettet, og du er med på den.` : 'Ordren er opprettet, og du er med på den.'
  },
  bli_med_pa_ordre: args => {
    const n = args.ordrenummer
    return typeof n === 'number' ? `Du er med på ordre ${n} nå.` : null
  },
  husk_notat: () => 'Husket.',
  glem_notat: () => 'Glemt.',
  opprett_paaminnelse: args => {
    const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
    return tittel ? `Påminnelse satt: ${tittel}.` : null
  },
  paaminnelse_utfort: () => 'Kvittert ut.',
}

/**
 * Setningen som skal leses opp for denne turen — eller null hvis modellen bør
 * ta den.
 *
 * Vi gir fra oss turen ved minste tvil. En mal som treffer 70 % av gangene og
 * tier resten er verdt mye; en mal som gjetter er verdt mindre enn ingenting,
 * fordi brukeren da får en bekreftelse som ikke stemmer med det som skjedde.
 */
export function komponerSvar(utfoerte: UtfoertVerktoy[]): string | null {
  if (utfoerte.length === 0) return null

  const setninger: string[] = []

  for (const u of utfoerte) {
    if (MODELLEN_MÅ_SNAKKE.some(felt => felt in u.resultat)) return null

    const egen = EGNE_MALER[u.navn]?.(u.argumenter)
    if (egen) {
      setninger.push(egen)
    } else if (BESKJED_ER_BRUKERVENDT.has(u.navn) && typeof u.resultat.beskjed === 'string') {
      setninger.push(u.resultat.beskjed)
    } else {
      // Ukjent verktøy i denne turen — vi vet ikke hva som bør sies om det, og
      // en delvis bekreftelse er verre enn å la modellen ta hele turen.
      return null
    }

    // Advarsler er ikke pynt: «varen har ingen pris» betyr at linja faller ut av
    // fakturagrunnlaget. Den skal sies, og den skal sies med en gang.
    if (typeof u.resultat.advarsel === 'string') setninger.push(u.resultat.advarsel)
  }

  if (setninger.length === 0) return null
  return setninger.join(' ')
}
