/**
 * Tegningen på en ordre (2026-10-30, «Verona»): planen, punktene, rommene med
 * bruk/brukere/ytre påvirkninger (FEL § 16), farene med risikomatrise, én SJA (FSE § 10) og
 * kompetansen jobben krever. Ett dokument per ordre (`tegningslag.data`, ordre eller prosjekttegning), skrevet av
 * kontoret og lest av delingslenka. Ren logikk, ingen I/O — `npm run verify:prosjektering`.
 *
 * Koordinatene er normaliserte 0..1 på planen, som resten av tegningsdelen. Meter kommer fra
 * målestokken: to punkter på planen og avstanden mellom dem.
 *
 * Alt her er FORSLAG installatøren tar stilling til. Koden velger ingen løsning; den husker
 * hva som er vanlig å vurdere, og regner det som kan regnes (areal, risikotall).
 */

export type Pt = { x: number; y: number }
export type Boks = { x: number; y: number; w: number; h: number }

export type Punkt = {
  id: string; type: string; x: number; y: number; notat?: string
  /** Kursen punktet ligger på (installasjonstegningen). */
  kursId?: string
  /** Monteringshøyde over ferdig gulv i cm. Tom = standardhøyden for typen (`standardHoyde`). */
  hoyde?: number
  /** Rotasjon i grader med klokka (stikk mot veggen). Tom = 0. */
  vinkel?: number
}

/**
 * Én kurs i tavla. Feltene er tekst med vilje: «C10», «30 mA type A», «IFXI 3G1,5», «A1 skjult
 * i isolert vegg» — det installatøren skriver i kursfortegnelsen, ikke en modell av NEK-tabellene
 * (de kommer som forslag + selvtest i fase C).
 */
export type Kurs = {
  id: string
  nr: string
  navn: string
  vern: string
  rcd: string
  kabel: string
  forlegning: string
  merknad: string
}

/** Føringsvei: en strek på planen. Skjult = i vegg/himling (stiplet), åpent = på vegg (heltrukket). */
export type Foring = { id: string; pts: Pt[]; skjult: boolean; kursId?: string }

export type Rom = {
  id: string
  navn: string
  form: Boks
  bruk: string
  brukere: string
  /** Koder fra NEK 400-5-51, f.eks. «AD4». */
  pavirkninger: string[]
  notat: string
  /** Omrisset når rommet er funnet på tegningen (sjelden et rektangel). `form` er da omsluttende boks. */
  polygon?: Pt[]
  /** Funnet automatisk: «usikker» = arealpåskriften stemte ikke, sjekk det. */
  funnet?: 'bekreftet' | 'usikker' | 'uten-paaskrift'
}

export type Fare = {
  id: string
  tittel: string
  /** Hvem faren rammer: anlegget og brukerne, eller den som gjør jobben. */
  gjelder: 'anlegg' | 'montor'
  romId?: string
  /** Sannsynlighet og konsekvens 1–5 før og etter tiltak. */
  s: number
  k: number
  tiltak: string
  restS: number
  restK: number
  /** Id i lib/risiko-katalog.ts når faren kom fra et forslag; tom for egne farer. */
  kilde?: string
  /** Plassert på planen (oppgave 1: «pek på tegningen»). */
  x?: number
  y?: number
}

export type SjaSteg = { id: string; steg: string; fare: string; tiltak: string; ansvarlig: string }
export type Sja = { arbeidsmoment: string; romId?: string; deltakere: string; steg: SjaSteg[]; konklusjon: string }

export type Kompetanse = { id: string; hva: string; hvorfor: string }

export type Prosjektering = {
  v: 1
  /** R2-nøkkel til planbildet/PDF-en (drawings/…), og målestokken. */
  plan: { key: string | null; type: 'bilde' | 'pdf' | null; malestokk: { a: Pt; b: Pt; meter: number } | null }
  /** Det man må vite om kunden før man velger løsning. */
  kunde: string
  punkter: Punkt[]
  rom: Rom[]
  farer: Fare[]
  sja: Sja
  kompetanse: Kompetanse[]
  kurser: Kurs[]
  foringer: Foring[]
  /** Katalogforslag installatøren har sagt ikke gjelder denne jobben — vises ikke igjen. */
  avvist: string[]
}

