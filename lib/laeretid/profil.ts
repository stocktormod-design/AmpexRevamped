/**
 * Læringsprofilen — hvor godt han kan hver del av kompetansemålene.
 * Ren logikk, selvtestet i `npm run verify:laeretid`.
 *
 * Tormod 27.09.2026: «folk vil lære ting, så vi burde bygge en lære/dybde
 * profil per bruker, som justerer seg etter nivå og hjelper der det trengs,
 * basert på quiz og logg.»
 *
 * Profilen REGNES UT, den lagres ikke. Den bygger på quizsvarene, og de er
 * hans alene (RLS: `laerling_id = auth.uid()`, uten unntak). En lagret profil
 * ville vært en ny tabell noen kunne ønske innsyn i; en utregning på telefonen
 * er det ikke.
 *
 * Nivå per del:
 *   0 ny            — aldri spurt, aldri i en logg
 *   1 grunnleggende — i logger, men lite eller svakt i quiz, eller bommet nylig
 *   2 trygg         — klarer det, noen ganger
 *   3 sterk         — klarer det gjentatte ganger, også lenge etter
 *
 * Nyere svar teller mer (halveringstid 60 dager): det han kunne i fjor vår er
 * mindre verdt enn det han kan nå. Et bom de siste tre ukene holder delen på
 * grunnleggende til han har klart den igjen — det er repetisjonen som flytter
 * ham, ikke tida.
 *
 * Nivået brukes til to ting: quizen tilpasser vanskelighetsgraden, og
 * «øv på det du trenger» plukker de svakeste delene først.
 */
import type { Sporsmaal } from './quiz'

export type Nivaa = 0 | 1 | 2 | 3

export const NIVAANAVN: Record<Nivaa, string> = {
  0: 'Ny',
  1: 'Grunnleggende',
  2: 'Trygg',
  3: 'Sterk',
}

/** Hva quizen skal spørre om på hvert nivå. Sendes til modellen. */
export const NIVAAHINT: Record<Nivaa, string> = {
  0: 'Nytt tema: spør enkelt om hva og hvorfor.',
  1: 'Grunnleggende: spør om hvorfor det gjøres slik, med utgangspunkt i jobben.',
  2: 'Trygg: la ham bruke det på en litt annen situasjon enn den han sto i.',
  3: 'Sterk: spør om grensetilfeller, feilsøking eller dimensjonering.',
}

export type Temanivaa = {
  maalNr: number
  delId: string
  nivaa: Nivaa
  /** Vektet poeng; brukes til sortering, ikke til visning. */
  poeng: number
  bestatt: number
  stroket: number
  /** Logger der delen har et belegg. */
  iLogger: number
  /** ISO-dato for siste svar på delen. */
  sist: string | null
}

export type ProfilBelegg = { loggId: string; maalNr: number; delId: string; utfortSelv: boolean }

const HALVERING_DAGER = 60
const NYLIG_BOM_DAGER = 21

function dagerMellom(fra: string, til: string): number {
  const a = Date.parse(fra), b = Date.parse(til)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.floor((b - a) / 86_400_000))
}

function nokkel(maalNr: number, delId: string) { return `${maalNr}/${delId}` }

/** Profilen for alle deler han har vært borti, i quiz eller logg. */
export function byggProfil(sporsmaal: Sporsmaal[], belegg: ProfilBelegg[], iDag: string): Temanivaa[] {
  const kart = new Map<string, Temanivaa & { nyligBom: boolean }>()
  const hent = (maalNr: number, delId: string) => {
    const k = nokkel(maalNr, delId)
    let t = kart.get(k)
    if (!t) {
      t = { maalNr, delId, nivaa: 0, poeng: 0, bestatt: 0, stroket: 0, iLogger: 0, sist: null, nyligBom: false }
      kart.set(k, t)
    }
    return t
  }

  const logger = new Map<string, Set<string>>()
  for (const b of belegg) {
    const k = nokkel(b.maalNr, b.delId)
    if (!logger.has(k)) logger.set(k, new Set())
    logger.get(k)!.add(b.loggId)
    hent(b.maalNr, b.delId)
  }
  for (const [k, sett] of logger) kart.get(k)!.iLogger = sett.size

  for (const s of sporsmaal) {
    if (!s.besvart || !s.vurdering) continue
    const t = hent(s.maalNr, s.delId)
    const vekt = Math.pow(0.5, dagerMellom(s.besvart, iDag) / HALVERING_DAGER)
    if (s.vurdering === 'bestatt') { t.bestatt++; t.poeng += vekt }
    else {
      t.stroket++; t.poeng -= vekt
      if (dagerMellom(s.besvart, iDag) <= NYLIG_BOM_DAGER) t.nyligBom = true
    }
    if (!t.sist || s.besvart > t.sist) t.sist = s.besvart
  }

  // Et nylig bom oppheves av et bestått ETTER det.
  for (const t of kart.values()) {
    if (!t.nyligBom) continue
    const bom = sporsmaal.filter(s => s.maalNr === t.maalNr && s.delId === t.delId && s.vurdering === 'stroket' && s.besvart)
      .map(s => s.besvart!).sort().pop()!
    const senere = sporsmaal.some(s => s.maalNr === t.maalNr && s.delId === t.delId
      && s.vurdering === 'bestatt' && s.besvart && s.besvart > bom)
    if (senere) t.nyligBom = false
  }

  return [...kart.values()].map(({ nyligBom, ...t }) => {
    let nivaa: Nivaa
    if (t.bestatt === 0 && t.stroket === 0) nivaa = t.iLogger > 0 ? 1 : 0
    else if (nyligBom || t.poeng < 0.5) nivaa = 1
    else if (t.bestatt >= 3 && t.poeng >= 2) nivaa = 3
    else nivaa = 2
    return { ...t, nivaa }
  }).sort((a, b) => a.maalNr - b.maalNr || a.delId.localeCompare(b.delId))
}

