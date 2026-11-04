/**
 * Redigering i tegnemodusen (kontoret, 30.10): det som skjer med et UTVALG — flytt, kopier,
 * roter, slett, legg på kurs — og hva en markeringsboks treffer. Rent, uten React, så det kan
 * selvtestes (`npm run verify:prosjektering`) og brukes likt av tastatur, kommandolinje og mus.
 *
 * Utvalget er en liste id-er på tvers av typene (punkt, føring, fare, rom, kurs, «malestokk»).
 * Det følger konvensjonen fra AutoCAD og Figma: klikk velger, Shift legger til/tar bort,
 * boks fra venstre mot høyre tar det som ligger HELT inni («vindu»), fra høyre mot venstre det
 * som berøres («kryssing»).
 */

import { boksFor, nesteKursNr, type Boks, type Prosjektering, type Pt } from './prosjektering'

export type Utvalg = string[]

const ny = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))

/** Fjerner utvalget. Kurser som slettes tas av punktene og føringene som lå på dem. */
export function slettUtvalg(p: Prosjektering, ids: Utvalg): Prosjektering {
  const ut = new Set(ids)
  return {
    ...p,
    plan: ut.has('malestokk') ? { ...p.plan, malestokk: null } : p.plan,
    punkter: p.punkter.filter(x => !ut.has(x.id)).map(x => (x.kursId && ut.has(x.kursId) ? { ...x, kursId: undefined } : x)),
    foringer: p.foringer.filter(x => !ut.has(x.id)).map(x => (x.kursId && ut.has(x.kursId) ? { ...x, kursId: undefined } : x)),
    farer: p.farer.filter(x => !ut.has(x.id)),
    rom: p.rom.filter(x => !ut.has(x.id)),
    kurser: p.kurser.filter(x => !ut.has(x.id)),
  }
}

const skyv = (q: Pt, dx: number, dy: number): Pt => ({ x: q.x + dx, y: q.y + dy })

/** Flytter alt i utvalget like langt (normaliserte enheter). */
export function flyttUtvalg(p: Prosjektering, ids: Utvalg, dx: number, dy: number): Prosjektering {
  const inn = new Set(ids)
  return {
    ...p,
    punkter: p.punkter.map(x => (inn.has(x.id) ? { ...x, ...skyv(x, dx, dy) } : x)),
    farer: p.farer.map(x => (inn.has(x.id) && x.x != null && x.y != null ? { ...x, x: x.x + dx, y: x.y + dy } : x)),
    rom: p.rom.map(x => (inn.has(x.id)
      ? { ...x, form: { ...x.form, x: x.form.x + dx, y: x.form.y + dy }, polygon: x.polygon?.map(q => skyv(q, dx, dy)) }
      : x)),
    foringer: p.foringer.map(x => (inn.has(x.id) ? { ...x, pts: x.pts.map(q => skyv(q, dx, dy)) } : x)),
  }
}

/**
 * Kopierer punkter, føringer og farer i utvalget (rom og kurser kopieres ikke — et rom to
 * ganger er en feil, og en kurs er et nummer i tavla). Kopiene får nye id-er og er det nye utvalget.
 */
export function dupliserUtvalg(p: Prosjektering, ids: Utvalg, dx: number, dy: number): { p: Prosjektering; nye: Utvalg } {
  const inn = new Set(ids)
  const nye: string[] = []
  const punkter = p.punkter.filter(x => inn.has(x.id)).map(x => { const id = ny(); nye.push(id); return { ...x, id, x: x.x + dx, y: x.y + dy } })
  const foringer = p.foringer.filter(x => inn.has(x.id)).map(x => { const id = ny(); nye.push(id); return { ...x, id, pts: x.pts.map(q => skyv(q, dx, dy)) } })
  const farer = p.farer.filter(x => inn.has(x.id)).map(x => { const id = ny(); nye.push(id); return { ...x, id, x: x.x != null ? x.x + dx : x.x, y: x.y != null ? x.y + dy : x.y } })
  return { p: { ...p, punkter: [...p.punkter, ...punkter], foringer: [...p.foringer, ...foringer], farer: [...p.farer, ...farer] }, nye }
}

/** Roterer symbolene i utvalget om sitt eget midtpunkt, i hele 90-graderssteg som standard. */
export function roterUtvalg(p: Prosjektering, ids: Utvalg, grader: number): Prosjektering {
  const inn = new Set(ids)
  return { ...p, punkter: p.punkter.map(x => (inn.has(x.id) ? { ...x, vinkel: ((((x.vinkel ?? 0) + grader) % 360) + 360) % 360 || undefined } : x)) }
}

