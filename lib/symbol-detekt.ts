/**
 * Symboler fra symbolforklaringen, funnet igjen på tegningen.
 *
 * Idéen (2026-09-13, Tormod: «lag algo for hver detektor basert på ikon-
 * beskrivelsene på høyre siden»): tegningen forklarer selv hva symbolene
 * betyr. Ved siden av hver etikett i SYMBOLFORKLARING står symbolet tegnet
 * én gang. Vi leser det som en MAL (et sett streker) og glir malen over
 * planen. Der malens streker ligger oppå tegningens streker, står symbolet.
 *
 * Målt på en Norconsult-brannplan (1:50, 19 000 streker): 43 av 43
 * komponenter funnet, riktig type, null falske. Det som måtte til, og hvorfor:
 *
 *  - Skala per symbol. Symbolene i planen er ikke alltid samme størrelse som i
 *    forklaringen (manuell melder var 9 mot 14 pt). Malen prøves derfor i
 *    flere skalaer, med begrenset anisotropi (0,7–1,43) — uten grensen lot en
 *    kvadratisk sløyfeenhet seg klemme til en høy detektor og vant.
 *  - Rotasjon bare for små maler (≤ 16 streker). Sirenen står rotert i planen;
 *    detektorer med bokstaver gjør det aldri.
 *  - Tykke streker (kabler, > 1,5 pt) tas ut før alt annet. De går tvers
 *    gjennom symbolene og ødela dekningen.
 *  - Dekning måles på streker som ligger HELT i malens boks. En henvisningslinje
 *    som krysser inn og ut er fremmed og teller ikke.
 *  - Bokstavene i symbolene er så små (3 pt) at avstandsmål alene ikke skiller
 *    «MK» fra «I/O». Derfor teller dekningen begge veier, og ved samme sted
 *    vinner malen med best samlet score, ikke den største.
 *  - Tilleggssymboler (blink, summer) er for små til fri glidning — de traff
 *    «!» i hver detektor. De søkes bare i stripa rett under en funnet detektor.
 *  - Symboler som er tekst (ASD i en boks) finnes som tekst, ikke geometri.
 *
 * Alt her er rent: ingen PDF, ingen React. Selvtest: npm run verify:symbol-detekt.
 */

export type Strek = { x0: number; y0: number; x1: number; y1: number; bredde?: number; fyll?: boolean; farge?: number; lys?: number }
export type Tekst = { tekst: string; x: number; y: number; hoyde: number }
export type Mal = {
  navn: string
  seg: Strek[]
  boks: Boks
  /** Ord som står inni symbolet (f.eks. «ASD») — da finnes symbolet som tekst. */
  tekst: string[]
  /** Små glyfer (< 8 pt) er tillegg til en detektor, ikke egne symboler. */
  tillegg: boolean
}
export type Symbolfunn = {
  type: string
  x: number; y: number; w: number; h: number
  rot: number; sx: number; sy: number
  /** Lavere er bedre: snittavstand + (1 − dekning). 0 = identisk kopi. */
  score: number
  /** Tilleggssymbol funnet under detektoren (f.eks. «Detektor med summer»). */
  tillegg?: string
}
export type Boks = { x0: number; y0: number; x1: number; y1: number }

const L = (s: Strek) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0)
const retning = (s: Strek) => ((Math.atan2(s.y1 - s.y0, s.x1 - s.x0) * 180) / Math.PI + 180) % 180
const erHoris = (s: Strek) => { const r = retning(s); return r < 4 || r > 176 }
const erVerti = (s: Strek) => Math.abs(retning(s) - 90) < 4

export function boksAv(ss: Strek[]): Boks {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of ss) {
    x0 = Math.min(x0, s.x0, s.x1); x1 = Math.max(x1, s.x0, s.x1)
    y0 = Math.min(y0, s.y0, s.y1); y1 = Math.max(y1, s.y0, s.y1)
  }
  return { x0, y0, x1, y1 }
}