/** Nivået for én del. Ukjent del er ny. */
export function nivaaFor(profil: Temanivaa[], maalNr: number, delId: string): Nivaa {
  return profil.find(t => t.maalNr === maalNr && t.delId === delId)?.nivaa ?? 0
}

/**
 * Hva han bør øve på nå, i rekkefølge: det han bommet på, så det han har
 * gjort i jobben men aldri er spurt om, så det svakeste av resten. Deler han
 * aldri har vært borti i en logg er ikke med — dem kan ikke quizen spørre om
 * uten å finne på en jobb.
 */
export function fokus(profil: Temanivaa[], antall = 3): Temanivaa[] {
  const kandidater = profil.filter(t => t.iLogger > 0 && t.nivaa < 3)
  const rang = (t: Temanivaa) =>
    t.stroket > 0 && t.nivaa === 1 ? 0
      : t.bestatt + t.stroket === 0 ? 1
        : 2
  return kandidater
    .sort((a, b) => rang(a) - rang(b) || a.poeng - b.poeng || a.maalNr - b.maalNr)
    .slice(0, antall)
}

/** Fordelingen han ser på forsida: hvor mange deler på hvert nivå. */
export function fordeling(profil: Temanivaa[]): Record<Nivaa, number> {
  const ut: Record<Nivaa, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }
  for (const t of profil) ut[t.nivaa]++
  return ut
}

// ── Teori ───────────────────────────────────────────────────────────────────

export type TemaNivaa = { tema: string; nivaa: Nivaa; bestatt: number; stroket: number; poeng: number }

/**
 * Nivå per teoritema, med samme regler som for delene: nyere svar teller mer,
 * et nylig bom holder på grunnleggende til han har klart det igjen.
 */
export function temaProfil(sporsmaal: Sporsmaal[], iDag: string): Map<string, TemaNivaa> {
  const ut = new Map<string, TemaNivaa & { nyligBom: string | null; sisteBestatt: string | null }>()
  for (const s of sporsmaal) {
    if (!s.tema || !s.besvart || !s.vurdering) continue
    let t = ut.get(s.tema)
    if (!t) { t = { tema: s.tema, nivaa: 0, bestatt: 0, stroket: 0, poeng: 0, nyligBom: null, sisteBestatt: null }; ut.set(s.tema, t) }
    const vekt = Math.pow(0.5, dagerMellom(s.besvart, iDag) / HALVERING_DAGER)
    if (s.vurdering === 'bestatt') {
      t.bestatt++; t.poeng += vekt
      if (!t.sisteBestatt || s.besvart > t.sisteBestatt) t.sisteBestatt = s.besvart
    } else {
      t.stroket++; t.poeng -= vekt
      if (dagerMellom(s.besvart, iDag) <= NYLIG_BOM_DAGER && (!t.nyligBom || s.besvart > t.nyligBom)) t.nyligBom = s.besvart
    }
  }
  const svar = new Map<string, TemaNivaa>()
  for (const t of ut.values()) {
    const bom = t.nyligBom && !(t.sisteBestatt && t.sisteBestatt > t.nyligBom)
    const nivaa: Nivaa = bom || t.poeng < 0.5 ? 1 : t.bestatt >= 3 && t.poeng >= 2 ? 3 : 2
    svar.set(t.tema, { tema: t.tema, nivaa, bestatt: t.bestatt, stroket: t.stroket, poeng: t.poeng })
  }
  return svar
}

/**
 * Hvilket tema stien anbefaler nå: det han har bommet på først, så det første
 * på stien han ikke har prøvd, så det svakeste av resten. `rekkefolge` er
 * stiens rekkefølge (teori.ts).
 */
export function nesteTema(rekkefolge: string[], profil: Map<string, TemaNivaa>): string | null {
  const bommet = rekkefolge.filter(id => { const t = profil.get(id); return t && t.nivaa === 1 && t.stroket > 0 })
  if (bommet.length) return bommet[0]
  const ny = rekkefolge.find(id => !profil.has(id))
  if (ny) return ny
  const svakest = rekkefolge
    .filter(id => (profil.get(id)?.nivaa ?? 0) < 3)
    .sort((a, b) => (profil.get(a)!.poeng) - (profil.get(b)!.poeng))[0]
  return svakest ?? null
}