export function tomProsjektering(): Prosjektering {
  return {
    v: 1,
    plan: { key: null, type: null, malestokk: null },
    kunde: '',
    punkter: [],
    rom: [],
    farer: [],
    sja: { arbeidsmoment: '', deltakere: '', steg: [], konklusjon: '' },
    kompetanse: [],
    kurser: [],
    foringer: [],
    avvist: [],
  }
}

/** Leser et lagret dokument og fyller inn det som mangler, så eldre rader aldri knekker visningen. */
export function lesProsjektering(raw: unknown): Prosjektering {
  const t = tomProsjektering()
  if (!raw || typeof raw !== 'object') return t
  const r = raw as Partial<Prosjektering>
  return {
    v: 1,
    plan: { ...t.plan, ...(r.plan ?? {}) },
    kunde: typeof r.kunde === 'string' ? r.kunde : '',
    punkter: Array.isArray(r.punkter) ? r.punkter : [],
    rom: Array.isArray(r.rom) ? r.rom.map(x => ({ ...{ bruk: '', brukere: '', pavirkninger: [], notat: '' }, ...x })) : [],
    farer: Array.isArray(r.farer) ? r.farer : [],
    sja: { ...t.sja, ...(r.sja ?? {}), steg: Array.isArray(r.sja?.steg) ? r.sja!.steg : [] },
    kompetanse: Array.isArray(r.kompetanse) ? r.kompetanse : [],
    kurser: Array.isArray(r.kurser) ? r.kurser.map(k => ({ ...{ nr: '', navn: '', vern: '', rcd: '', kabel: '', forlegning: '', merknad: '' }, ...k })) : [],
    foringer: Array.isArray(r.foringer) ? r.foringer.filter(f => Array.isArray(f?.pts) && f.pts.length >= 2) : [],
    avvist: Array.isArray(r.avvist) ? r.avvist.filter((x): x is string => typeof x === 'string') : [],
  }
}

// ── Målestokk og areal ──────────────────────────────────────────────────────

/**
 * Meter per normalisert enhet langs hver akse. Planen er sjelden kvadratisk, så x og y skaleres
 * hver for seg med sidens forhold (`aspekt` = bredde/høyde i piksler).
 */
export function meterPerEnhet(m: { a: Pt; b: Pt; meter: number } | null, aspekt: number): { x: number; y: number } | null {
  if (!m || !(m.meter > 0) || !(aspekt > 0)) return null
  // Avstanden målt i «x-enheter»: y-forskjellen gjøres om til samme lengde som x.
  const dx = m.b.x - m.a.x, dy = (m.b.y - m.a.y) / aspekt
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return null
  const x = m.meter / d
  return { x, y: x / aspekt }
}

export function areal(form: Boks, mpe: { x: number; y: number } | null): number | null {
  if (!mpe) return null
  return Math.abs(form.w * mpe.x * form.h * mpe.y)
}

/** Flaten til et polygon i normaliserte enheter (skolisseformelen). */
function polyFlate(pts: Pt[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y)
  return Math.abs(a / 2)
}

/** Gulvarealet: omrisset når rommet har ett, ellers boksen. */
export function romAreal(r: Pick<Rom, 'form' | 'polygon'>, mpe: { x: number; y: number } | null): number | null {
  if (!mpe) return null
  if (r.polygon && r.polygon.length >= 3) return polyFlate(r.polygon) * mpe.x * mpe.y
  return areal(r.form, mpe)
}

