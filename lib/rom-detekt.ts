/**
 * Romdeling på raster.
 *
 * Idé: vegger i CAD-tegninger er nesten alltid tegnet som to parallelle
 * streker 10–45 cm fra hverandre. Alt annet (utstyr, akselinjer, skravur,
 * diagonaler, tekst, kanaler) er enkeltstreker. Vi finner strekparene, fyller
 * båndet mellom dem som massiv vegg i et 5 cm-raster, og deler friarealet
 * med flertrinns erosjon: hver gang et sammenhengende område deles i to når
 * vi eroderer litt mer, har vi funnet en døråpning. Til slutt får hvert
 * frø tilbake pikslene sine ved vannskille på avstandskartet.
 *
 * Etiketter (romnummer/-navn fra tekstlaget) er valgfrie, men gjør mye:
 * biter uten etikett slås inn i naboen bak tynnest skille (utstyr tegnet
 * med dobbeltstrek deler ellers rommet), og to etiketter i samme region
 * eroderes videre til de skiller lag (porter og doble dører).
 *
 * Veggpennen kalibreres selv: par må ha samme farge, og fargen med mest
 * bånd totalt er veggen (kanaler/føringsveier/utstyr har egen pen).
 *
 * Målt på Norconsult RIV plan 1:50 (Moskenes trafo, 9 rom, 39 k streker):
 * 9 av 9 rom innenfor ±15 % av påført m² (største avvik 103 wc 4,4→3,9),
 * ~0,45 s i Node. doerMaks må dekke doble dører (2,1 m her) — 2,4–3,2 m
 * ga samme resultat. Den gamle grafbaserte varianten (flater i strekgrafen)
 * fant 0–2 av 9 på samme tegning: dobbeltstrekvegger lekker gjennom
 * innsiden av veggen ved karmer og gjennomføringer.
 */

export type Punkt = { x: number; y: number }
export type Segment = { x0: number; y0: number; x1: number; y1: number; bredde?: number; lys?: number; farge?: number }
// lys = metning (0 = grå/svart), farge = gråtone 0–1 (0 = svart)
export type Rom = { polygon: Punkt[]; areal: number; senter: Punkt; etiketter: number[] }

export type Innstillinger = {
  ptPerM: number       // målestokk: pt per meter (1:50 → 56.69)
  oppløsning: number   // m per piksel
  veggMin: number      // m, minste avstand mellom strekpar
  veggMaks: number     // m, største
  veggOverlapp: number // m, hvor mye to streker må overlappe langs veggen
  minStrek: number     // m, korteste strek som kan være vegg
  doerMaks: number     // m, bredeste åpning som skal lukkes (mot utsiden: porter, doble dører)
  doerNormal: number   // m, bredeste åpning mellom to innerom som deler dem (bredere = samme rom)
  minAreal: number     // m²
  maksAreal: number    // m²
  minFrø: number       // m², minste erodert flate som regnes som eget rom
  minVeggKomp: number  // m, veggklatter med mindre utstrekning kastes (møbler, symboler)
  buktMaks: number     // m, bukter (senger, benker) smalere enn dette fylles inn
  buktAndel: number    // bukt må være under denne andelen av rommets spenn i retningen
}

export const STANDARD: Innstillinger = {
  ptPerM: 56.69, oppløsning: 0.05,
  veggMin: 0.12, veggMaks: 0.45, veggOverlapp: 0.2, minStrek: 0.15,
  doerMaks: 2.8, doerNormal: 2.0, minAreal: 1.0, maksAreal: 400, minFrø: 0.3, minVeggKomp: 1.0, buktMaks: 3.0, buktAndel: 0.35,
}

// ── 1. strekpar → vegger ────────────────────────────────────────────────────

type Vegg = { a: Punkt; b: Punkt; c: Punkt; d: Punkt; tykk: number; lengde: number; bredder: [number, number]; farge?: number } // fylt firkant