/** Legger punktene og føringene i utvalget på kursen (null = tar dem av). */
export function settKurs(p: Prosjektering, ids: Utvalg, kursId: string | null): Prosjektering {
  const inn = new Set(ids)
  const k = kursId ?? undefined
  return {
    ...p,
    punkter: p.punkter.map(x => (inn.has(x.id) ? { ...x, kursId: k } : x)),
    foringer: p.foringer.map(x => (inn.has(x.id) ? { ...x, kursId: k } : x)),
  }
}

/** «Ny kurs av valgte» (Revit: velg punktene → lag kurs). Gir kursens id. */
export function kursAvUtvalg(p: Prosjektering, ids: Utvalg, navn = ''): { p: Prosjektering; kursId: string } {
  const kursId = ny()
  const kurs = { id: kursId, nr: nesteKursNr(p.kurser), navn, vern: '', rcd: '', kabel: '', forlegning: '', merknad: '' }
  return { p: settKurs({ ...p, kurser: [...p.kurser, kurs] }, ids, kursId), kursId }
}

/** Det et element dekker på planen, for markeringsboksen. Kurser og fare uten sted har ingen. */
function utstrekning(p: Prosjektering, id: string): Boks | null {
  const pt = p.punkter.find(x => x.id === id)
  if (pt) return { x: pt.x, y: pt.y, w: 0, h: 0 }
  const f = p.foringer.find(x => x.id === id)
  if (f) return boksFor(f.pts)
  const fa = p.farer.find(x => x.id === id)
  if (fa && fa.x != null && fa.y != null) return { x: fa.x, y: fa.y, w: 0, h: 0 }
  const r = p.rom.find(x => x.id === id)
  if (r) return r.form
  return null
}

/**
 * Hva en markeringsboks fra `a` til `b` treffer. Mot høyre: bare det som ligger helt inni.
 * Mot venstre: alt den berører. `skjult` = id-er som ikke vises (lag slått av) og ikke kan velges.
 */
export function iBoks(p: Prosjektering, a: Pt, b: Pt, skjult: (id: string) => boolean = () => false): Utvalg {
  const kryss = b.x < a.x
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
  const ids = [...p.punkter.map(x => x.id), ...p.foringer.map(x => x.id), ...p.farer.map(x => x.id), ...p.rom.map(x => x.id)]
  return ids.filter(id => {
    if (skjult(id)) return false
    const u = utstrekning(p, id)
    if (!u) return false
    if (kryss) return u.x <= x1 && u.x + u.w >= x0 && u.y <= y1 && u.y + u.h >= y0
    return u.x >= x0 && u.x + u.w <= x1 && u.y >= y0 && u.y + u.h <= y1
  })
}

/** Lengden langs en polylinje i meter (målingsverktøyet), null uten målestokk. */
export function lengdeLangs(pts: Pt[], mpe: { x: number; y: number } | null): number | null {
  if (!mpe) return null
  let m = 0
  for (let i = 1; i < pts.length; i++) m += Math.hypot((pts[i].x - pts[i - 1].x) * mpe.x, (pts[i].y - pts[i - 1].y) * mpe.y)
  return m
}

/** Hvilket slag et id er, for egenskapspanelet og statuslinja. */
export type Slag = 'punkt' | 'foring' | 'fare' | 'rom' | 'kurs' | 'malestokk'
export function slagFor(p: Prosjektering, id: string): Slag | null {
  if (id === 'malestokk') return p.plan.malestokk ? 'malestokk' : null
  if (p.punkter.some(x => x.id === id)) return 'punkt'
  if (p.foringer.some(x => x.id === id)) return 'foring'
  if (p.farer.some(x => x.id === id)) return 'fare'
  if (p.rom.some(x => x.id === id)) return 'rom'
  if (p.kurser.some(x => x.id === id)) return 'kurs'
  return null
}

/** Søk i kommandolinja: alle ordene må finnes, i navn eller nøkkelord. Treff tidlig i navnet først. */
export function sokKommandoer<T extends { navn: string; ord?: string }>(liste: T[], sporring: string): T[] {
  const ord = sporring.toLowerCase().split(/\s+/).filter(Boolean)
  if (!ord.length) return liste
  return liste
    .map(k => ({ k, tekst: `${k.navn} ${k.ord ?? ''}`.toLowerCase() }))
    .filter(({ tekst }) => ord.every(o => tekst.includes(o)))
    .sort((a, b) => a.tekst.indexOf(ord[0]) - b.tekst.indexOf(ord[0]))
    .map(({ k }) => k)
}
