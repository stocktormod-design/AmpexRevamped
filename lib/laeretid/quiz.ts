/**
 * Utspørringen — ren logikk, ingen database. Selvtestes i
 * `npm run verify:laeretid`.
 *
 * Når tekst er gratis, er tekst ikke lenger bevis. Det eneste som fortsatt
 * beviser kompetanse er et svar på et spørsmål du ikke visste kom, om arbeid
 * du faktisk gjorde. Derfor er utspørringen ikke en quiz på toppen av
 * produktet — den ER produktet, og dette er sporet som gjør et kryss verdt noe.
 *
 * ── To runder, to forskjellige jobber ───────────────────────────────────────
 *
 * Runde 1 kommer samme kveld: forsto du det du gjorde i dag? Svarene her
 * avgjør avkryssingen — klarer han ikke å forklare det loggen påstår, settes
 * ikke krysset.
 *
 * Runde 2 kommer noen dager etter: sitter det fortsatt? Det er her læringen
 * skjer, og det er den formen fagprøven har.
 *
 * **Stryk i runde 2 fjerner ALDRI krysset.** Han gjorde jobben og forklarte den
 * da den var fersk. Temaet går tilbake i rotasjon og markeres som teoretisk
 * svakt. Alt annet ville vært urimelig.
 *
 * ── Takten er en anbefaling, ikke en sperre ─────────────────────────────────
 *
 * Spørsmålene ligger alltid åpne. Han kan ta alle på én kveld om han vil. Det
 * som er tidsstyrt er DYTTET: varselet kommer når spørsmålet er verdt mest.
 * Ingen streaks, ingen skyld — en montør på to ukers anlegg skal ikke miste
 * noe, og skyld som mekanikk skaper motvilje mot et arbeidsverktøy.
 */
import { finnOppslag } from './nek-kart'

export type Runde = 1 | 2

export type Vurdering = 'bestatt' | 'stroket'

export type Sporsmaal = {
  id: string
  /** Loggen spørsmålet handler om. Null for teorispørsmål. */
  loggId: string | null
  /** Teoritema (teori.ts). Satt for teorispørsmål, ellers null/utelatt. */
  tema?: string | null
  maalNr: number
  delId: string
  runde: Runde
  /** Spørsmålet, laget av det HAN skrev — ikke fra en spørsmålsbank. */
  tekst: string
  /** Hans eget svar, ordrett. Null til han har svart. */
  svar: string | null
  vurdering: Vurdering | null
  /** ISO-dato spørsmålet ble laget. */
  laget: string
  /** ISO-dato han svarte. Null til da. */
  besvart: string | null
}

/** Runde 2 er verdt lite før det har gått noen dager. */
export const DAGER_TIL_RUNDE_2 = 3

/** Et tema han bommet på kommer tilbake, men ikke med en gang. */
export const DAGER_TIL_REPETISJON = 21

function dagerMellom(fra: string, til: string): number {
  const a = Date.parse(fra), b = Date.parse(til)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.floor((b - a) / 86_400_000)
}

export type Dytt = {
  sporsmaal: Sporsmaal
  grunn: 'fersk' | 'repetisjon'
  tekst: string
}

/**
 * Hvilket spørsmål bør han dyttes på nå — om noe?
 *
 * Reglene, i rekkefølge:
 *   1. Aldri mer enn ETT dytt om dagen. Skriver han fire logger på én kveld,
 *      køes varslene utover i stedet for å komme som åtte påminnelser.
 *   2. Runde 1 dyttes med en gang: da er jobben fersk i hodet.
 *   3. Runde 2 dyttes tidligst tre dager etter at runde 1 ble besvart.
 *
 * Returnerer null når han er à jour. Det er et helt greit svar — «ingenting
 * venter på deg» er bedre enn å finne på noe å mase om.
 */