function finnVegger(segs: Segment[], inn: Innstillinger): Vegg[] {
  const p = inn.ptPerM
  const kand = segs
    .filter(s => !(s.lys != null && s.lys > 0.2))
    .map(s => {
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0, len = Math.hypot(dx, dy)
      const ux = dx / len, uy = dy / len
      // retning modulo π så motsatt tegnede streker havner i samme bøtte
      let v = Math.atan2(uy, ux); if (v < 0) v += Math.PI; if (v >= Math.PI - 1e-9) v = 0
      return { s, len, ux, uy, nx: -uy, ny: ux, v, c: -uy * s.x0 + ux * s.y0, t0: ux * s.x0 + uy * s.y0, t1: ux * s.x1 + uy * s.y1 }
    })
    .filter(k => k.len >= inn.minStrek * p)
  const bøtte = new Map<number, typeof kand>()
  const B = 2 * Math.PI / 180
  for (const k of kand) { const i = Math.floor(k.v / B); (bøtte.get(i) ?? bøtte.set(i, []).get(i)!).push(k) }
  const nB = Math.ceil(Math.PI / B)
  const vegger: Vegg[] = []
  const dMin = inn.veggMin * p, dMaks = inn.veggMaks * p, ovMin = inn.veggOverlapp * p

  for (const [i, liste] of bøtte) {
    for (const di of [0, 1]) {
      const andre = bøtte.get((i + di) % nB); if (!andre) continue
      for (const a of liste) for (const b of andre) {
        if (di === 0 && b === a) continue
        if (di === 0 && a.v > b.v) continue // hvert par én gang
        if (a.s.farge != null && b.s.farge != null && Math.abs(a.s.farge - b.s.farge) > 0.1) continue // vegg og utstyr har ulik pen
        // avstand på tvers, målt med a sin normal
        const d = Math.abs((b.s.x0 - a.s.x0) * a.nx + (b.s.y0 - a.s.y0) * a.ny)
        if (d < dMin || d > dMaks) continue
        // overlapp langs a
        const bt0 = a.ux * b.s.x0 + a.uy * b.s.y0, bt1 = a.ux * b.s.x1 + a.uy * b.s.y1
        const lo = Math.max(Math.min(a.t0, a.t1), Math.min(bt0, bt1)), hi = Math.min(Math.max(a.t0, a.t1), Math.max(bt0, bt1))
        if (hi - lo < ovMin) continue
        // firkanten mellom dem over overlappet
        const fortegn = Math.sign((b.s.x0 - a.s.x0) * a.nx + (b.s.y0 - a.s.y0) * a.ny)
        const px = a.s.x0 - a.ux * a.t0, py = a.s.y0 - a.uy * a.t0 // punkt på a-linja ved t=0
        const P = (t: number, n: number) => ({ x: px + a.ux * t + a.nx * n * fortegn, y: py + a.uy * t + a.ny * n * fortegn })
        vegger.push({ a: P(lo, 0), b: P(hi, 0), c: P(hi, d), d: P(lo, d), tykk: d / p, lengde: (hi - lo) / p, bredder: [a.s.bredde ?? 0, b.s.bredde ?? 0], farge: a.s.farge })
      }
    }
  }
  // Selvkalibrering: veggene er tegnet med én pen. Fargeklassen med mest
  // bånd totalt er veggfargen; par i andre farger er kanaler, føringsveier, utstyr.
  const perFarge = new Map<number, number>()
  for (const v of vegger) if (v.farge != null) { const k = Math.round(v.farge * 10); perFarge.set(k, (perFarge.get(k) ?? 0) + v.lengde) }
  if (perFarge.size > 1) {
    let best = -1, bestL = -1; for (const [k, L] of perFarge) if (L > bestL) { bestL = L; best = k }
    return vegger.filter(v => v.farge == null || Math.round(v.farge * 10) === best)
  }
  return vegger
}

// ── 2. raster ───────────────────────────────────────────────────────────────

export type Raster = { W: number; H: number; x0: number; y0: number; skala: number; vegg: Uint8Array }

function tegnFirkant(r: Raster, q: Punkt[]) {
  const pts = q.map(p => ({ x: (p.x - r.x0) * r.skala, y: (p.y - r.y0) * r.skala }))
  const ymin = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)))), ymax = Math.min(r.H - 1, Math.ceil(Math.max(...pts.map(p => p.y))))
  for (let y = ymin; y <= ymax; y++) {
    const cy = y + 0.5; const xs: number[] = []
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q2 = pts[(i + 1) % 4]
      if ((p.y <= cy) !== (q2.y <= cy)) xs.push(p.x + (cy - p.y) * (q2.x - p.x) / (q2.y - p.y))
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.floor(xs[i] - 0.5)), xb = Math.min(r.W - 1, Math.ceil(xs[i + 1] + 0.5))
      for (let x = xa; x <= xb; x++) r.vegg[y * r.W + x] = 1
    }
  }
}

// Felzenszwalb–Huttenlocher eksakt avstandstransform (kvadrert), i piksler.
function avstand(r: Raster): Float32Array {
  const { W, H, vegg } = r; const INF = 1e12
  const f = new Float64Array(Math.max(W, H)), d = new Float64Array(Math.max(W, H))
  const v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1)
  const g = new Float64Array(W * H)
  const edt1 = (n: number) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < n; q++) {
      let s: number
      for (;;) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]] }
  }
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = vegg[y * W + x] ? 0 : INF; edt1(H); for (let y = 0; y < H; y++) g[y * W + x] = d[y] }
  const ut = new Float32Array(W * H)
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; edt1(W); for (let x = 0; x < W; x++) ut[y * W + x] = Math.sqrt(d[x]) }
  return ut
}

/** Veggklatter som ikke henger sammen med noe stort (senger, benker, symboler) er ikke vegg. */
function kastSmåVegger(r: Raster, minSidePx: number) {
  const { W, H, vegg } = r
  const { lab, n } = komponenter(W, H, i => vegg[i] === 1)
  const x0 = new Int32Array(n + 1).fill(W), x1 = new Int32Array(n + 1), y0 = new Int32Array(n + 1).fill(H), y1 = new Int32Array(n + 1)
  for (let i = 0; i < W * H; i++) { const c = lab[i]; if (!c) continue; const x = i % W, y = (i / W) | 0
    if (x < x0[c]) x0[c] = x; if (x > x1[c]) x1[c] = x; if (y < y0[c]) y0[c] = y; if (y > y1[c]) y1[c] = y }
  for (let i = 0; i < W * H; i++) { const c = lab[i]; if (c && Math.max(x1[c] - x0[c], y1[c] - y0[c]) < minSidePx) vegg[i] = 0 }
}