/** Tekstens boks. pdf.js gir ikke bredde; 0,6 × høyde per tegn er nær nok for Helvetica. */
function tekstBoks(t: Tekst): Boks {
  const b = t.hoyde * 0.6 * t.tekst.length
  return { x0: t.x, y0: t.y - t.hoyde, x1: t.x + b, y1: t.y }
}
const inni = (b: Boks, ytre: Boks, slakk = 1) =>
  b.x0 >= ytre.x0 - slakk && b.x1 <= ytre.x1 + slakk && b.y0 >= ytre.y0 - slakk && b.y1 <= ytre.y1 + slakk

/** Sammenhengende klynger: streker med endepunkt innen `slakk` pt av hverandre. */
export function klyng(ss: Strek[], slakk = 3.5): Strek[][] {
  const cell = 3
  const idx = new Map<number, number[]>()
  const nk = (x: number, y: number) => nokkel(Math.floor(x / cell), Math.floor(y / cell))
  ss.forEach((s, i) => {
    for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y1]]) {
      const k = nk(x, y); const a = idx.get(k); if (a) a.push(i); else idx.set(k, [i])
    }
  })
  const parent = ss.map((_, i) => i)
  const find = (a: number) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  const naer = (a: Strek, b: Strek) => {
    let m = Infinity
    for (const [px, py] of [[a.x0, a.y0], [a.x1, a.y1]]) for (const [qx, qy] of [[b.x0, b.y0], [b.x1, b.y1]]) m = Math.min(m, Math.hypot(px - qx, py - qy))
    return m
  }
  for (const [k, ids] of idx) {
    const cx = Math.floor(k / NK) - (NK >> 1), cy = (k % NK) - (NK >> 1)
    const rundt = new Set<number>()
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of idx.get(nokkel(cx + dx, cy + dy)) ?? []) rundt.add(j)
    for (const i of ids) for (const j of rundt) {
      if (j <= i) continue
      if (naer(ss[i], ss[j]) <= slakk) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj }
    }
  }
  const ut = new Map<number, Strek[]>()
  ss.forEach((s, i) => { const r = find(i); const a = ut.get(r); if (a) a.push(s); else ut.set(r, [s]) })
  return [...ut.values()]
}

/** Tekstlinjer: ord på samme grunnlinje med små mellomrom slås sammen til én etikett. */
function tekstlinjer(tekster: Tekst[]): { tekst: string; boks: Boks; hoyde: number }[] {
  const sortert = [...tekster].sort((a, b) => (Math.abs(a.y - b.y) < 3 ? a.x - b.x : a.y - b.y))
  const ut: { tekst: string; boks: Boks; hoyde: number }[] = []
  for (const t of sortert) {
    const b = tekstBoks(t)
    const sist = ut[ut.length - 1]
    if (sist && Math.abs(sist.boks.y1 - b.y1) < 3 && b.x0 - sist.boks.x1 < sist.hoyde * 1.5 && b.x0 >= sist.boks.x0) {
      sist.tekst += ' ' + t.tekst; sist.boks.x1 = Math.max(sist.boks.x1, b.x1); sist.boks.y0 = Math.min(sist.boks.y0, b.y0)
    } else ut.push({ tekst: t.tekst, boks: b, hoyde: t.hoyde })
  }
  return ut
}

/**
 * Leser symbolforklaringen: finner overskriften, og for hver tekstlinje under
 * den, symbolet tegnet rett til venstre. Returnerer malene og området
 * forklaringen dekker (så søket kan holde seg unna det).
 */