export function anbefaltDytt(alle: Sporsmaal[], iDag: string): Dytt | null {
  const dyttetIDag = alle.some(s => s.besvart === iDag)
  if (dyttetIDag) return null

  const ubesvart = alle.filter(s => s.besvart === null)

  const fersk = ubesvart
    .filter(s => s.runde === 1)
    .sort((a, b) => a.laget.localeCompare(b.laget))[0]
  if (fersk) {
    return { sporsmaal: fersk, grunn: 'fersk', tekst: 'Forsto du det du gjorde? Tre spørsmål om dagen din.' }
  }

  // Runde 2 hører til samme logg som runde 1, og teller fra da han SVARTE —
  // ikke fra da spørsmålet ble laget. Ellers ville en logg han skrev sent
  // fått repetisjonen for tidlig.
  const moden = ubesvart
    .filter(s => s.runde === 2)
    .filter(s => {
      // Teori henger ikke på en jobb som må «sette seg» — den er moden med en gang.
      if (s.tema) return true
      const runde1 = alle.find(x => x.loggId === s.loggId && x.runde === 1 && x.besvart)
      if (!runde1?.besvart) return false
      return dagerMellom(runde1.besvart, iDag) >= DAGER_TIL_RUNDE_2
    })
    .sort((a, b) => a.laget.localeCompare(b.laget))[0]
  if (moden) {
    return { sporsmaal: moden, grunn: 'repetisjon', tekst: 'Sitter det fortsatt? Ett spørsmål fra en logg du skrev.' }
  }

  return null
}

/**
 * Hva han taper på å ta runde 2 med én gang.
 *
 * Han får lov — ingen sperre. Men appen sier hva som går tapt, for verdien
 * ligger i mellomrommet, ikke i spørsmålet.
 */
export function forTidlig(s: Sporsmaal, alle: Sporsmaal[], iDag: string): string | null {
  if (s.runde !== 2 || s.tema) return null
  const runde1 = alle.find(x => x.loggId === s.loggId && x.runde === 1 && x.besvart)
  if (!runde1?.besvart) return null
  const gaatt = dagerMellom(runde1.besvart, iDag)
  if (gaatt >= DAGER_TIL_RUNDE_2) return null
  return `Denne er verdt mer om ${DAGER_TIL_RUNDE_2 - gaatt} ${DAGER_TIL_RUNDE_2 - gaatt === 1 ? 'dag' : 'dager'}. Du kan ta den nå hvis du vil.`
}

export type SvaktTema = { maalNr: number; delId: string; bommet: number; sistBommet: string }

/**
 * Temaer han har bommet på, og som skal komme tilbake.
 *
 * Dette er den andre slags svakhet: jobben ER gjort, men forklaringen sitter
 * ikke. Medisinen er å lese og øve, ikke å skaffe en jobb til — og et system
 * som bare teller logger kan ikke skille de to.
 */
export function svakeTemaer(alle: Sporsmaal[]): SvaktTema[] {
  const kart = new Map<string, SvaktTema>()
  for (const s of alle) {
    if (s.vurdering !== 'stroket' || !s.besvart) continue
    const nokkel = `${s.maalNr}/${s.delId}`
    const finnes = kart.get(nokkel)
    if (finnes) {
      finnes.bommet++
      if (s.besvart > finnes.sistBommet) finnes.sistBommet = s.besvart
    } else {
      kart.set(nokkel, { maalNr: s.maalNr, delId: s.delId, bommet: 1, sistBommet: s.besvart })
    }
  }
  // Flest bom først: det han bommer på gjentatte ganger er det han skal øve på.
  return [...kart.values()].sort((a, b) => b.bommet - a.bommet || a.maalNr - b.maalNr)
}

/** Er et svakt tema modent for å komme tilbake? */
export function forfaltTilRepetisjon(tema: SvaktTema, iDag: string): boolean {
  return dagerMellom(tema.sistBommet, iDag) >= DAGER_TIL_REPETISJON
}

// ── Fasiten ─────────────────────────────────────────────────────────────────

/**
 * Fasiten modellen bruker til å vurdere svaret.
 *
 * **Den er modellgenerert, og det skal stå.** Ikke som en ansvarsfraskrivelse,
 * men som en oppfordring med en adresse: «kan inneholde feil» er pynt ingen
 * handler på, mens «slå det opp i 543 på side 312» tar tretti sekunder.
 *
 * Det gjør dessuten svakheten til en øvelse. Å finne fram i NEK er halve
 * fagprøven, og en lærling som sjekker fasiten i boka har trent på nøyaktig
 * det sensor kommer til å be ham gjøre.
 */
export type Fasit = {
  /** Hva som regnes som et godt svar. */
  tekst: string
  /** Punktnummer i NEK 400:2026 der det kan etterprøves. Null når faget ikke er normert. */
  nek: string | null
}

/**
 * Linja som følger fasiten på skjermen.
 *
 * Med punktnummer blir den til et oppslag med sidetall. Uten blir den en ærlig
 * oppfordring om å spørre et menneske, for det finnes fag som ikke står i NEK
 * — kaldkapping av varmgalvanisert bro står ingen steder.
 */