/** Omsluttende boks for et omriss. */
export function boksFor(pts: Pt[]): Boks {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// ── Ytre påvirkninger, NEK 400-5-51 ─────────────────────────────────────────

/**
 * De klassene som er aktuelle i en bolig. Koden er bokstavene + tallet; teksten er en kort
 * forklaring, ikke standardens ordlyd. Lista er bevisst kort — resten finnes i standarden.
 */
export const PAVIRKNINGER: { kode: string; tekst: string }[] = [
  { kode: 'AA5', tekst: 'Temperatur +5 til +40 °C (normal innendørs)' },
  { kode: 'AA4', tekst: 'Temperatur −5 til +40 °C (uoppvarmet)' },
  { kode: 'AB5', tekst: 'Normal luftfuktighet innendørs' },
  { kode: 'AD1', tekst: 'Vann: neglisjerbart' },
  { kode: 'AD2', tekst: 'Vann: fritt fallende dråper' },
  { kode: 'AD3', tekst: 'Vann: sprut (spray)' },
  { kode: 'AD4', tekst: 'Vann: skvett fra alle retninger' },
  { kode: 'AD5', tekst: 'Vann: stråler (spyling)' },
  { kode: 'AE1', tekst: 'Fremmedlegemer: neglisjerbart' },
  { kode: 'AE4', tekst: 'Støv: lett' },
  { kode: 'AF1', tekst: 'Korrosjon: neglisjerbar' },
  { kode: 'AF2', tekst: 'Korrosjon: atmosfærisk (salt, kystklima)' },
  { kode: 'AG1', tekst: 'Mekanisk støt: lavt' },
  { kode: 'AG2', tekst: 'Mekanisk støt: middels' },
  { kode: 'AN2', tekst: 'Solstråling: middels' },
  { kode: 'AQ2', tekst: 'Lyn: indirekte' },
  { kode: 'BA1', tekst: 'Personer: vanlige' },
  { kode: 'BA2', tekst: 'Personer: barn' },
  { kode: 'BA3', tekst: 'Personer: funksjonshemmede' },
  { kode: 'BE2', tekst: 'Brannfare: lagring av brennbare materialer' },
  { kode: 'CA2', tekst: 'Byggematerialer: brennbare (trehus)' },
]

export function pavirkningTekst(kode: string): string {
  return PAVIRKNINGER.find(p => p.kode === kode)?.tekst ?? kode
}

/**
 * Forslag ut fra romnavnet. Det er utgangspunktet installatøren retter, ikke en konklusjon:
 * badet får vann og del 7-701, garasjen støt og brannfare, osv. `nek` er delene av NEK 400
 * som typisk må vurderes i et slikt rom.
 */
export function forslagForRom(navn: string): { bruk: string; brukere: string; pavirkninger: string[]; nek: string[] } {
  const n = navn.toLowerCase()
  const har = (...ord: string[]) => ord.some(o => n.includes(o))
  if (har('bad', 'bath', 'dusj', 'vaskerom', 'wc')) return {
    bruk: 'Dusj og vask, høy luftfuktighet',
    brukere: 'Hele husstanden, også barn',
    pavirkninger: ['AA5', 'AD4', 'BA2'],
    nek: ['NEK 400-7-701 (soner, jordfeil 30 mA, tilleggsutjevning)', 'NEK 400-7-753 (varmekabel i gulv)'],
  }
  if (har('kjøkken', 'kitchen')) return {
    bruk: 'Matlaging, mange faste apparater',
    brukere: 'Hele husstanden, også barn',
    pavirkninger: ['AA5', 'AD2', 'BA2'],
    nek: ['Egen kurs til komfyr, komfyrvakt', 'Faste apparater (oppvask, kjøl) på egne kurser'],
  }
  if (har('garasje', 'garage', 'carport')) return {
    bruk: 'Parkering, verktøy, lagring, mulig elbillading',
    brukere: 'Voksne, barn kan være til stede',
    pavirkninger: ['AA4', 'AD2', 'AE4', 'AG2', 'BE2'],
    nek: ['NEK 400-7-722 (elbillading)', 'IP og mekanisk beskyttelse på utstyr'],
  }
  if (har('stue', 'living')) return {
    bruk: 'Opphold, TV og underholdning',
    brukere: 'Hele husstanden, også barn',
    pavirkninger: ['AA5', 'AD1', 'BA2'],
    nek: ['Antall stikkontakter og plassering', 'Brannvarsling'],
  }
  if (har('sov', 'bedroom', 'barnerom')) return {
    bruk: 'Søvn',
    brukere: 'Voksne og barn',
    pavirkninger: ['AA5', 'AD1', 'BA2'],
    nek: ['Brannvarsling (røykvarsler)', 'Rømningsvei'],
  }
  if (har('bod', 'storage', 'lager')) return {
    bruk: 'Lagring',
    brukere: 'Voksne',
    pavirkninger: ['AA4', 'AD1', 'BE2'],
    nek: ['Brannfare ved lagring av brennbart'],
  }
  if (har('ute', 'terrasse', 'veranda', 'fasade', 'utvendig')) return {
    bruk: 'Utendørs',
    brukere: 'Alle',
    pavirkninger: ['AD4', 'AF2', 'AN2', 'AQ2'],
    nek: ['IP-grad utendørs, kystklima', 'Jordfeilvern på uttak ute'],
  }
  return { bruk: '', brukere: '', pavirkninger: ['AA5', 'AD1', 'BA1'], nek: [] }
}

// ── Risikomatrise ───────────────────────────────────────────────────────────

export type Niva = 'lav' | 'middels' | 'hoy'

/** Risikotall = S × K på en 5 × 5-matrise. Grensene er firmaets akseptkriterier. */
export const GRENSER = { middelsFra: 5, hoyFra: 12 }

export function risikotall(s: number, k: number): number {
  const c = (v: number) => Math.min(5, Math.max(1, Math.round(v || 1)))
  return c(s) * c(k)
}

export function niva(s: number, k: number): Niva {
  const r = risikotall(s, k)
  return r >= GRENSER.hoyFra ? 'hoy' : r >= GRENSER.middelsFra ? 'middels' : 'lav'
}

/** Farer per celle i matrisen, før eller etter tiltak. Nøkkel «s,k». */
export function matrise(farer: Fare[], etter: boolean): Map<string, Fare[]> {
  const m = new Map<string, Fare[]>()
  for (const f of farer) {
    const s = etter ? f.restS : f.s, k = etter ? f.restK : f.k
    const n = `${Math.min(5, Math.max(1, Math.round(s || 1)))},${Math.min(5, Math.max(1, Math.round(k || 1)))}`
    m.set(n, [...(m.get(n) ?? []), f])
  }
  return m
}

/** Det som må på plass før dokumentet er ferdig — det oppgaven og et tilsyn spør etter. */
export function mangler(p: Prosjektering): string[] {
  const ut: string[] = []
  if (!p.plan.key) ut.push('Planen er ikke lagt inn')
  if (!p.kunde.trim()) ut.push('Hva du må vite om kunden er ikke skrevet')
  if (p.rom.length === 0) ut.push('Ingen rom')
  for (const r of p.rom) {
    if (!r.bruk.trim() || !r.brukere.trim()) ut.push(`${r.navn || 'Et rom'}: bruk og brukere mangler`)
  }
  if (p.farer.length < 5) ut.push(`Risikomatrisen har ${p.farer.length} av minst 5 farer`)
  for (const f of p.farer) {
    if (!f.tiltak.trim()) ut.push(`«${f.tittel || 'En fare'}» har ingen tiltak`)
    else if (risikotall(f.restS, f.restK) > risikotall(f.s, f.k)) ut.push(`«${f.tittel}»: restrisikoen er høyere enn før tiltak`)
  }
  if (!p.farer.some(f => f.gjelder === 'anlegg' && f.x != null)) ut.push('Ingen fare for anlegget er pekt ut på planen')
  if (!p.farer.some(f => f.gjelder === 'montor' && f.x != null)) ut.push('Ingen fare for montøren er pekt ut på planen')
  if (!p.sja.arbeidsmoment.trim() || p.sja.steg.length === 0) ut.push('SJA-en mangler arbeidsmoment eller steg')
  if (p.kompetanse.length === 0) ut.push('Kompetanse er ikke fylt ut')
  return ut
}

function inni(p: Pt, poly: Pt[]): boolean {
  let inn = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inn = !inn
  }
  return inn
}