// ── 3. erosjonstre ──────────────────────────────────────────────────────────

function komponenter(W: number, H: number, fri: (i: number) => boolean): { lab: Int32Array; n: number } {
  const lab = new Int32Array(W * H); let n = 0; const st = new Int32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if (lab[i] || !fri(i)) continue
    n++; let sp = 0; st[sp++] = i; lab[i] = n
    while (sp) {
      const j = st[--sp]; const x = j % W
      const nb = [j - W, j + W, x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1]
      for (const k of nb) if (k >= 0 && k < W * H && !lab[k] && fri(k)) { lab[k] = n; st[sp++] = k }
    }
  }
  return { lab, n }
}

type Node = { piksler: Int32Array; ute: boolean; aktiv: boolean }

/**
 * Lengste utstrekning av en pikselklump som forsvant i dette erosjonstrinnet
 * og som berører minst to av barna (= halsen mellom dem). Bare barn av
 * størrelse ≥ minFrø teller.
 */
function halsLengde(W: number, H: number, forrige: Int32Array, forelder: number, lab: Int32Array, barn: number[], minFrø: number): number {
  const store = new Set(barn.filter(c => { let n = 0; for (let i = 0; i < W * H && n < minFrø; i++) if (lab[i] === c) n++; return n >= minFrø }))
  const sett = new Uint8Array(W * H); let lengst = 0; const st: number[] = []
  for (let i0 = 0; i0 < W * H; i0++) {
    if (sett[i0] || forrige[i0] !== forelder || lab[i0]) continue
    st.push(i0); sett[i0] = 1; let x0 = W, x1 = 0, y0 = H, y1 = 0; const berørt = new Set<number>()
    while (st.length) {
      const j = st.pop()!; const x = j % W, y = (j / W) | 0
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
      for (const q of [j - W, j + W, x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1]) {
        if (q < 0 || q >= W * H) continue
        if (lab[q]) { if (store.has(lab[q])) berørt.add(lab[q]); continue }
        if (!sett[q] && forrige[q] === forelder) { sett[q] = 1; st.push(q) }
      }
    }
    if (berørt.size >= 2) lengst = Math.max(lengst, Math.max(x1 - x0, y1 - y0) + 1)
  }
  return lengst
}

function erosjonstre(r: Raster, dist: Float32Array, inn: Innstillinger): Node[] {
  const { W, H } = r
  const rMaks = Math.ceil(inn.doerMaks / 2 / inn.oppløsning)
  const minFrø = inn.minFrø / (inn.oppløsning * inn.oppløsning)
  const noder: Node[] = []
  let forrige: Int32Array | null = null, forrigeNode: number[] = [] // komponent-id → node-indeks
  const berører = (px: Int32Array) => { for (const i of px) { const x = i % W, y = (i / W) | 0; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return true } return false }
  for (let rr = 1; rr <= rMaks; rr++) {
    const { lab, n } = komponenter(W, H, i => dist[i] > rr)
    const px: number[][] = Array.from({ length: n + 1 }, () => [])
    for (let i = 0; i < W * H; i++) if (lab[i]) px[lab[i]].push(i)
    const nyNode: number[] = new Array(n + 1).fill(-1)
    if (!forrige) {
      for (let c = 1; c <= n; c++) { const p = Int32Array.from(px[c]); noder.push({ piksler: p, ute: berører(p), aktiv: true }); nyNode[c] = noder.length - 1 }
    } else {
      // barn per forelder
      const barn = new Map<number, number[]>()
      for (let c = 1; c <= n; c++) { const f = forrigeNode[forrige[px[c][0]]]; (barn.get(f) ?? barn.set(f, []).get(f)!).push(c) }
      for (const [f, cs] of barn) {
        const store = cs.filter(c => px[c].length >= minFrø)
        // Brede åpninger (bredere enn en vanlig dør) deler bare rom mot utsiden;
        // innendørs er det møbler eller en L-form, ikke en dør.
        const bred = rr * inn.oppløsning > inn.doerNormal / 2
        // Halsen som forsvant i dette trinnet: en dør er kort (veggtykkelsen),
        // en korridor som smalner er lang. Lang hals = ikke en dør.
        const langHals = store.length >= 2 && halsLengde(W, H, forrige, forrige[px[cs[0]][0]], lab, cs, minFrø) > inn.doerMaks / inn.oppløsning
        if (store.length >= 2 && (!bred || noder[f].ute) && !langHals) {
          noder[f].aktiv = false
          for (const c of cs) { const p = Int32Array.from(px[c]); noder.push({ piksler: p, ute: noder[f].ute && berører(p), aktiv: true }); nyNode[c] = noder.length - 1 }
        } else {
          for (const c of cs) nyNode[c] = f // forelderen lever videre (beholder fødselspikslene)
        }
      }
    }
    forrige = lab; forrigeNode = nyNode
  }
  return noder
}

// ── 4. vannskille ───────────────────────────────────────────────────────────