export function lesForklaring(streker: Strek[], tekster: Tekst[], valg: { overskrift?: RegExp; hoydePt?: number } = {}): { maler: Mal[]; omraade: Boks | null } {
  const re = valg.overskrift ?? /^SYMBOLFORKLARING|^TEGNFORKLARING|^SYMBOLER$/i
  const hode = tekster.find(t => re.test(t.tekst.trim()))
  if (!hode) return { maler: [], omraade: null }
  const hb = tekstBoks(hode)
  // Forklaringen strekker seg ned til neste overskrift i store bokstaver, ellers 350 pt.
  const nesteHode = tekster
    .filter(t => t.y > hb.y1 + 10 && /^[A-ZÆØÅ]{6,}$/.test(t.tekst.trim()) && Math.abs(t.hoyde - hode.hoyde) < hode.hoyde * 0.5)
    .sort((a, b) => a.y - b.y)[0]
  const omraade: Boks = {
    x0: hb.x0 - 25, y0: hb.y0 - 10,
    x1: Math.max(hb.x1, ...tekster.filter(t => t.y > hb.y0 && t.y < hb.y1 + 400).map(t => tekstBoks(t).x1)) + 10,
    y1: nesteHode ? tekstBoks(nesteHode).y0 - 5 : hb.y1 + 350,
  }
  const tynn = streker.filter(s => (s.bredde ?? 0) <= 1.5 && L(s) <= 45)
  const her = tynn.filter(s => inni(boksAv([s]), omraade, 10))
  const klynger = klyng(her).filter(k => k.length >= 2).map(k => ({ seg: k, boks: boksAv(k) }))
  const iOmraadet = tekster.filter(t => t !== hode && inni(tekstBoks(t), omraade, 2))
  // Ord som står inni et symbol (ASD) er symbolets tekst, ikke en etikett.
  // Ordboksen fra PDF-leseren har luft over og under (asc/desc); slakk etter tekstens høyde.
  const iSymbol = new Set(iOmraadet.filter(t => klynger.some(k => inni(tekstBoks(t), k.boks, Math.max(2, t.hoyde * 0.4)))))
  const linjer = tekstlinjer(iOmraadet.filter(t => !iSymbol.has(t)))
  const maler: Mal[] = []
  const brukt = new Set<string>()
  for (const linje of linjer) {
    const ym = (linje.boks.y0 + linje.boks.y1) / 2
    const deler = klynger.filter(k => k.boks.x1 <= linje.boks.x0 - 2 && k.boks.x1 >= linje.boks.x0 - 50 && Math.abs((k.boks.y0 + k.boks.y1) / 2 - ym) < 9)
    if (!deler.length || brukt.has(linje.tekst)) continue
    const seg = deler.flatMap(d => d.seg)
    const boks = boksAv(seg)
    const tekst = [...iSymbol].filter(t => inni(tekstBoks(t), boks, Math.max(2, t.hoyde * 0.4))).map(t => t.tekst).sort()
    const side = Math.max(boks.x1 - boks.x0, boks.y1 - boks.y0)
    if (seg.length <= 4 && !tekst.length && finnRektangler(seg).length) continue // en bar boks uten tekst kan ikke skilles fra andre bokser
    maler.push({ navn: linje.tekst, seg, boks, tekst, tillegg: side < 8 })
    brukt.add(linje.tekst)
  }
  return { maler, omraade }
}

// ── Punktsky med rutenett for nærmeste-avstand (trunkert ved TAK) ──
// Talnøkler, ikke strenger: `${x},${y}` per oppslag var det dyreste i Hermes.
const CELL = 1, TAK = 2, NK = 1 << 20
const nokkel = (cx: number, cy: number) => (cx + (NK >> 1)) * NK + (cy + (NK >> 1))
type Rute = Map<number, number[]> // nøkkel → [x,y,x,y,…]
function punkter(ss: Strek[], steg = 0.4): number[] {
  const ut: number[] = []
  for (const s of ss) {
    const n = Math.max(1, Math.floor(L(s) / steg))
    for (let i = 0; i <= n; i++) { const t = i / n; ut.push(s.x0 + (s.x1 - s.x0) * t, s.y0 + (s.y1 - s.y0) * t) }
  }
  return ut
}
function rutenett(pts: number[]): Rute {
  const g: Rute = new Map()
  for (let i = 0; i < pts.length; i += 2) {
    const k = nokkel(Math.floor(pts[i] / CELL), Math.floor(pts[i + 1] / CELL))
    const a = g.get(k); if (a) a.push(pts[i], pts[i + 1]); else g.set(k, [pts[i], pts[i + 1]])
  }
  return g
}
function naermeste(x: number, y: number, g: Rute): number {
  const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL)
  let best = TAK * TAK
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
    const a = g.get(nokkel(gx + dx, gy + dy)); if (!a) continue
    for (let i = 0; i < a.length; i += 2) { const d = (a[i] - x) ** 2 + (a[i + 1] - y) ** 2; if (d < best) best = d }
  }
  return Math.sqrt(best)
}
/**
 * Avstandsfelt for PLANEN: avstand til nærmeste planpunkt, forhåndsberegnet i
 * 0,5 pt-celler og lagret som Uint8 (0,025 pt per trinn, tak 2 pt). Ett oppslag
 * er én indeksering — Map-rutenettet over kostet 60–120 s på Hermes (ingen JIT)
 * for én A0-plan, dette tar under sekundet å bygge og gjør søket raskt på telefon.
 */