/** Hvilket rom et punkt ligger i (minste rom som inneholder punktet, så en bod inne i en garasje vinner). */
export function romFor(p: Pt, rom: Rom[]): Rom | null {
  let best: Rom | null = null, bestFlate = Infinity
  for (const r of rom) {
    const f = r.form
    if (!(p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h)) continue
    const poly = r.polygon && r.polygon.length >= 3 ? r.polygon : null
    if (poly && !inni(p, poly)) continue
    const flate = poly ? polyFlate(poly) : f.w * f.h
    if (flate < bestFlate) { best = r; bestFlate = flate }
  }
  return best
}

/** Antall punkter per type per rom — tabellen i rom-for-rom og grunnlaget for materiellet senere. */
export function punkterPerRom(p: Prosjektering): Map<string, Map<string, number>> {
  const ut = new Map<string, Map<string, number>>()
  for (const pt of p.punkter) {
    const r = romFor(pt, p.rom)?.id ?? ''
    const m = ut.get(r) ?? new Map<string, number>()
    m.set(pt.type, (m.get(pt.type) ?? 0) + 1)
    ut.set(r, m)
  }
  return ut
}

// ── Installasjonstegningen: kurser, føringsveier, høyder ────────────────────

/**
 * Vanlige monteringshøyder i cm over ferdig gulv — et UTGANGSPUNKT, ikke et krav. Brytere og
 * termostater på 80–120 cm er det TEK17 § 12-18 peker på for tilgjengelighet (slå opp); stikk og resten
 * er vanlig praksis som avtales med kunden. null = ingen standard (tak, gulv, etter produsent).
 */