function tilordne(r: Raster, dist: Float32Array, frø: { piksler: Int32Array; id: number }[], tillatt?: (i: number) => boolean, lab: Int32Array = new Int32Array(r.W * r.H)): Int32Array {
  const { W, H } = r
  // bøttekø etter avstand (høyest først) — vokser fra midten av rommene utover
  let dMaks = 0; for (let i = 0; i < dist.length; i++) if (dist[i] > dMaks) dMaks = dist[i]
  dMaks = Math.min(dMaks, 400) // over 20 m fra nærmeste vegg er uinteressant
  const nBøtter = 1 + Math.ceil(dMaks * 4)
  const køer: number[][] = Array.from({ length: nBøtter }, () => [])
  const b = (i: number) => Math.min(nBøtter - 1, Math.round(Math.min(dist[i], dMaks) * 4))
  for (const f of frø) for (const i of f.piksler) { lab[i] = f.id; køer[b(i)].push(i) }
  for (let k = nBøtter - 1; k >= 0; k--) {
    const q = køer[k]
    for (let qi = 0; qi < q.length; qi++) {
      const j = q[qi]; const x = j % W
      const nb = [j - W, j + W, x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1]
      for (const m of nb) if (m >= 0 && m < W * H && !lab[m] && dist[m] > 0 && (!tillatt || tillatt(m))) {
        lab[m] = lab[j]; const bm = b(m); (bm >= k ? q : køer[bm]).push(m)
      }
    }
  }
  return lab
}

// ── 4b. etiketter som fasit ─────────────────────────────────────────────────

/** Nærmeste piksel til p som oppfyller ok(), søkt i voksende ring. */
function nærmeste(r: Raster, p: Punkt, ok: (i: number) => boolean, maksPx: number): number {
  const cx = Math.round((p.x - r.x0) * r.skala), cy = Math.round((p.y - r.y0) * r.skala)
  for (let rad = 0; rad <= maksPx; rad++) {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= r.W || y >= r.H) continue
      const i = y * r.W + x; if (ok(i)) return i
    }
  }
  return -1
}

/** Naboskap mellom regioner: hvor mange pikselkanter de deler når begge vokser gjennom veggen. */
type Nabo = { n: number; tynn: number }
function naboskap(r: Raster, lab: Int32Array, maksPx: number): Map<number, Map<number, Nabo>> {
  const { W, H } = r; const dil = Int32Array.from(lab); const dyp = new Int16Array(W * H)
  let kø: number[] = []; for (let i = 0; i < W * H; i++) if (lab[i]) kø.push(i)
  for (let steg = 1; steg <= maksPx && kø.length; steg++) {
    const neste: number[] = []
    for (const j of kø) { const x = j % W
      for (const m of [j - W, j + W, x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1]) if (m >= 0 && m < W * H && !dil[m]) { dil[m] = dil[j]; dyp[m] = steg; neste.push(m) } }
    kø = neste
  }
  const nabo = new Map<number, Map<number, Nabo>>()
  const tell = (a: number, b: number, t: number) => { if (a === b || !a || !b) return; const m = nabo.get(a) ?? nabo.set(a, new Map()).get(a)!; const o = m.get(b) ?? { n: 0, tynn: 1e9 }; o.n++; o.tynn = Math.min(o.tynn, t); m.set(b, o) }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x
    if (x < W - 1) { const t = dyp[i] + dyp[i + 1]; tell(dil[i], dil[i + 1], t); tell(dil[i + 1], dil[i], t) }
    if (y < H - 1) { const t = dyp[i] + dyp[i + W]; tell(dil[i], dil[i + W], t); tell(dil[i + W], dil[i], t) } }
  return nabo
}

/**
 * Regioner uten etikett slås inn i naboen de deler lengst grense med (utstyr
 * med dobbeltstrek deler rom i biter). Havner to etiketter i samme region,
 * eroderes den videre til de skiller lag (brede åpninger/porter).
 */
