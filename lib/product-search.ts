/**
 * Varesøk — ren logikk, ingen database. Selvtestes i `npm run verify:varesok`.
 *
 * Målet er EFObasen-følelsen: du taster det du har i hånda — et el-nummer, de
 * fire siste sifrene på etiketten, produsentnavnet, typebetegnelsen, eller
 * strekkoden — og varen kommer opp.
 *
 * To ting som var galt før:
 *
 *   1. **El-nummer traff bare fra starten.** De fire siste sifrene på en etikett
 *      er ofte det eneste som er lesbart etter et år i en kjeller.
 *   2. **Flerordssøk feilet.** «nexans pfsp» krevde at hele strengen sto
 *      sammenhengende i navnet. Nå må hvert ord finnes, ikke rekkefølgen.
 */

/**
 * Ord montører bruker, og hva de betyr i katalogen.
 *
 * Grossistens nettbutikk har dette fordi noen har vedlikeholdt en synonymliste
 * i ti år. Vår er kort og norsk, og dekker det folk faktisk sier i bilen —
 * «spot» og «downlight» er samme vare, og «kobo» står ikke i noe varenavn.
 *
 * Nøkkelen er det du taster; verdiene er hva det også skal treffe.
 */
export const SYNONYMER: Record<string, string[]> = {
  spot: ['downlight'],
  spotter: ['downlight'],
  lys: ['downlight', 'armatur', 'utelampe', 'panel'],
  lampe: ['armatur', 'utelampe', 'downlight'],
  armatur: ['downlight', 'panel'],
  sikring: ['automatsikring', 'jordfeilautomat'],
  kurs: ['automatsikring', 'jordfeilautomat'],
  jordfeil: ['jordfeilautomat', 'jordfeilbryter'],
  kobo: ['koblingsboks'],
  boks: ['koblingsboks', 'apparatboks'],
  skap: ['sikringsskap'],
  tavle: ['sikringsskap', 'fordelingsskinne'],
  stikk: ['stikkontakt'],
  kontakt: ['stikkontakt'],
  bryter: ['bryter', 'dimmer'],
  kanal: ['kabelkanal'],
  bro: ['kabelbro'],
  rør: ['kabelkanal'],
  varme: ['varmekabel', 'varmekabelmatte', 'termostat'],
  gulvvarme: ['varmekabel', 'varmekabelmatte', 'termostat'],
  lader: ['ladeboks'],
  lading: ['ladeboks'],
  elbil: ['ladeboks'],
  røyk: ['røykvarsler'],
  brann: ['røykvarsler'],
  komfyr: ['komfyrvakt'],
  jord: ['jordledning', 'jordkabel', 'jordfeilautomat'],
  overspenning: ['overspenningsvern'],
}

export type SokbarVare = {
  id: string
  elnummer: string | null
  navn: string
  fabrikat: string | null
  typeBetegnelse: string | null
  ean: string | null
  nrf: string | null
  /** Alt søkbart slått sammen, små bokstaver. Se lib/pricefile/varekort.ts. */
  sokeTekst: string
}

/**
 * Deler søket i ord. Komma og punktum beholdes INNE i ord, fordi «3G2,5» er ett
 * ord i faget — men de er også skilletegn i «1,5/2,5», så tokens splittes på
 * skråstrek og mellomrom.
 */
export function deleSok(sok: string): string[] {
  return sok
    .toLowerCase()
    .split(/[\s/;]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Kun siffer. El-nummer er sjusifret, EAN 13 — et rent tallsøk er nesten alltid ett av dem. */
export function erTall(s: string): boolean {
  return /^\d+$/.test(s)
}

/** Søketekst uten mellomrom, for å sammenligne mot et nummer skrevet med mellomrom. */
function bareSiffer(s: string): string {
  return s.replace(/\D/g, '')
}

/**
 * Rangering — lavere er bedre. `null` betyr ingen treff.
 *
 * Rekkefølgen speiler hva montøren sannsynligvis holder i hånda, ikke hva som
 * er billigst å regne ut.
 */
export function rangerVare(v: SokbarVare, sok: string, tokens: string[]): number | null {
  const q = sok.trim().toLowerCase()
  if (!q) return 100

  const el = (v.elnummer ?? '').toLowerCase()
  const navn = v.navn.toLowerCase()
  const fabrikat = (v.fabrikat ?? '').toLowerCase()
  const type = (v.typeBetegnelse ?? '').toLowerCase()
  const qSiffer = bareSiffer(q)

  if (el && qSiffer && el === qSiffer) return 0
  if (qSiffer && (v.ean === qSiffer || v.nrf === qSiffer)) return 1
  if (el && qSiffer && el.startsWith(qSiffer)) return 2
  // Kun for rene tallsøk: ellers ville «5» truffet hvert el-nummer med et 5-tall.
  if (el && qSiffer.length >= 3 && erTall(q.replace(/\s/g, '')) && el.includes(qSiffer)) return 3
  if (navn === q) return 4
  if (type && type === q) return 5
  if (navn.startsWith(q)) return 6
  if (fabrikat.startsWith(q)) return 7
  if (type.startsWith(q)) return 8

  // Ett eller to sifre finnes inne i nesten hvert el-nummer, hver EAN og hver
  // rabattgruppe. Et slikt søk bærer ingen informasjon — det ville returnert
  // halve kartoteket i tilfeldig rekkefølge. Da er ingen treff et ærligere svar
  // enn tusen. (Bokstaver er noe annet: «ka» sier faktisk noe.)
  if (tokens.some(t => erTall(t) && t.length < 3)) return null

  // Den generelle veien: hvert ord må finnes et sted, i hvilken som helst
  // rekkefølge. Det er dette som gjør «nexans pfsp» og «pfsp nexans» like gode.
  // Et ord teller også som funnet hvis et av synonymene finnes — «spot» skal
  // treffe downlights selv om ordet «spot» ikke står noe sted.
  const alle = tokens.every(t => treffer(v.sokeTekst, t))
  if (!alle) return null
  // Synonymtreff rangeres litt lavere enn ordrette: står ordet der faktisk,
  // er det et bedre treff enn at vi gjettet oss fram til det.
  return tokens.every(t => v.sokeTekst.includes(t)) ? 9 : 10
}

/** Finnes ordet, eller et av synonymene, i søketeksten? */
function treffer(sokeTekst: string, token: string): boolean {
  if (sokeTekst.includes(token)) return true
  const syn = SYNONYMER[token]
  return syn ? syn.some(x => sokeTekst.includes(x)) : false
}

/* ── «Mente du …» ─────────────────────────────────────────────────────────── */

/**
 * Redigeringsavstand med tak. Avbryter så snart avstanden overstiger `maks`,
 * så en full matrise aldri bygges for ord som åpenbart ikke ligner.
 */
export function avstand(a: string, b: string, maks = 2): number {
  if (Math.abs(a.length - b.length) > maks) return maks + 1
  let forrige = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const rad = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const kost = a[i - 1] === b[j - 1] ? 0 : 1
      rad[j] = Math.min(rad[j - 1] + 1, forrige[j] + 1, forrige[j - 1] + kost)
      best = Math.min(best, rad[j])
    }
    if (best > maks) return maks + 1
    forrige = rad
  }
  return forrige[b.length]
}