export const STANDARD_HOYDE: Record<string, number> = {
  'stikk': 30, 'stikk-jord': 30, 'data': 30, 'bryter': 110, 'dimmer': 110, 'termostat': 110,
  'fordeling': 150, 'elbillader': 120, 'utelys': 200,
}
export function standardHoyde(type: string): number | null {
  return STANDARD_HOYDE[type] ?? null
}
export function hoydeFor(p: Punkt): number | null {
  return p.hoyde ?? standardHoyde(p.type)
}

/** Lengden av en føringsvei i meter, eller null uten målestokk. */
export function foringLengde(f: Foring, mpe: { x: number; y: number } | null): number | null {
  if (!mpe) return null
  let m = 0
  for (let i = 1; i < f.pts.length; i++) {
    m += Math.hypot((f.pts[i].x - f.pts[i - 1].x) * mpe.x, (f.pts[i].y - f.pts[i - 1].y) * mpe.y)
  }
  return m
}

/** Neste ledige kursnummer: ett mer enn det høyeste tallet som er brukt. */
export function nesteKursNr(kurser: Kurs[]): string {
  const tall = kurser.map(k => parseInt(k.nr, 10)).filter(n => Number.isFinite(n))
  return String(tall.length ? Math.max(...tall) + 1 : 1)
}

/** Fargen kursen tegnes med — fast per plass i lista, så den ikke hopper når man skriver. */
// Dempet og teknisk (30.10): rust, skifer, mose, plomme, oker, petrol … — skilles fra hverandre
// og fra utvalgsblått, uten å skrike. Ren blå er reservert for utvalget.
export const KURSFARGER = ['#B0532E', '#4A6680', '#557A46', '#7B5B8C', '#A3842E', '#2F7470', '#94485E', '#5E6670', '#86613F', '#6E7A2E']
export function kursFarge(p: Prosjektering, kursId: string | undefined): string {
  const i = kursId ? p.kurser.findIndex(k => k.id === kursId) : -1
  return i < 0 ? '#1D1D1F' : KURSFARGER[i % KURSFARGER.length]
}

export type Kursrad = {
  kurs: Kurs
  /** Antall punkter per type, i fast rekkefølge (flest først). */
  punkter: [string, number][]
  rom: string[]
  /** Målt langs føringsveiene på planen. null uten målestokk eller uten føringer. */
  lengde: number | null
}

/**
 * Kursfortegnelsen, generert fra tegningen: hva hver kurs forsyner, i hvilke rom, og hvor lang
 * føringen er målt på planen. Sortert på kursnummer (tall før tekst).
 */
export function kursfortegnelse(p: Prosjektering, aspekt: number | null): Kursrad[] {
  const mpe = aspekt ? meterPerEnhet(p.plan.malestokk, aspekt) : null
  const sortert = [...p.kurser].sort((a, b) => {
    const x = parseInt(a.nr, 10), y = parseInt(b.nr, 10)
    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y
    return a.nr.localeCompare(b.nr, 'nb')
  })
  return sortert.map(kurs => {
    const pt = p.punkter.filter(x => x.kursId === kurs.id)
    const tell = new Map<string, number>()
    for (const x of pt) tell.set(x.type, (tell.get(x.type) ?? 0) + 1)
    const rom = [...new Set(pt.map(x => romFor(x, p.rom)?.navn).filter((n): n is string => !!n))]
    const f = p.foringer.filter(x => x.kursId === kurs.id)
    const lengde = mpe && f.length ? f.reduce((s, x) => s + (foringLengde(x, mpe) ?? 0), 0) : null
    return { kurs, punkter: [...tell].sort((a, b) => b[1] - a[1]), rom, lengde }
  })
}