function bruktEtiketter(r: Raster, lab: Int32Array, dist: Float32Array, etiketter: Punkt[], inn: Innstillinger): Map<number, number[]> {
  const { W, H } = r
  const merker = new Map<number, number[]>() // region → etikett-indekser
  const finnRegion = (e: number) => { const i = nærmeste(r, etiketter[e], k => lab[k] > 0, Math.round(1.0 / inn.oppløsning)); return i < 0 ? 0 : lab[i] }
  etiketter.forEach((_, e) => { const id = finnRegion(e); if (id > 0) (merker.get(id) ?? merker.set(id, []).get(id)!).push(e) })

  // splitt regioner med flere etiketter
  const rMaks = Math.ceil(inn.doerMaks / inn.oppløsning) // opptil dobbel dørbredde
  let nesteId = 0; for (let i = 0; i < W * H; i++) if (lab[i] > nesteId) nesteId = lab[i]
  for (const [id, es] of [...merker]) {
    if (es.length < 2) continue
    for (let rr = 1; rr <= rMaks; rr++) {
      const ok = (i: number) => lab[i] === id && dist[i] > rr
      const { lab: k } = komponenter(W, H, ok)
      const komp = es.map(e => { const i = nærmeste(r, etiketter[e], ok, Math.round(2.0 / inn.oppløsning)); return i < 0 ? 0 : k[i] })
      const ulike = new Set(komp.filter(Boolean))
      if (ulike.size < 2) continue
      // frø per komponent, etiketter i samme komponent blir sammen
      const frø: { piksler: Int32Array; id: number }[] = []; const nyId = new Map<number, number>()
      for (const c of ulike) { const px: number[] = []; for (let i = 0; i < W * H; i++) if (k[i] === c) px.push(i); const nid = ++nesteId; nyId.set(c, nid); frø.push({ piksler: Int32Array.from(px), id: nid }) }
      for (let i = 0; i < W * H; i++) if (lab[i] === id) lab[i] = 0
      tilordne(r, dist, frø, i => lab[i] === 0, lab)
      merker.delete(id)
      es.forEach((e, n) => { const nid = komp[n] ? nyId.get(komp[n])! : frø[0].id; (merker.get(nid) ?? merker.set(nid, []).get(nid)!).push(e) })
      break
    }
  }

  // slå umerkede inn i merkede naboer
  const nabo = naboskap(r, lab, Math.round(inn.veggMaks / inn.oppløsning) + 1)
  for (;;) {
    let best: { fra: number; til: number; o: Nabo } | null = null
    const bedre = (a: Nabo, b: Nabo) => a.tynn !== b.tynn ? a.tynn < b.tynn : a.n > b.n
    for (const [fra, m] of nabo) {
      if (fra <= 0 || merker.has(fra)) continue
      for (const [til, o] of m) if (til > 0 && merker.has(til) && (!best || bedre(o, best.o))) best = { fra, til, o }
    }
    if (!best) break
    for (let i = 0; i < W * H; i++) if (lab[i] === best.fra) lab[i] = best.til
    const slå = (a: Nabo | undefined, b: Nabo): Nabo => a ? { n: a.n + b.n, tynn: Math.min(a.tynn, b.tynn) } : { ...b }
    const mFra = nabo.get(best.fra)!, mTil = nabo.get(best.til)!
    for (const [k, o] of mFra) { if (k === best.til) continue; mTil.set(k, slå(mTil.get(k), o)); const mk = nabo.get(k)!; mk.set(best.til, slå(mk.get(best.til), o)); mk.delete(best.fra) }
    mTil.delete(best.fra); nabo.delete(best.fra)
  }
  flyttSøl(r, lab, dist, etiketter, merker, inn)
  return merker
}

/**
 * Et rom som «søler» gjennom ei dør inn i en smal gang får hele gangen når
 * gangen er smalere enn døra. Eroder hvert merkede rom med halv dørbredde;
 * deler det seg, flyttes bitene uten etikett til naboen de er mest åpne mot.
 */
function flyttSøl(r: Raster, lab: Int32Array, dist: Float32Array, etiketter: Punkt[], merker: Map<number, number[]>, inn: Innstillinger) {
  const { W, H } = r
  const rr = Math.round(inn.doerMaks / 4 / inn.oppløsning) // halv normal dørbredde
  const minFrø = inn.minFrø / (inn.oppløsning * inn.oppløsning)
  for (const [id, es] of [...merker]) {
    const ok = (i: number) => lab[i] === id && dist[i] > rr
    const { lab: k, n } = komponenter(W, H, ok)
    if (n < 2) continue
    const egne = new Set(es.map(e => { const i = nærmeste(r, etiketter[e], ok, Math.round(2.0 / inn.oppløsning)); return i < 0 ? 0 : k[i] }))
    const størrelse = new Int32Array(n + 1); for (let i = 0; i < W * H; i++) if (k[i]) størrelse[k[i]]++
    const løse = new Set<number>(); for (let c = 1; c <= n; c++) if (!egne.has(c) && størrelse[c] >= minFrø) løse.add(c)
    if (!løse.size) continue
    // vannskille innenfor rommet: egne komponenter beholder id, løse får midlertidige id-er
    const frø: { piksler: Int32Array; id: number }[] = []; const midl = new Map<number, number>()
    let neste = -1000
    const px = new Map<number, number[]>(); for (let i = 0; i < W * H; i++) if (k[i] && (egne.has(k[i]) || løse.has(k[i]))) (px.get(k[i]) ?? px.set(k[i], []).get(k[i])!).push(i)
    for (const [c, p] of px) { let fid = id; if (løse.has(c)) { fid = neste--; midl.set(fid, c) } frø.push({ piksler: Int32Array.from(p), id: fid }) }
    for (let i = 0; i < W * H; i++) if (lab[i] === id) lab[i] = 0
    tilordne(r, dist, frø, i => lab[i] === 0, lab)
    // hver løs bit → nabo med mest åpen grense (ikke rommet selv)
    const nabo = naboskap(r, lab, Math.round(inn.veggMaks / inn.oppløsning) + 1)
    for (const fid of midl.keys()) {
      let best: { til: number; o: Nabo } | null = null
      for (const [til, o] of nabo.get(fid) ?? []) if (til > 0 && til !== id && (!best || o.tynn < best.o.tynn || (o.tynn === best.o.tynn && o.n > best.o.n))) best = { til, o }
      const til = best && best.o.tynn <= 1 ? best.til : id // bare gjennom åpning, ellers tilbake
      for (let i = 0; i < W * H; i++) if (lab[i] === fid) lab[i] = til
    }
  }
}

/**
 * Veggpiksler som bare grenser til én region (utstyr, skillevegger inne i
 * sammenslåtte rom) legges til regionen, så polygonet blir rommets ytterkant.
 */