/**
 * Nærmeste kjente ord, når søket ikke ga treff.
 *
 * Måles KUN mot varegrupper og produsentnavn — noen titalls ord — ikke mot hele
 * katalogen. En redigeringsavstand mot 40 000 varenavn ved hvert tastetrykk
 * ville stått i veien for det den skulle hjelpe med.
 *
 * Returnerer et forslag, ikke andre treff: å stille bytte ut søket er verre enn
 * å spørre. Det er også slik nettbutikkene gjør det.
 */
export function foreslaaRetting(sok: string, vokabular: string[]): string | null {
  const q = sok.trim().toLowerCase()
  if (q.length < 4 || q.includes(' ')) return null
  const maks = q.length >= 7 ? 2 : 1
  let beste: { ord: string; d: number } | null = null
  for (const ord of vokabular) {
    const d = avstand(q, ord.toLowerCase(), maks)
    if (d <= maks && (!beste || d < beste.d)) beste = { ord, d }
  }
  return beste?.ord ?? null
}

/* ── Sortering ────────────────────────────────────────────────────────────── */

export type Sortering = 'relevans' | 'pris' | 'navn'

export const sorteringLabel: Record<Sortering, string> = {
  relevans: 'Relevans',
  pris: 'Laveste pris',
  navn: 'Navn',
}

export type Varefilter = {
  /** Kun varer der én av grossistene er denne. Sjekkes av kalleren mot prisene. */
  grossist?: string | null
  fabrikat?: string | null
  rabattGruppe?: string | null
  /** Kun varer vi har på lager selv. */
  kunPaaLager?: boolean
  /** Kun varer grossisten fører (lagerført hos dem). */
  kunLagerfoert?: boolean
  /** Varegruppe utledet av varenavnet — se lib/product-category.ts. */
  kategori?: string | null
}

/**
 * Sorterer og kutter. Rekkefølgen innenfor samme rang er alfabetisk på norsk,
 * så lista ikke hopper rundt mellom to like gode treff.
 */
export function sorterTreff<T extends { vare: SokbarVare }>(
  kandidater: T[],
  sok: string,
  maks = 60,
): T[] {
  const tokens = deleSok(sok)
  return kandidater
    .map(k => ({ k, r: rangerVare(k.vare, sok, tokens) }))
    .filter((x): x is { k: T; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.k.vare.navn.localeCompare(b.k.vare.navn, 'nb'))
    .slice(0, maks)
    .map(x => x.k)
}

/**
 * Mønster for SQLite-forfiltrering (`Q.like`).
 *
 * Vi kan ikke gjøre hele rangeringen i SQL, men vi kan la databasen kaste de
 * 39 000 radene som umulig kan treffe. Uten dette leses hele varekartoteket inn
 * i JS ved hvert tastetrykk — usynlig med en håndskrevet fixture, umulig med en
 * ekte EFO-fil.
 *
 * Det LENGSTE ordet velges: det er mest selektivt. Rene tallsøk sammenlignes
 * mot søketeksten uten mellomrom, siden el-nummer lagres uten.
 */
export function likeMonster(sok: string): string | null {
  const tokens = deleSok(sok)
  if (tokens.length === 0) return null
  const lengst = tokens.reduce((a, b) => (b.length > a.length ? b : a))
  // Ett og to tegn er ikke selektivt nok til å være verdt en LIKE-skanning;
  // da er det raskere å hente alt og filtrere i JS.
  return lengst.length >= 3 ? `%${lengst}%` : null
}