export function etterprovLinje(f: Fasit): string {
  if (!f.nek) {
    return 'Dette er laget av AI og kan inneholde feil. Spør faglig leder hvis du er i tvil.'
  }
  const oppslag = finnOppslag(f.nek)
  if (!oppslag) {
    return `Dette er laget av AI og kan inneholde feil. Dobbeltsjekk i NEK ${f.nek}.`
  }
  return `Dette er laget av AI og kan inneholde feil. Dobbeltsjekk i NEK ${f.nek}, side ${oppslag.side}.`
}

// ── Fra svar til kryss ──────────────────────────────────────────────────────

/**
 * Hva utspørringen sier om ett belegg — `utspurt` på `laeretid_belegg`.
 *
 * Bare RUNDE 1 teller. Den spør om jobben mens den er fersk, og det er der
 * avkryssingen avgjøres. Runde 2 spør om det sitter, og et bom der sender
 * temaet tilbake i rotasjon uten å ta krysset — han gjorde jobben og forklarte
 * den da den var fersk.
 *
 * Ett strøk i runde 1 holder for å stryke: klarer han ikke å forklare én del av
 * det loggen påstår, skal den delen ikke krysses. Er ikke alle besvart ennå,
 * er svaret null — et halvferdig avhør er ikke en dom.
 */
export function utspurtForDel(
  alle: Sporsmaal[], loggId: string, maalNr: number, delId: string,
): Vurdering | null {
  const mine = alle.filter(s =>
    s.runde === 1 && s.loggId === loggId && s.maalNr === maalNr && s.delId === delId)
  if (mine.length === 0) return null
  if (mine.some(s => s.vurdering === 'stroket')) return 'stroket'
  if (mine.every(s => s.vurdering === 'bestatt')) return 'bestatt'
  return null
}

/**
 * Svake temaer som skal få et nytt spørsmål nå.
 *
 * Et tema er forfalt når det har gått tre uker siden siste bom. Det kommer
 * IKKE tilbake hvis:
 *   - det allerede ligger et ubesvart spørsmål på samme del (ellers lager vi
 *     et nytt hver gang han åpner skjermen), eller
 *   - han har klart det etter siste bom. Da er repetisjonen gjort — det er
 *     nettopp det sløyfa var til for.
 */
export function repetisjonerAaLage(alle: Sporsmaal[], iDag: string): SvaktTema[] {
  return svakeTemaer(alle).filter(tema => {
    if (!forfaltTilRepetisjon(tema, iDag)) return false
    // Bare jobbspørsmål: et åpent teorisett på samme del skal ikke stoppe repetisjonen.
    const sammeDel = alle.filter(s => s.maalNr === tema.maalNr && s.delId === tema.delId && !s.tema)
    if (sammeDel.some(s => s.besvart === null)) return false
    if (sammeDel.some(s => s.vurdering === 'bestatt' && s.besvart !== null && s.besvart > tema.sistBommet)) return false
    return true
  })
}

// ── Det modellen foreslår ───────────────────────────────────────────────────

/** Tre etter en logg, ett når det skal sitte. Kort økt, ikke et essay. */
export const ANTALL_PER_RUNDE: Record<Runde, number> = { 1: 3, 2: 1 }

export type Forslag = { maalNr: number; delId: string; tekst: string }

/**
 * Vasker det modellen foreslo før noe lagres.
 *
 * Modellen får velge mål og del, men den får ikke finne på dem: en del-id som
 * ikke finnes i læreplanen ville gitt et belegg ingen regel kan vurdere. To
 * spørsmål på samme del er bortkastet av tre mulige, og et spørsmål uten
 * spørsmålstegn er som regel en påstand han skal si seg enig i.
 */
export function vaskForslag(
  forslag: Forslag[],
  finnesDel: (maalNr: number, delId: string) => boolean,
  runde: Runde,
): Forslag[] {
  const sett = new Set<string>()
  const ut: Forslag[] = []
  for (const f of forslag) {
    const tekst = (f.tekst ?? '').trim()
    if (!tekst.endsWith('?')) continue
    if (!Number.isInteger(f.maalNr) || !finnesDel(f.maalNr, f.delId)) continue
    const nokkel = `${f.maalNr}/${f.delId}`
    if (sett.has(nokkel)) continue
    sett.add(nokkel)
    ut.push({ maalNr: f.maalNr, delId: f.delId, tekst })
    if (ut.length >= ANTALL_PER_RUNDE[runde]) break
  }
  return ut
}

/** Lokal kalenderdag som ISO — det reglene over sammenligner på. */
export function isoDag(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