function fyllIndre(r: Raster, lab: Int32Array, maksPx: number): Int32Array {
  const { W, H } = r; const dil = Int32Array.from(lab)
  let kø: number[] = []; for (let i = 0; i < W * H; i++) if (lab[i]) kø.push(i)
  for (let steg = 1; kø.length; steg++) {
    const neste: number[] = []
    for (const j of kø) { const x = j % W
      for (const m of [j - W, j + W, x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1]) if (m >= 0 && m < W * H && !dil[m]) { dil[m] = dil[j]; neste.push(m) } }
    kø = neste
  }
  // grensepiksler (ulik nabo) og alt innen maksPx fra dem forblir vegg
  const sperr = new Uint8Array(W * H); kø = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (lab[i] || !dil[i]) continue
    const ulik = (x < W - 1 && dil[i + 1] !== dil[i]) || (x > 0 && dil[i - 1] !== dil[i]) || (y < H - 1 && dil[i + W] !== dil[i]) || (y > 0 && dil[i - W] !== dil[i])
    if (ulik) { sperr[i] = 1; kø.push(i) } }
  for (let steg = 1; steg <= maksPx && kø.length; steg++) {
    const neste: number[] = []
    for (const j of kø) { const x = j % W
      for (const m of [j - W, j + W, x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1]) if (m >= 0 && m < W * H && !lab[m] && dil[m] && !sperr[m]) { sperr[m] = 1; neste.push(m) } }
    kø = neste
  }
  const ut = Int32Array.from(lab)
  for (let i = 0; i < W * H; i++) if (!lab[i] && dil[i] > 0 && !sperr[i]) ut[i] = dil[i]
  return ut
}

/**
 * Fyller veggbåndene: hvert veggpiksel går til nærmeste merkede nabo, også
 * utsiden. Rommene møtes da midt i veggen og det blir ingen hvite belter.
 * Brukes BARE til omrisset — arealet regnes av gulvet, ikke av veggen.
 */
function fyllTilVegg(r: Raster, lab: Int32Array): Int32Array {
  const { W, H } = r
  const ut = Int32Array.from(lab)
  let kø: number[] = []; for (let i = 0; i < W * H; i++) if (ut[i] !== 0) kø.push(i)
  while (kø.length) {
    const neste: number[] = []
    for (const j of kø) { const x = j % W
      for (const m of [j - W, j + W, x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1])
        if (m >= 0 && m < W * H && ut[m] === 0) { ut[m] = ut[j]; neste.push(m) }
    }
    kø = neste
  }
  return ut
}

/**
 * Retter ut rommene: hull mellom rompiksler langs en rad eller kolonne fylles
 * når hullet ikke inneholder et annet rom, er kortere enn buktMaks og under
 * buktAndel av rommets spenn i den retningen. Senger og benker som er tegnet
 * med parallellstrek lager ellers bukter inn i rommet; ekte L-former er
 * større og beholdes.
 */
function fyllBukter(r: Raster, lab: Int32Array, inn: Innstillinger) {
  const { W, H } = r
  const maksPx = Math.round(inn.buktMaks / inn.oppløsning)
  const ids = new Set<number>(); for (let i = 0; i < W * H; i++) if (lab[i] > 0) ids.add(lab[i])
  const bx0 = new Map<number, number>(), bx1 = new Map<number, number>(), by0 = new Map<number, number>(), by1 = new Map<number, number>()
  for (let i = 0; i < W * H; i++) { const id = lab[i]; if (id <= 0) continue; const x = i % W, y = (i / W) | 0
    bx0.set(id, Math.min(bx0.get(id) ?? W, x)); bx1.set(id, Math.max(bx1.get(id) ?? 0, x)); by0.set(id, Math.min(by0.get(id) ?? H, y)); by1.set(id, Math.max(by1.get(id) ?? 0, y)) }
  const fyllLinje = (id: number, start: number, steg: number, n: number) => {
    // finn første og siste rompiksel på linja, fyll hull imellom som er små nok
    let første = -1, siste = -1
    for (let k = 0; k < n; k++) { if (lab[start + k * steg] === id) { if (første < 0) første = k; siste = k } }
    if (første < 0) return
    const spenn = siste - første + 1, grense = Math.min(maksPx, Math.floor(spenn * inn.buktAndel))
    let k = første
    while (k < siste) {
      if (lab[start + k * steg] === id) { k++; continue }
      let e = k; let annet = false
      while (e < siste && lab[start + e * steg] !== id) { const v = lab[start + e * steg]; if (v > 0 && v !== id) annet = true; e++ }
      if (!annet && e - k <= grense) for (let j = k; j < e; j++) lab[start + j * steg] = id
      k = e
    }
  }
  for (let runde = 0; runde < 2; runde++) for (const id of ids) {
    for (let y = by0.get(id)!; y <= by1.get(id)!; y++) fyllLinje(id, y * W + bx0.get(id)!, 1, bx1.get(id)! - bx0.get(id)! + 1)
    for (let x = bx0.get(id)!; x <= bx1.get(id)!; x++) fyllLinje(id, by0.get(id)! * W + x, W, by1.get(id)! - by0.get(id)! + 1)
  }
}