class Avstandsfelt {
  private readonly felt: Uint8Array
  private readonly x0: number; private readonly y0: number
  private readonly bredde: number; private readonly hoyde: number
  static readonly CELLE = 0.5
  static readonly TRINN = 0.025
  constructor(pts: number[], boks: Boks) {
    const c = Avstandsfelt.CELLE
    this.x0 = Math.floor(boks.x0 / c) * c - TAK - c; this.y0 = Math.floor(boks.y0 / c) * c - TAK - c
    this.bredde = Math.ceil((boks.x1 - this.x0 + TAK + c) / c) + 1
    this.hoyde = Math.ceil((boks.y1 - this.y0 + TAK + c) / c) + 1
    const maks = Math.round(TAK / Avstandsfelt.TRINN)
    this.felt = new Uint8Array(this.bredde * this.hoyde).fill(maks)
    const R = Math.ceil(TAK / c)
    const felt = this.felt, W = this.bredde
    for (let i = 0; i < pts.length; i += 2) {
      const px = pts[i], py = pts[i + 1]
      const cx = Math.round((px - this.x0) / c), cy = Math.round((py - this.y0) / c)
      for (let dy = -R; dy <= R; dy++) {
        const yy = cy + dy; if (yy < 0 || yy >= this.hoyde) continue
        const my = this.y0 + yy * c - py
        for (let dx = -R; dx <= R; dx++) {
          const xx = cx + dx; if (xx < 0 || xx >= W) continue
          const mx = this.x0 + xx * c - px
          const q = Math.round(Math.sqrt(mx * mx + my * my) / Avstandsfelt.TRINN)
          const k = yy * W + xx
          if (q < felt[k]) felt[k] = q
        }
      }
    }
  }
  /** Avstand (pt) til nærmeste planpunkt, trunkert ved TAK. */
  naer(x: number, y: number): number {
    const c = Avstandsfelt.CELLE
    const xx = Math.round((x - this.x0) / c), yy = Math.round((y - this.y0) / c)
    if (xx < 0 || yy < 0 || xx >= this.bredde || yy >= this.hoyde) return TAK
    return this.felt[yy * this.bredde + xx] * Avstandsfelt.TRINN
  }
}

/** Grovt telle-rutenett (4 pt): hvor mange planpunkter ligger i en boks? Brukes til å avvise hypoteser før avstandsmålingen. */
const GROV = 4
function telleRutenett(pts: number[]): Map<number, number> {
  const g = new Map<number, number>()
  for (let i = 0; i < pts.length; i += 2) {
    const k = nokkel(Math.floor(pts[i] / GROV), Math.floor(pts[i + 1] / GROV))
    g.set(k, (g.get(k) ?? 0) + 1)
  }
  return g
}
function tellIBoks(g: Map<number, number>, b: Boks): number {
  let n = 0
  for (let cx = Math.floor(b.x0 / GROV); cx <= Math.floor(b.x1 / GROV); cx++)
    for (let cy = Math.floor(b.y0 / GROV); cy <= Math.floor(b.y1 / GROV); cy++) n += g.get(nokkel(cx, cy)) ?? 0
  return n
}

function roter(ss: Strek[], k: number): Strek[] {
  return ss.map(s => {
    let { x0, y0, x1, y1 } = s
    for (let i = 0; i < k; i++) { [x0, y0, x1, y1] = [-y0, x0, -y1, x1] }
    return { x0, y0, x1, y1 }
  })
}
function tilOrigo(ss: Strek[]): Strek[] {
  const b = boksAv(ss)
  return ss.map(s => ({ x0: s.x0 - b.x0, y0: s.y0 - b.y0, x1: s.x1 - b.x0, y1: s.y1 - b.y0 }))
}