/**
 * Småbiter (møbelgrupper, skap) som bare grenser til ett rom slås inn i det.
 */
function slåInnSmåbiter(r: Raster, lab: Int32Array, inn: Innstillinger) {
  const { W, H } = r
  const antall = new Map<number, number>(); for (let i = 0; i < W * H; i++) if (lab[i] > 0) antall.set(lab[i], (antall.get(lab[i]) ?? 0) + 1)
  const maksPx = 2 * inn.minAreal / (inn.oppløsning * inn.oppløsning)
  // Et møbel er skilt fra rommet av én tynn strek; et lite rom (bod) er skilt
  // av en ekte vegg. Bare det første skal slås inn.
  const tynnGrense = Math.max(2, Math.round(inn.veggMin / inn.oppløsning))
  const nabo = naboskap(r, lab, Math.round(inn.veggMaks / inn.oppløsning) + 1)
  for (const [id, n] of antall) {
    if (n >= maksPx) continue
    const m = nabo.get(id); if (!m) continue
    const rom = [...m.entries()].filter(([k]) => k > 0)
    if (rom.length !== 1) continue
    if (rom[0][1].tynn > tynnGrense) continue
    for (let i = 0; i < W * H; i++) if (lab[i] === id) lab[i] = rom[0][0]
  }
}

/**
 * Retter ut hver side av rommet mot den dominerende vegglinja: linja der
 * mesteparten av kanten ligger (gjennom hjørnene). Alt mellom rommet og linja
 * fylles så lenge det ikke er et annet rom der og bukta er grunnere enn buktMaks.
 */
function rettUtKanter(r: Raster, lab: Int32Array, inn: Innstillinger) {
  const { W, H } = r
  const maksPx = Math.round(inn.buktMaks / inn.oppløsning)
  const ids = new Set<number>(); for (let i = 0; i < W * H; i++) if (lab[i] > 0) ids.add(lab[i])
  for (const id of ids) {
    let x0 = W, x1 = 0, y0 = H, y1 = 0
    for (let i = 0; i < W * H; i++) if (lab[i] === id) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    // fire sider: (langs-akse antall, tverr-akse) — first/last rompiksel per linje
    const side = (nLinjer: number, nTverr: number, idx: (l: number, t: number) => number, fraStart: boolean) => {
      const kant = new Int32Array(nLinjer).fill(-1)
      for (let l = 0; l < nLinjer; l++) {
        if (fraStart) { for (let t = 0; t < nTverr; t++) if (lab[idx(l, t)] === id) { kant[l] = t; break } }
        else { for (let t = nTverr - 1; t >= 0; t--) if (lab[idx(l, t)] === id) { kant[l] = t; break } }
      }
      // dominerende linje
      const tell = new Map<number, number>(); let best = -1, bestN = 0, med = 0
      for (const k of kant) { if (k < 0) continue; med++; const n = (tell.get(k) ?? 0) + 1; tell.set(k, n); if (n > bestN) { bestN = n; best = k } }
      if (best < 0 || bestN < med * 0.3) return
      for (let l = 0; l < nLinjer; l++) {
        const k = kant[l]; if (k < 0) continue
        const fra = fraStart ? best : k + 1, til = fraStart ? k : best + 1 // [fra, til)
        if (til - fra <= 0 || til - fra > maksPx) continue
        let ok = true; for (let t = fra; t < til; t++) { const v = lab[idx(l, t)]; if (v > 0 && v !== id) { ok = false; break } }
        if (ok) for (let t = fra; t < til; t++) lab[idx(l, t)] = id
      }
    }
    const nx = x1 - x0 + 1, ny = y1 - y0 + 1
    side(nx, ny, (l, t) => (y0 + t) * W + x0 + l, true)   // topp
    side(nx, ny, (l, t) => (y0 + t) * W + x0 + l, false)  // bunn
    side(ny, nx, (l, t) => (y0 + l) * W + x0 + t, true)   // venstre
    side(ny, nx, (l, t) => (y0 + l) * W + x0 + t, false)  // høyre
  }
}

// ── 5. polygon ──────────────────────────────────────────────────────────────

function omriss(r: Raster, lab: Int32Array, id: number): Punkt[] {
  const { W, H } = r
  const ut = new Map<number, number[]>() // hjørne → utgående hjørner
  const key = (x: number, y: number) => y * (W + 1) + x
  const kant = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0); (ut.get(k) ?? ut.set(k, []).get(k)!).push(key(x1, y1)) }
  const er = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === id
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!er(x, y)) continue
    if (!er(x, y - 1)) kant(x, y, x + 1, y)
    if (!er(x + 1, y)) kant(x + 1, y, x + 1, y + 1)
    if (!er(x, y + 1)) kant(x + 1, y + 1, x, y + 1)
    if (!er(x - 1, y)) kant(x, y + 1, x, y)
  }
  let best: number[] = []
  const brukt = new Set<number>()
  for (const start of ut.keys()) {
    if (brukt.has(start)) continue
    const løkke: number[] = []; let k = start
    while (!brukt.has(k)) { brukt.add(k); løkke.push(k); const n = ut.get(k); if (!n || !n.length) break; k = n.pop()! }
    if (løkke.length > best.length) best = løkke
  }
  const pts = best.map(k => ({ x: k % (W + 1), y: Math.floor(k / (W + 1)) }))
  return forenkle(pts, 1.2).map(p => ({ x: r.x0 + p.x / r.skala, y: r.y0 + p.y / r.skala }))
}

function forenkle(p: Punkt[], eps: number): Punkt[] {
  if (p.length < 4) return p
  const avst = (a: Punkt, b: Punkt, c: Punkt) => { const dx = c.x - b.x, dy = c.y - b.y; const L = Math.hypot(dx, dy) || 1; return Math.abs((a.x - b.x) * dy - (a.y - b.y) * dx) / L }
  const rek = (i: number, j: number, ut: Punkt[]) => {
    let m = -1, md = eps
    for (let k = i + 1; k < j; k++) { const d = avst(p[k], p[i], p[j]); if (d > md) { md = d; m = k } }
    if (m < 0) return
    rek(i, m, ut); ut.push(p[m]); rek(m, j, ut)
  }
  // lukket: start fra punktet lengst fra p[0]
  let far = 0, fd = -1
  for (let k = 1; k < p.length; k++) { const d = Math.hypot(p[k].x - p[0].x, p[k].y - p[0].y); if (d > fd) { fd = d; far = k } }
  const ut: Punkt[] = [p[0]]; rek(0, far, ut); ut.push(p[far])
  const p2 = [...p.slice(far), p[0]]; const ut2: Punkt[] = []
  const rek2 = (i: number, j: number) => { let m = -1, md = eps; for (let k = i + 1; k < j; k++) { const d = avst(p2[k], p2[i], p2[j]); if (d > md) { md = d; m = k } } if (m < 0) return; rek2(i, m); ut2.push(p2[m]); rek2(m, j) }
  rek2(0, p2.length - 1)
  return [...ut, ...ut2]
}

function signertAreal(p: Punkt[]) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y); return a / 2 }

export let sisteKjøring: { r: Raster; lab: Int32Array; dist: Float32Array } | null = null

// ── hoved ───────────────────────────────────────────────────────────────────

export function finnRom(segmenter: Segment[], inn: Innstillinger = STANDARD, etiketter: Punkt[] = []): Rom[] {
  const vegger = finnVegger(segmenter, inn)
  if (!vegger.length) return []
  const marg = 1.0 * inn.ptPerM
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const v of vegger) for (const p of [v.a, v.b, v.c, v.d]) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y }
  x0 -= marg; y0 -= marg; x1 += marg; y1 += marg
  const skala = 1 / (inn.ptPerM * inn.oppløsning)
  const W = Math.ceil((x1 - x0) * skala), H = Math.ceil((y1 - y0) * skala)
  const r: Raster = { W, H, x0, y0, skala, vegg: new Uint8Array(W * H) }
  for (const v of vegger) tegnFirkant(r, [v.a, v.b, v.c, v.d])
  return finnRomIRaster(r, inn, etiketter)
}

/** Samme som finnRom, men fra et ferdig veggraster (skannede/flate PDF-er). */
export function finnRomIRaster(r: Raster, inn: Innstillinger = STANDARD, etiketter: Punkt[] = []): Rom[] {
  const { W, H } = r
  kastSmåVegger(r, inn.minVeggKomp / inn.oppløsning)
  const dist = avstand(r)
  const noder = erosjonstre(r, dist, inn)
  const frø = noder.filter(n => n.aktiv).map((n, i) => ({ piksler: n.piksler, id: n.ute ? -1 : i + 1 }))
  // alle ute-frø deler id -1 så de ikke konkurrerer innbyrdes
  const lab = tilordne(r, dist, frø)
  const merker = etiketter.length ? bruktEtiketter(r, lab, dist, etiketter, inn) : new Map<number, number[]>()
  const lab2 = fyllIndre(r, lab, Math.round(inn.veggMaks / inn.oppløsning) + 1)
  sisteKjøring = { r, lab: lab2, dist }
  sisteKjøring = { r, lab: lab2, dist }
  if (inn.buktMaks > 0) { slåInnSmåbiter(r, lab2, inn); rettUtKanter(r, lab2, inn); fyllBukter(r, lab2, inn) }
  const antall = new Map<number, number>()
  for (let i = 0; i < W * H; i++) if (lab2[i] > 0) antall.set(lab2[i], (antall.get(lab2[i]) ?? 0) + 1)
  // Polygonet skal dekke helt ut til veggmidten; arealet er gulvet.
  const labP = fyllTilVegg(r, lab2)
  const pxM2 = inn.oppløsning * inn.oppløsning
  const rom: Rom[] = []
  for (const [id, n] of antall) {
    const m2 = n * pxM2
    if (m2 < inn.minAreal || m2 > inn.maksAreal) continue
    const polygon = omriss(r, labP, id)
    if (polygon.length < 3) continue
    const areal = m2 * inn.ptPerM * inn.ptPerM // gulvareal, ikke polygonets
    let sx = 0, sy = 0; for (const p of polygon) { sx += p.x; sy += p.y }
    rom.push({ polygon, areal, senter: { x: sx / polygon.length, y: sy / polygon.length }, etiketter: merker.get(id) ?? [] })
  }
  return rom
}

/** Kun for testkjøring utenfor appen. */
export const __intern = { finnVegger, avstand, komponenter, naboskap }