/** Akseparallelle rektangler bygd av fire streker (symbolboksene). */
export function finnRektangler(ss: Strek[]): Boks[] {
  const h = ss.filter(s => erHoris(s) && L(s) >= 2), v = ss.filter(s => erVerti(s) && L(s) >= 2)
  const vIdx = new Map<number, Strek[]>()
  for (const s of v) { const k = Math.round(s.x0 * 2); const a = vIdx.get(k); if (a) a.push(s); else vIdx.set(k, [s]) }
  const hIdx = new Map<string, Strek[]>()
  for (const s of h) {
    const k = `${Math.round(Math.min(s.x0, s.x1) * 2)},${Math.round(Math.max(s.x0, s.x1) * 2)}`
    const a = hIdx.get(k); if (a) a.push(s); else hIdx.set(k, [s])
  }
  const ut: Boks[] = []
  const sett = new Set<string>()
  const dekker = (x: number, y0: number, y1: number) => {
    for (let k = Math.round(x * 2) - 1; k <= Math.round(x * 2) + 1; k++) {
      for (const s of vIdx.get(k) ?? []) {
        if (Math.min(s.y0, s.y1) <= y0 + 0.8 && Math.max(s.y0, s.y1) >= y1 - 0.8) return true
      }
    }
    return false
  }
  for (const [, gruppe] of hIdx) {
    if (gruppe.length < 2) continue
    for (let i = 0; i < gruppe.length; i++) for (let j = i + 1; j < gruppe.length; j++) {
      const a = gruppe[i], b = gruppe[j]
      const y0 = Math.min(a.y0, b.y0), y1 = Math.max(a.y0, b.y0)
      if (y1 - y0 < 2) continue
      const x0 = Math.min(a.x0, a.x1), x1 = Math.max(a.x0, a.x1)
      if (dekker(x0, y0, y1) && dekker(x1, y0, y1)) {
        const nk = `${Math.round(x0)},${Math.round(y0)},${Math.round(x1)},${Math.round(y1)}`
        if (!sett.has(nk)) { sett.add(nk); ut.push({ x0, y0, x1, y1 }) }
      }
    }
  }
  return ut
}

const SKALAER = [0.55, 0.65, 0.75, 0.85, 0.95, 1, 1.1, 1.2]
const anisotropiOk = (sx: number, sy: number) => sx / sy >= 0.7 && sx / sy <= 1.43

export type Sokevalg = {
  /** Området å holde seg unna (forklaringen selv). */
  utelat?: Boks | null
  /** Snittavstand mal→plan (pt). */
  maksSnitt?: number
  maksP90?: number
  /** Andel av planens punkter i boksen som må ligge på malen. */
  minDekning?: number
}

type Hyp = { dx: number; dy: number; sx: number; sy: number }

/**
 * Finner alle forekomster av malene i planen. Koordinater i samme enhet som
 * strekene (pt). Se toppen av fila for hva som måtte til.
 */
/** Synkront (selvtesten, Node). På telefonen: `finnSymbolerAsync`, som gir fra seg tråden underveis. */
export function finnSymboler(maler: Mal[], streker: Strek[], tekster: Tekst[], valg: Sokevalg = {}): Symbolfunn[] {
  const g = finnSymbolerSteg(maler, streker, tekster, valg)
  for (;;) { const r = g.next(); if (r.done) return r.value }
}

/**
 * Samme søk, men JS-tråden slippes hvert par hundre hypoteser. Søket tar
 * titalls sekunder på Hermes (ingen JIT); uten dette står appen død imens.
 */
export async function finnSymbolerAsync(maler: Mal[], streker: Strek[], tekster: Tekst[], valg: Sokevalg = {}, onFremdrift?: (andel: number) => void): Promise<Symbolfunn[]> {
  const g = finnSymbolerSteg(maler, streker, tekster, valg)
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
    onFremdrift?.(r.value)
    await new Promise<void>(res => setTimeout(res, 0))
  }
}

/** Kjernen: `yield` = andel ferdig (0..1), retur = funnene. */
function* finnSymbolerSteg(maler: Mal[], streker: Strek[], tekster: Tekst[], valg: Sokevalg = {}): Generator<number, Symbolfunn[], void> {
  const maksSnitt = valg.maksSnitt ?? 0.35, maksP90 = valg.maksP90 ?? 0.9, minDek = valg.minDekning ?? 0.75
  const utelat = valg.utelat ?? null
  const plan = streker.filter(s => (s.bredde ?? 0) <= 1.5 && L(s) <= 45 && !(utelat && inni(boksAv([s]), utelat, 10)))
  // Strekindeks på midtpunkt (8 pt-ruter) for dekning
  const PC = 8
  const sIdx = new Map<number, Strek[]>()
  for (const s of plan) {
    const k = nokkel(Math.floor((s.x0 + s.x1) / 2 / PC), Math.floor((s.y0 + s.y1) / 2 / PC))
    const a = sIdx.get(k); if (a) a.push(s); else sIdx.set(k, [s])
  }
  const strekerI = (b: Boks) => {
    const ut: Strek[] = []
    for (let cx = Math.floor(b.x0 / PC) - 1; cx <= Math.floor(b.x1 / PC) + 1; cx++)
      for (let cy = Math.floor(b.y0 / PC) - 1; cy <= Math.floor(b.y1 / PC) + 1; cy++) for (const s of sIdx.get(nokkel(cx, cy)) ?? []) ut.push(s)
    return ut
  }
  const planPts = punkter(plan)
  const G = new Avstandsfelt(planPts, plan.length ? boksAv(plan) : { x0: 0, y0: 0, x1: 1, y1: 1 })
  const grov = telleRutenett(planPts)
  // Bare bokser med noe INNI er symbolkandidater; tomme bygningsrektangler koster bare tid.
  const rektangler = finnRektangler(plan).filter(r => {
    let n = 0
    for (const s of strekerI(r)) if (s.x0 >= r.x0 + 0.3 && s.x1 >= r.x0 + 0.3 && s.x0 <= r.x1 - 0.3 && s.x1 <= r.x1 - 0.3 && s.y0 >= r.y0 + 0.3 && s.y1 >= r.y0 + 0.3 && s.y0 <= r.y1 - 0.3 && s.y1 <= r.y1 - 0.3) n++
    return n >= 4
  })
  const horis = plan.filter(s => erHoris(s) && L(s) >= 2), verti = plan.filter(s => erVerti(s) && L(s) >= 2)

  /** Dekning: planens streker som ligger HELT i boksen, målt mot malen. */
  const dekning = (mg: Rute, mw: number, mh: number, h: Hyp): number => {
    const b: Boks = { x0: h.dx - 1, y0: h.dy - 1, x1: mw * h.sx + h.dx + 1, y1: mh * h.sy + h.dy + 1 }
    const innenfor = (x: number, y: number) => x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1
    const inne: Strek[] = []
    for (const s of strekerI(b)) if (innenfor(s.x0, s.y0) && innenfor(s.x1, s.y1)) inne.push(s)
    if (!inne.length) return 0
    const pts = punkter(inne)
    let n = 0
    for (let i = 0; i < pts.length; i += 2) if (naermeste((pts[i] - h.dx) / h.sx, (pts[i + 1] - h.dy) / h.sy, mg) < 0.7) n++
    return n / (pts.length / 2)
  }
  const proev = (mpts: number[], h: Hyp): { snitt: number; p90: number } => {
    const ds: number[] = []
    for (let i = 0; i < mpts.length; i += 2) ds.push(G.naer(mpts[i] * h.sx + h.dx, mpts[i + 1] * h.sy + h.dy))
    ds.sort((a, b) => a - b)
    return { snitt: ds.reduce((a, b) => a + b, 0) / ds.length, p90: ds[Math.floor(ds.length * 0.9)] }
  }

  const funn: Symbolfunn[] = []
  const hovedMaler = maler.filter(m => !m.tillegg)
  let malNr = 0
  for (const m of hovedMaler) {
    yield malNr / Math.max(1, hovedMaler.length)
    malNr++
    // Tekstsymbol (ASD i boks): finnes der ordet står.
    if (m.tekst.length) {
      for (const t of tekster) {
        if (!m.tekst.includes(t.tekst) || (utelat && inni(tekstBoks(t), utelat, 2))) continue
        const b = tekstBoks(t)
        funn.push({ type: m.navn, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w: b.x1 - b.x0 + 4, h: b.y1 - b.y0 + 2, rot: 0, sx: 1, sy: 1, score: 0 })
      }
      continue
    }
    const rots = m.seg.length <= 16 ? [0, 1, 2, 3] : [0]
    for (const k of rots) {
      const mss = tilOrigo(roter(m.seg, k)); const mb = boksAv(mss); const mw = mb.x1, mh = mb.y1
      const mpts = punkter(mss); const mg = rutenett(mpts)
      const prov: number[] = []; for (let i = 0; i < mpts.length; i += 2 * Math.max(1, Math.floor(mpts.length / 28))) prov.push(mpts[i], mpts[i + 1])
      const hyp = new Map<string, Hyp>()
      // Under 55 % av forklaringens størrelse er det ikke samme symbol (en logo i tittelfeltet traff på 48 %).
      const legg = (h: Hyp) => { if (anisotropiOk(h.sx, h.sy) && h.sx >= 0.55 && h.sy >= 0.55 && h.sx <= 1.35 && h.sy <= 1.35) hyp.set(`${Math.round(h.dx * 2)},${Math.round(h.dy * 2)},${h.sx.toFixed(2)},${h.sy.toFixed(2)}`, h) }
      // 1) Har malen en boks, gir hver boks i planen skala og plassering direkte.
      const malRekt = finnRektangler(mss).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0]
      if (malRekt) {
        const rw = malRekt.x1 - malRekt.x0, rh = malRekt.y1 - malRekt.y0
        for (const r of rektangler) {
          const sx0 = (r.x1 - r.x0) / rw, sy0 = (r.y1 - r.y0) / rh
          if (sx0 < 0.45 || sx0 > 1.35 || sy0 < 0.45 || sy0 > 1.35) continue
          // Det indre glyfet står ikke alltid i nøyaktig samme forhold til boksen som i forklaringen.
          for (const fx of [0.8, 0.9, 1, 1.1]) for (const fy of [0.8, 0.9, 1, 1.1]) {
            const sx = sx0 * fx, sy = sy0 * fy
            legg({ dx: (r.x0 + r.x1) / 2 - (malRekt.x0 + malRekt.x1) / 2 * sx, dy: (r.y0 + r.y1) / 2 - (malRekt.y0 + malRekt.y1) / 2 * sy, sx, sy })
          }
        }
      } else {
        // 2) Ellers: lengste vannrette/loddrette strek som anker, skala fra lista.
        const mh_ = mss.filter(s => erHoris(s) && L(s) >= 2).sort((a, b) => L(b) - L(a))[0]
        const mv_ = mss.filter(s => erVerti(s) && L(s) >= 2).sort((a, b) => L(b) - L(a))[0]
        if (mh_) {
          const ax = Math.min(mh_.x0, mh_.x1), ay = mh_.y0, la = L(mh_)
          for (const s of horis) {
            const sx = L(s) / la; if (sx < 0.45 || sx > 1.35) continue
            for (const sy of SKALAER) legg({ dx: Math.min(s.x0, s.x1) - ax * sx, dy: s.y0 - ay * sy, sx, sy })
          }
        }
        if (mv_) {
          const ax = mv_.x0, ay = Math.min(mv_.y0, mv_.y1), la = L(mv_)
          for (const s of verti) {
            const sy = L(s) / la; if (sy < 0.45 || sy > 1.35) continue
            for (const sx of SKALAER) legg({ dx: s.x0 - ax * sx, dy: Math.min(s.y0, s.y1) - ay * sy, sx, sy })
          }
        }
      }
      const beste: { score: number; h: Hyp }[] = []
      const mAntall = mpts.length / 2
      let teller = 0
      const hypAntall = hyp.size
      for (const h of hyp.values()) {
        if (++teller % 300 === 0) yield (malNr + teller / Math.max(1, hypAntall)) / Math.max(1, hovedMaler.length)
        // Grov telling først: boksen må inneholde omtrent like mange planpunkter som malen har.
        const n = tellIBoks(grov, { x0: h.dx - 2, y0: h.dy - 2, x1: mw * h.sx + h.dx + 2, y1: mh * h.sy + h.dy + 2 })
        if (n < mAntall * 0.5 * Math.min(h.sx, h.sy) || n > mAntall * 4) continue
        // Billig forhåndssjekk på et utvalg punkter
        let sum = 0; for (let i = 0; i < prov.length; i += 2) sum += G.naer(prov[i] * h.sx + h.dx, prov[i + 1] * h.sy + h.dy)
        if (sum / (prov.length / 2) > 0.7) continue
        const { snitt, p90 } = proev(mpts, h)
        if (snitt > maksSnitt + 0.07 || p90 > maksP90) continue
        const dek = dekning(mg, mw, mh, h)
        // To nivåer: vanlig treff, eller et nesten-treff med sterk dekning begge veier. Det
        // siste er den manuelle melderen: forklaringen tegner dobbel ring, planen ring med prikk
        // (dekning 0,995). En logo i tittelfeltet kom til 0,90 — derfor 0,95.
        const ok = (snitt <= maksSnitt && dek >= minDek) || (dek >= 0.95 && p90 <= 0.85)
        if (!ok) continue
        beste.push({ score: snitt + (1 - dek), h })
      }
      beste.sort((a, b) => a.score - b.score)
      const valgt: { score: number; h: Hyp }[] = []
      for (const b of beste) if (valgt.every(v => Math.hypot(b.h.dx - v.h.dx, b.h.dy - v.h.dy) > Math.min(mw * b.h.sx, mh * b.h.sy) * 0.5)) valgt.push(b)
      for (const { score, h } of valgt) {
        const w = mw * h.sx, hh = mh * h.sy
        funn.push({ type: m.navn, x: h.dx + w / 2, y: h.dy + hh / 2, w, h: hh, rot: k * 90, sx: h.sx, sy: h.sy, score })
      }
    }
  }
  // Konkurranse på samme sted: best score vinner (ikke størst mal — se toppen).
  funn.sort((a, b) => a.score - b.score)
  const ut: Symbolfunn[] = []
  for (const f of funn) {
    if (ut.every(g => Math.abs(f.x - g.x) >= (f.w + g.w) / 2 * 0.6 || Math.abs(f.y - g.y) >= (f.h + g.h) / 2 * 0.6)) ut.push(f)
  }
  // Tilleggssymboler: bare i stripa rett under hver detektor.
  const tillegg = maler.filter(m => m.tillegg)
  if (tillegg.length) {
    for (const g of ut) {
      if (!/detektor/i.test(g.type)) continue
      const strip: Boks = { x0: g.x - g.w / 2 - 1, y0: g.y + g.h / 2 - 1, x1: g.x + g.w / 2 + 1, y1: g.y + g.h / 2 + g.h * 0.4 }
      const inne = strekerI(strip).filter(s => s.x0 >= strip.x0 && s.x1 >= strip.x0 && s.x0 <= strip.x1 && s.x1 <= strip.x1 && s.y0 >= strip.y0 && s.y1 >= strip.y0 && s.y0 <= strip.y1 && s.y1 <= strip.y1)
      if (inne.length < 3) continue
      const ib = boksAv(inne)
      let best: { snitt: number; p90: number; navn: string } | null = null
      for (const m of tillegg) for (const k of [0, 1, 2, 3]) {
        const mss = tilOrigo(roter(m.seg, k)); const mb = boksAv(mss); const mpts = punkter(mss)
        for (const sx of SKALAER) for (const sy of SKALAER) {
          if (!anisotropiOk(sx, sy)) continue
          for (let ddx = -2; ddx <= 2; ddx++) for (let ddy = -2; ddy <= 2; ddy++) {
            const h: Hyp = { dx: (ib.x0 + ib.x1) / 2 - mb.x1 * sx / 2 + ddx, dy: (ib.y0 + ib.y1) / 2 - mb.y1 * sy / 2 + ddy, sx, sy }
            const r = proev(mpts, h)
            if (!best || r.snitt < best.snitt) best = { ...r, navn: m.navn }
          }
        }
      }
      if (best && best.snitt <= 0.4 && best.p90 <= 1.0) g.tillegg = best.navn
    }
  }
  return ut
}
