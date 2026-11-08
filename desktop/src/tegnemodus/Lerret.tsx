import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import arbeider from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getSymbol } from '@delt/symbols'
import { romAreal, kursFarge, meterPerEnhet, niva, type Boks, type Prosjektering, type Pt, type Punkt, type Rom } from '@delt/prosjektering'
import { dupliserUtvalg, flyttUtvalg, iBoks, lengdeLangs } from '@delt/tegning-redigering'

GlobalWorkerOptions.workerSrc = arbeider

/**
 * Lerretet i tegnemodusen. Planen (PDF side 1 eller bilde) med laget oppå, tegnet i SVG i sidens
 * egne piksler — symbolene holder samme skjermstørrelse uansett zoom.
 *
 * Musa følger AutoCAD/Figma (docs/TEGNEMODUS_RESEARCH.md):
 *  - Velg: klikk velger, Shift legger til/tar bort, dra flytter utvalget, Alt+dra kopierer.
 *    Dra i tomt område er en markeringsboks — mot høyre tar det som ligger helt inni, mot venstre
 *    det som berøres. Dobbeltklikk på et punkt = fokus på kursen.
 *  - Mellomrom holdt, midtknapp eller Hånd-verktøyet panorerer. To fingre panorerer, knip og
 *    musehjul zoomer om markøren.
 *  - Rom fanges på kanten og navnet, ikke på flaten: ellers kunne man aldri dra en boks inne i et rom.
 *  - Fokus på kurs: alt annet dimmes, og et klikk legger et punkt eller en føring på kursen
 *    eller tar det av (Revit «Edit Circuit»).
 *  - Føring og mål: klikk for klikk, lengden står ved markøren. Ortho (eller Shift) låser til
 *    0/90°, Fest trekker til nærmeste punkt.
 */

export type Verktoy = 'velg' | 'hand' | 'punkt' | 'foring' | 'rom' | 'fare-anlegg' | 'fare-montor' | 'maal' | 'malestokk'

export type Forslag = { rom: Rom[]; punkter: Punkt[] }

export type Kontroll = { tilpass(): void; zoom(f: number): void; vis(ids: string[]): void }

type Transform = { s: number; x: number; y: number }
const MAKS_PX = 4096
const FARGE = { lav: '#1F7A3F', middels: '#B7791F', hoy: '#B3261E' }
const BLEKK = '#1D1D1F'
const VALGT = '#2160D4'
const MONO = "'Geist Mono', ui-monospace, monospace"
const FEST_PX = 12

type Dra =
  | { slag: 'pan'; px: number; py: number; x: number; y: number }
  | { slag: 'flytt'; fra: Pt; start: Pt; forste: boolean; ids: string[]; kopier: boolean }
  | { slag: 'boks'; fra: Pt; legg: boolean; flyttet: boolean }
  | { slag: 'knekk'; id: string; i: number; forste: boolean }
  | { slag: 'rom'; fra: Pt }

export function Lerret({
  url, type, p, verktoy, symbol, valgt, onVelg, onEndre, lese, foringSkjult = true, aktivKurs = null, fokusKurs = null,
  onFokusKurs, skjult, underlag = { opasitet: 1, gra: false }, orto = false, fest = true, vinkel = 0, forslag,
  onPeker, onSide, onMaal, kontroll,
}: {
  url: string | null
  type: 'bilde' | 'pdf' | null
  p: Prosjektering
  verktoy: Verktoy
  /** Symbolet Punkt-verktøyet stempler. */
  symbol?: string
  valgt: string[]
  onVelg: (ids: string[]) => void
  onEndre?: (fn: (p: Prosjektering) => Prosjektering, samme?: boolean) => void
  lese?: boolean
  foringSkjult?: boolean
  aktivKurs?: string | null
  fokusKurs?: string | null
  onFokusKurs?: (id: string | null) => void
  /** Lag som er slått av: 'rom', 'punkter', 'skjult', 'apen', 'farer', 'kurs:<id>', 'type:<type>'. */
  skjult?: Set<string>
  underlag?: { opasitet: number; gra: boolean }
  orto?: boolean
  fest?: boolean
  /** Rotasjonen et nytt punkt får (tasten . under stempling). */
  vinkel?: number
  forslag?: Forslag | null
  onPeker?: (q: Pt | null) => void
  onSide?: (w: number, h: number) => void
  /** Pågående måling: punktene og lengden, så statuslinja kan vise den. */
  onMaal?: (m: { pts: Pt[]; meter: number | null } | null) => void
  kontroll?: MutableRefObject<Kontroll | null>
}) {
  const boks = useRef<HTMLDivElement>(null)
  const lerret = useRef<HTMLCanvasElement>(null)
  const [side, setSide] = useState<{ w: number; h: number } | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [t, setT] = useState<Transform>({ s: 1, x: 0, y: 0 })
  const [utkast, setUtkast] = useState<Boks | null>(null)
  const [markering, setMarkering] = useState<{ a: Pt; b: Pt } | null>(null)
  const [malA, setMalA] = useState<Pt | null>(null)
  const [peker, setPeker] = useState<Pt | null>(null)
  const [festet, setFestet] = useState<string | null>(null)
  const [linje, setLinje] = useState<Pt[] | null>(null) // føring eller måling under tegning
  const [maaling, setMaaling] = useState<Pt[] | null>(null) // ferdig måling, står til Esc
  const [rom, setRom] = useState(false) // mellomrom holdt
  const dra = useRef<Dra | null>(null)
  const av = skjult ?? new Set<string>()

  // ── Planen ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!url || !type) { setSide(null); return }
    let levende = true
    setSide(null); setFeil(null)
    if (type === 'bilde') {
      const img = new Image()
      img.onload = () => { if (levende) setSide({ w: img.naturalWidth, h: img.naturalHeight }) }
      img.onerror = () => { if (levende) setFeil('bildet kunne ikke leses') }
      img.src = url
      return () => { levende = false }
    }
    const oppgave = getDocument({ url })
    oppgave.promise
      .then(dok => dok.getPage(1))
      .then(async s => {
        const base = s.getViewport({ scale: 1 })
        const skala = Math.min(MAKS_PX / base.width, MAKS_PX / base.height, 4)
        const vp = s.getViewport({ scale: skala })
        const c = lerret.current
        if (!c || !levende) return
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height)
        await s.render({ canvas: c, viewport: vp }).promise
        if (levende) setSide({ w: c.width, h: c.height })
      })
      .catch(e => { if (levende) setFeil(e instanceof Error ? e.message : String(e)) })
    return () => { levende = false; void oppgave.destroy() }
  }, [url, type])

  const tilpass = useCallback(() => {
    const b = boks.current
    if (!b || !side) return
    const s = Math.min(b.clientWidth / side.w, b.clientHeight / side.h) * 0.94
    setT({ s, x: (b.clientWidth - side.w * s) / 2, y: (b.clientHeight - side.h * s) / 2 })
  }, [side])
  useLayoutEffect(() => { tilpass() }, [tilpass])
  useEffect(() => { if (side) onSide?.(side.w, side.h) }, [side]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomRundt = useCallback((faktor: number, cx: number, cy: number) => {
    setT(g => {
      const b = boks.current
      const fit = b && side ? Math.min(b.clientWidth / side.w, b.clientHeight / side.h) : 0.05
      const s = Math.min(Math.max(g.s * faktor, fit * 0.4), fit * 16)
      const k = s / g.s
      return { s, x: cx - (cx - g.x) * k, y: cy - (cy - g.y) * k }
    })
  }, [side])

  // Kontrollene siden styrer: tilpass, zoom fra tastaturet, og «vis meg dette» fra ⌘K.
  useEffect(() => {
    if (!kontroll) return
    kontroll.current = {
      tilpass,
      zoom: f => { const b = boks.current; if (b) zoomRundt(f, b.clientWidth / 2, b.clientHeight / 2) },
      vis: ids => {
        const b = boks.current
        if (!b || !side) return
        const pts: Pt[] = []
        for (const id of ids) {
          const pt = p.punkter.find(x => x.id === id); if (pt) pts.push(pt)
          const f = p.foringer.find(x => x.id === id); if (f) pts.push(...f.pts)
          const r = p.rom.find(x => x.id === id); if (r) pts.push({ x: r.form.x, y: r.form.y }, { x: r.form.x + r.form.w, y: r.form.y + r.form.h })
          const fa = p.farer.find(x => x.id === id); if (fa?.x != null && fa.y != null) pts.push({ x: fa.x, y: fa.y })
        }
        if (!pts.length) return
        const x0 = Math.min(...pts.map(q => q.x)), x1 = Math.max(...pts.map(q => q.x))
        const y0 = Math.min(...pts.map(q => q.y)), y1 = Math.max(...pts.map(q => q.y))
        const fit = Math.min(b.clientWidth / side.w, b.clientHeight / side.h)
        const s = Math.min(fit * 6, Math.max(fit, Math.min(b.clientWidth / ((x1 - x0 + 0.04) * side.w), b.clientHeight / ((y1 - y0 + 0.04) * side.h)) * 0.8))
        setT({ s, x: b.clientWidth / 2 - (x0 + x1) / 2 * side.w * s, y: b.clientHeight / 2 - (y0 + y1) / 2 * side.h * s })
      },
    }
  }, [kontroll, tilpass, zoomRundt, side, p])

  // Hjul: knip og musehjul zoomer, to fingre panorerer. Et musehjul gir hele «linjer» uten
  // sideveis bevegelse; en styreflate gir små, glatte steg. Det er skillet vi har.
  useEffect(() => {
    const b = boks.current
    if (!b) return
    const hjul = (e: WheelEvent) => {
      e.preventDefault()
      const r = b.getBoundingClientRect()
      const musehjul = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))
      if (e.ctrlKey || e.metaKey) zoomRundt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top)
      else if (musehjul) zoomRundt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top)
      else setT(g => ({ ...g, x: g.x - e.deltaX, y: g.y - e.deltaY }))
    }
    b.addEventListener('wheel', hjul, { passive: false })
    return () => b.removeEventListener('wheel', hjul)
  }, [zoomRundt])

  // Mellomrom holdt = hånd (ikke mens man skriver).
  useEffect(() => {
    const ned = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault(); setRom(true)
    }
    const opp = (e: KeyboardEvent) => { if (e.code === 'Space') setRom(false) }
    window.addEventListener('keydown', ned); window.addEventListener('keyup', opp)
    return () => { window.removeEventListener('keydown', ned); window.removeEventListener('keyup', opp) }
  }, [])

  // ── Føring og måling ─────────────────────────────────────────────────────
  const linjeRef = useRef<Pt[] | null>(null)
  linjeRef.current = linje
  const avsluttLinje = useCallback(() => {
    const f = linjeRef.current
    linjeRef.current = null
    setLinje(null)
    if (!f || f.length < 2) return
    if (verktoy === 'maal') { setMaaling(f); return }
    if (!onEndre) return
    const id = crypto.randomUUID()
    onEndre(d => ({ ...d, foringer: [...d.foringer, { id, pts: f, skjult: foringSkjult, kursId: (fokusKurs ?? aktivKurs) ?? undefined }] }))
  }, [onEndre, foringSkjult, aktivKurs, fokusKurs, verktoy])
  const forrigeVerktoy = useRef(verktoy)
  useEffect(() => {
    if (forrigeVerktoy.current !== verktoy) {
      // Bytte av verktøy (også Esc) lagrer føringen i stedet for å kaste den.
      if (forrigeVerktoy.current === 'foring') avsluttLinje()
      else { setLinje(null); linjeRef.current = null }
      if (verktoy !== 'malestokk') setMalA(null)
      if (verktoy !== 'maal') setMaaling(null)
      forrigeVerktoy.current = verktoy
    }
  }, [verktoy, avsluttLinje])
  useEffect(() => {
    const tast = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'Enter' && linjeRef.current) { e.preventDefault(); avsluttLinje() }
      if (e.key === 'Escape' && (linjeRef.current || maaling)) {
        // Esc ett nivå ut: avbryt linja (føringen lagres som den er), så målingen.
        e.stopPropagation()
        if (linjeRef.current) avsluttLinje(); else setMaaling(null)
      }
    }
    window.addEventListener('keydown', tast, true)
    return () => window.removeEventListener('keydown', tast, true)
  }, [avsluttLinje, maaling])

  const W = side?.w ?? 1, H = side?.h ?? 1
  const px = 1 / t.s // én skjermpiksel i sidens piksler
  const mpe = side ? meterPerEnhet(p.plan.malestokk, W / H) : null
  useEffect(() => {
    const m = linje && verktoy === 'maal' ? [...linje, ...(peker ? [peker] : [])] : maaling
    onMaal?.(m && m.length >= 2 ? { pts: m, meter: lengdeLangs(m, mpe) } : null)
  }, [linje, maaling, peker, verktoy, mpe]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Synlig og valgbar? Lag av, type av, kurs av. */
  const synlig = useCallback((id: string): boolean => {
    const pt = p.punkter.find(x => x.id === id)
    if (pt) return !av.has('punkter') && !av.has(`type:${pt.type}`) && !av.has(`kurs:${pt.kursId ?? 'ingen'}`)
    const f = p.foringer.find(x => x.id === id)
    if (f) return !av.has(f.skjult ? 'skjult' : 'apen') && !av.has(`kurs:${f.kursId ?? 'ingen'}`)
    if (p.farer.some(x => x.id === id)) return !av.has('farer')
    if (p.rom.some(x => x.id === id)) return !av.has('rom')
    return true
  }, [p, av])

  /** Skjermpunkt → normalisert punkt på planen (0..1). */
  const tilPlan = (cx: number, cy: number): Pt | null => {
    const b = boks.current
    if (!b || !side) return null
    const r = b.getBoundingClientRect()
    return { x: (cx - r.left - t.x) / (side.w * t.s), y: (cy - r.top - t.y) / (side.h * t.s) }
  }
  const klem = (q: Pt): Pt => ({ x: Math.min(1, Math.max(0, q.x)), y: Math.min(1, Math.max(0, q.y)) })

  /** Neste punkt på en linje: fest til nærmeste punkt, ellers ortho fra forrige. */
  const linjePunkt = (q: Pt, rett: boolean, forrige: Pt | undefined): { q: Pt; festet: string | null } => {
    if (fest && side) {
      let best: { id: string; d: number; q: Pt } | null = null
      for (const pt of p.punkter) {
        if (!synlig(pt.id)) continue
        const d = Math.hypot((pt.x - q.x) * W, (pt.y - q.y) * H) * t.s
        if (d < FEST_PX && (!best || d < best.d)) best = { id: pt.id, d, q: { x: pt.x, y: pt.y } }
      }
      if (best) return { q: best.q, festet: best.id }
    }
    if ((rett || orto) && forrige && side) {
      const dx = Math.abs(q.x - forrige.x) * W, dy = Math.abs(q.y - forrige.y) * H
      return { q: dx >= dy ? { x: q.x, y: forrige.y } : { x: forrige.x, y: q.y }, festet: null }
    }
    return { q, festet: null }
  }

  function ned(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.tm-flyt')) return
    const q = tilPlan(e.clientX, e.clientY)
    if (!q) return
    const el = (e.target as Element).closest('[data-id]')
    const traff = el?.getAttribute('data-id') ?? null
    const knekk = (e.target as Element).closest('[data-knekk]')?.getAttribute('data-knekk') ?? null
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    if (e.button === 1 || rom || verktoy === 'hand' || (lese && !traff)) {
      dra.current = { slag: 'pan', px: e.clientX, py: e.clientY, x: t.x, y: t.y }
      return
    }
    if (lese) { if (traff) onVelg([traff]); return }

    if (verktoy === 'velg') {
      if (knekk && onEndre) {
        const [id, i] = knekk.split(':')
        dra.current = { slag: 'knekk', id, i: Number(i), forste: true }
        return
      }
      // Fokus på kurs: klikk legger på eller tar av, i stedet for å velge.
      if (traff && fokusKurs && onEndre && (p.punkter.some(x => x.id === traff) || p.foringer.some(x => x.id === traff))) {
        const veksle = (k: string | undefined) => (k === fokusKurs ? undefined : fokusKurs)
        onEndre(d => ({
          ...d,
          punkter: d.punkter.map(x => (x.id === traff ? { ...x, kursId: veksle(x.kursId) } : x)),
          foringer: d.foringer.map(x => (x.id === traff ? { ...x, kursId: veksle(x.kursId) } : x)),
        }))
        return
      }
      if (traff) {
        let ids = valgt
        if (e.shiftKey) { ids = valgt.includes(traff) ? valgt.filter(x => x !== traff) : [...valgt, traff]; onVelg(ids); return }
        if (!valgt.includes(traff)) { ids = [traff]; onVelg(ids) }
        if (traff !== 'malestokk') dra.current = { slag: 'flytt', fra: q, start: q, forste: true, ids, kopier: e.altKey }
        return
      }
      dra.current = { slag: 'boks', fra: q, legg: e.shiftKey, flyttet: false }
      return
    }
    if (!onEndre) return
    if (verktoy === 'foring' || verktoy === 'maal') {
      const forrige = linje?.[linje.length - 1]
      const { q: ny } = linjePunkt(klem(q), e.shiftKey, forrige)
      // Dobbeltklikket som avslutter gir to klikk på samme sted; det andre skal ikke bli et ledd.
      if (forrige && Math.hypot((ny.x - forrige.x) * W, (ny.y - forrige.y) * H) * t.s < 4) return
      if (verktoy === 'maal' && !linje) setMaaling(null)
      setLinje(f => [...(f ?? []), ny])
      return
    }
    const ute = q.x < 0 || q.y < 0 || q.x > 1 || q.y > 1
    if (ute) return
    if (verktoy === 'rom') { dra.current = { slag: 'rom', fra: q }; setUtkast({ x: q.x, y: q.y, w: 0, h: 0 }); return }
    if (verktoy === 'malestokk') {
      if (!malA) { setMalA(q); return }
      const a = malA
      setMalA(null)
      onEndre(d => ({ ...d, plan: { ...d.plan, malestokk: { a, b: q, meter: d.plan.malestokk?.meter ?? 0 } } }))
      onVelg(['malestokk'])
      return
    }
    if (verktoy === 'fare-anlegg' || verktoy === 'fare-montor') {
      const id = crypto.randomUUID()
      const gjelder = verktoy === 'fare-anlegg' ? 'anlegg' : 'montor'
      onEndre(d => ({ ...d, farer: [...d.farer, { id, tittel: '', gjelder, s: 3, k: 3, tiltak: '', restS: 2, restK: 3, x: q.x, y: q.y }] }))
      onVelg([id])
      return
    }
    if (verktoy === 'punkt' && symbol) {
      const id = crypto.randomUUID()
      onEndre(d => ({ ...d, punkter: [...d.punkter, { id, type: symbol, x: q.x, y: q.y, kursId: (fokusKurs ?? aktivKurs) ?? undefined, vinkel: vinkel || undefined }] }))
    }
  }

  function flytt(e: React.PointerEvent<HTMLDivElement>) {
    const q = tilPlan(e.clientX, e.clientY)
    if (q) {
      const inne = q.x >= 0 && q.y >= 0 && q.x <= 1 && q.y <= 1
      onPeker?.(inne ? q : null)
      if (verktoy === 'foring' || verktoy === 'maal') {
        const r = linjePunkt(q, e.shiftKey, linje?.[linje.length - 1])
        setPeker(r.q); setFestet(r.festet)
      } else setPeker(q)
    }
    const d = dra.current
    if (!d || !q) return
    if (d.slag === 'pan') {
      setT(g => ({ ...g, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }))
    } else if (d.slag === 'boks') {
      d.flyttet = true
      setMarkering({ a: d.fra, b: q })
    } else if (d.slag === 'rom') {
      const k = klem(q)
      setUtkast({ x: Math.min(d.fra.x, k.x), y: Math.min(d.fra.y, k.y), w: Math.abs(k.x - d.fra.x), h: Math.abs(k.y - d.fra.y) })
    } else if (d.slag === 'knekk' && onEndre) {
      const { id, i } = d
      const ny = klem(q)
      onEndre(pp => ({ ...pp, foringer: pp.foringer.map(f => (f.id === id ? { ...f, pts: f.pts.map((v, j) => (j === i ? ny : v)) } : f)) }), !d.forste)
      d.forste = false
    } else if (d.slag === 'flytt' && onEndre) {
      if (d.forste && Math.hypot((q.x - d.start.x) * W, (q.y - d.start.y) * H) * t.s < 3) return
      let dx = q.x - d.fra.x, dy = q.y - d.fra.y
      if (e.shiftKey || orto) {
        // Låst til én akse, målt fra starten av draget.
        const tx = (q.x - d.start.x) * W, ty = (q.y - d.start.y) * H
        const maal = Math.abs(tx) >= Math.abs(ty) ? { x: q.x, y: d.start.y } : { x: d.start.x, y: q.y }
        dx = maal.x - d.fra.x; dy = maal.y - d.fra.y
      }
      if (d.forste && d.kopier) {
        // Alt+dra: kopiene er det som flyttes; originalene blir liggende. Regnet her, ikke i
        // oppdateringen, fordi de nye id-ene trengs med en gang.
        const r = dupliserUtvalg(p, d.ids, 0, 0)
        onEndre(() => r.p)
        d.ids = r.nye
        onVelg(r.nye)
      }
      const ids = d.ids
      onEndre(pp => flyttUtvalg(pp, ids, dx, dy), !d.forste || d.kopier)
      d.forste = false
      d.fra = { x: d.fra.x + dx, y: d.fra.y + dy }
    }
  }

  function opp(e: React.PointerEvent<HTMLDivElement>) {
    const d = dra.current
    dra.current = null
    if (d?.slag === 'boks') {
      setMarkering(null)
      if (!d.flyttet) { if (!d.legg) onVelg([]); return }
      const b = tilPlan(e.clientX, e.clientY) ?? d.fra
      const treff = iBoks(p, d.fra, b, id => !synlig(id))
      onVelg(d.legg ? [...new Set([...valgt, ...treff])] : treff)
    }
    if (d?.slag === 'rom' && utkast && onEndre) {
      const u = utkast
      setUtkast(null)
      if (u.w * W * t.s > 12 && u.h * H * t.s > 12) {
        const id = crypto.randomUUID()
        onEndre(pp => ({ ...pp, rom: [...pp.rom, { id, navn: `Rom ${pp.rom.length + 1}`, form: u, bruk: '', brukere: '', pavirkninger: [], notat: '' }] }))
        onVelg([id])
      }
    }
  }

  const markor = (x: number, y: number) => `translate(${x * W} ${y * H})`
  const erValgt = (id: string) => valgt.includes(id)
  const dempet = (kursId: string | undefined) => !!fokusKurs && kursId !== fokusKurs
  const pekerTekst = (pts: Pt[]) => { const m = lengdeLangs(pts, mpe); return m != null ? `${m.toLocaleString('nb-NO', { maximumFractionDigits: 2 })} m` : '' }
  const visLinje = linje && peker ? [...linje, peker] : linje
  const enFaring = valgt.length === 1 ? p.foringer.find(f => f.id === valgt[0]) : undefined
  const markorStil = rom || verktoy === 'hand' ? 'grab' : verktoy === 'velg' || lese ? 'default' : 'crosshair'

  const tegnPunkt = (pt: Punkt, ghost = false) => {
    const sym = getSymbol(pt.type)
    const sz = 22 * px
    const v = !ghost && erValgt(pt.id)
    const kurs = pt.kursId ? p.kurser.find(k => k.id === pt.kursId) : undefined
    const farge = kursFarge(p, pt.kursId)
    return (
      <g key={pt.id} data-id={ghost ? undefined : pt.id} className={ghost ? 'tm-ghost' : 'tm-punkt'} transform={markor(pt.x, pt.y)}
        opacity={ghost ? 0.55 : dempet(pt.kursId) ? 0.18 : 1}>
        {/* Treffflate: usynlig kvadrat, så hele symbolet er klikkbart uten en synlig skive. */}
        <rect x={-sz * 0.6} y={-sz * 0.6} width={sz * 1.2} height={sz * 1.2} fill="transparent" />
        {(v || ghost) && (
          <rect x={-sz * 0.66} y={-sz * 0.66} width={sz * 1.32} height={sz * 1.32} fill="none" stroke={VALGT}
            strokeWidth={(v ? 1.6 : 1) * px} strokeDasharray={ghost ? `${3 * px} ${2 * px}` : undefined} />
        )}
        {/* Hvit kant bak streken så symbolet leser over planen — samme symbol, bredere og hvitt. */}
        <g transform={`rotate(${pt.vinkel ?? 0}) scale(${sz / 24}) translate(-12 -12)`} stroke="#fff" fill="none" strokeWidth={4.5}
          strokeLinecap="square" strokeLinejoin="miter" color="#fff"
          dangerouslySetInnerHTML={{ __html: sym?.body ?? '<circle cx="12" cy="12" r="5"/>' }} />
        <g transform={`rotate(${pt.vinkel ?? 0}) scale(${sz / 24}) translate(-12 -12)`} stroke={kurs ? farge : BLEKK} fill="none" strokeWidth={1.8}
          strokeLinecap="square" strokeLinejoin="miter" color={kurs ? farge : BLEKK}
          dangerouslySetInnerHTML={{ __html: sym?.body ?? '<circle cx="12" cy="12" r="5"/>' }} />
        {kurs && !ghost && (
          <text x={sz * 0.62} y={-sz * 0.38} fontFamily={MONO} fontSize={10 * px} fontWeight={500} fill={farge}
            stroke="#fff" strokeWidth={3 * px} paintOrder="stroke">{kurs.nr}</text>
        )}
      </g>
    )
  }

  const tegnRom = (r: Rom, ghost = false) => {
    const a = romAreal(r, mpe)
    const v = !ghost && erValgt(r.id)
    const poly = r.polygon && r.polygon.length >= 3 ? r.polygon : null
    const strek = ghost ? VALGT : v ? VALGT : r.funnet === 'usikker' ? '#C77700' : BLEKK
    const sw = (v ? 2.5 : 1.25) * px, dash = v ? undefined : `${6 * px} ${4 * px}`
    const tx = poly ? (r.form.x + r.form.w / 2) * W : r.form.x * W + 8 * px
    const ty = poly ? (r.form.y + r.form.h / 2) * H - 4 * px : r.form.y * H + 18 * px
    const anker = poly ? 'middle' : undefined
    const form = (extra: Record<string, unknown>) => poly
      ? <polygon points={poly.map(q => `${q.x * W},${q.y * H}`).join(' ')} {...extra} />
      : <rect x={r.form.x * W} y={r.form.y * H} width={r.form.w * W} height={r.form.h * H} {...extra} />
    return (
      <g key={r.id} data-id={ghost ? undefined : r.id} className={ghost ? 'tm-ghost' : 'tm-rom'} opacity={ghost ? 0.7 : fokusKurs ? 0.35 : 1}>
        {(v || ghost) && form({ fill: 'rgba(33,96,212,0.05)', stroke: 'none', pointerEvents: 'none' })}
        {!ghost && form({ fill: 'none', stroke: 'transparent', strokeWidth: 10 * px, pointerEvents: 'stroke' })}
        {form({ fill: 'none', stroke: strek, strokeWidth: sw, strokeDasharray: dash, pointerEvents: 'none' })}
        <text x={tx} y={ty} textAnchor={anker} fontSize={11 * px} fontWeight={600} letterSpacing={0.5 * px} fill={BLEKK}
          stroke="#fff" strokeWidth={3 * px} paintOrder="stroke">{r.navn.toUpperCase()}</text>
        {a != null && (
          <text x={tx} y={ty + 14 * px} textAnchor={anker} fontFamily={MONO} fontSize={10 * px} fill={BLEKK} stroke="#fff" strokeWidth={3 * px} paintOrder="stroke">
            {a.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} m²{r.funnet === 'usikker' ? ' · sjekk' : ''}
          </text>
        )}
      </g>
    )
  }

  return (
    <div
      ref={boks}
      className={`tm-lerret${lese ? ' lese' : ''}`}
      style={{ cursor: dra.current?.slag === 'pan' ? 'grabbing' : markorStil }}
      onPointerDown={ned}
      onPointerMove={flytt}
      onPointerUp={opp}
      onPointerLeave={() => { setPeker(null); onPeker?.(null) }}
      onDoubleClick={e => {
        if ((verktoy === 'foring' || verktoy === 'maal') && !lese) { avsluttLinje(); return }
        if (verktoy !== 'velg') return
        const traff = (e.target as Element).closest('[data-id]')?.getAttribute('data-id')
        const pt = traff ? p.punkter.find(x => x.id === traff) ?? p.foringer.find(x => x.id === traff) : undefined
        if (pt?.kursId) { onFokusKurs?.(pt.kursId); return }
        const r = e.currentTarget.getBoundingClientRect()
        zoomRundt(2, e.clientX - r.left, e.clientY - r.top)
      }}
    >
      <div className="tm-side" style={{ width: W, height: H, transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, opacity: side ? 1 : 0 }}>
        <div className="tm-underlag" style={{ opacity: av.has('underlag') ? 0 : underlag.opasitet, filter: underlag.gra ? 'grayscale(1) contrast(0.85)' : undefined }}>
          {type === 'bilde' && url ? <img src={url} alt="" draggable={false} /> : null}
          {type === 'pdf' ? <canvas ref={lerret} /> : null}
        </div>
        {side && (
          <svg className="tm-lag" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {!av.has('rom') && p.rom.map(r => tegnRom(r))}
            {forslag?.rom.map(r => tegnRom(r, true))}
            {utkast && <rect x={utkast.x * W} y={utkast.y * H} width={utkast.w * W} height={utkast.h * H} fill="rgba(33,96,212,0.05)" stroke={VALGT} strokeWidth={1.5 * px} />}

            {p.plan.malestokk && !av.has('malestokk') && (() => {
              const m = p.plan.malestokk
              const v = erValgt('malestokk')
              return (
                <g data-id="malestokk" className="tm-mal">
                  <line x1={m.a.x * W} y1={m.a.y * H} x2={m.b.x * W} y2={m.b.y * H} stroke="transparent" strokeWidth={10 * px} />
                  <line x1={m.a.x * W} y1={m.a.y * H} x2={m.b.x * W} y2={m.b.y * H} stroke={VALGT} strokeWidth={(v ? 3 : 1.6) * px} />
                  {[m.a, m.b].map((q, i) => <line key={i} x1={q.x * W} y1={q.y * H - 6 * px} x2={q.x * W} y2={q.y * H + 6 * px} stroke={VALGT} strokeWidth={1.6 * px} />)}
                  <text x={(m.a.x + m.b.x) / 2 * W} y={(m.a.y + m.b.y) / 2 * H - 7 * px} fontSize={11.5 * px} textAnchor="middle" fill={VALGT} fontFamily={MONO} fontWeight={500}>
                    {m.meter > 0 ? `${m.meter.toLocaleString('nb-NO')} m` : 'Skriv lengden'}
                  </text>
                </g>
              )
            })()}
            {malA && (
              <g pointerEvents="none">
                <rect x={malA.x * W - 3 * px} y={malA.y * H - 3 * px} width={6 * px} height={6 * px} fill={VALGT} />
                {peker && <line x1={malA.x * W} y1={malA.y * H} x2={peker.x * W} y2={peker.y * H} stroke={VALGT} strokeWidth={1.6 * px} strokeDasharray={`${5 * px} ${4 * px}`} />}
              </g>
            )}

            {p.foringer.filter(f => synlig(f.id)).map(f => {
              const v = erValgt(f.id)
              const d = f.pts.map((q, i) => `${i ? 'L' : 'M'}${q.x * W} ${q.y * H}`).join(' ')
              return (
                <g key={f.id} data-id={f.id} className="tm-foring" opacity={dempet(f.kursId) ? 0.15 : 1}>
                  <path d={d} fill="none" stroke="transparent" strokeWidth={12 * px} />
                  {v && <path d={d} fill="none" stroke={VALGT} strokeWidth={6 * px} strokeOpacity={0.18} strokeLinejoin="miter" strokeLinecap="butt" />}
                  <path d={d} fill="none" stroke={kursFarge(p, f.kursId)} strokeWidth={(v ? 2.6 : 2) * px}
                    strokeDasharray={f.skjult ? `${8 * px} ${5 * px}` : undefined} strokeLinejoin="miter" strokeLinecap="butt" />
                </g>
              )
            })}
            {/* Grep på knekkpunktene til én valgt føring: dra for å flytte knekken. */}
            {enFaring && !lese && verktoy === 'velg' && enFaring.pts.map((q, i) => (
              <rect key={i} data-knekk={`${enFaring.id}:${i}`} x={q.x * W - 4 * px} y={q.y * H - 4 * px} width={8 * px} height={8 * px}
                fill="#fff" stroke={VALGT} strokeWidth={1.5 * px} className="tm-grep" />
            ))}

            {!av.has('punkter') && p.punkter.filter(pt => synlig(pt.id)).map(pt => tegnPunkt(pt))}
            {forslag?.punkter.map(pt => tegnPunkt(pt, true))}

            {!av.has('farer') && p.farer.filter(f => f.x != null && f.y != null).map((f, i) => {
              const v = erValgt(f.id)
              const r = 12 * px
              return (
                <g key={f.id} data-id={f.id} className="tm-fare" transform={markor(f.x!, f.y!)} opacity={fokusKurs ? 0.3 : 1}>
                  {v && <rect x={-r * 1.6} y={-r * 1.6} width={r * 3.2} height={r * 3.2} fill="none" stroke={VALGT} strokeWidth={1.6 * px} />}
                  {f.gjelder === 'anlegg'
                    ? <path d={`M0 ${-r * 1.15} L${r} ${r * 0.75} L${-r} ${r * 0.75}Z`} fill={FARGE[niva(f.s, f.k)]} stroke="#fff" strokeWidth={1.5 * px} />
                    : <rect x={-r * 0.9} y={-r * 0.9} width={r * 1.8} height={r * 1.8} fill={FARGE[niva(f.s, f.k)]} stroke="#fff" strokeWidth={1.5 * px} />}
                  <text y={(f.gjelder === 'anlegg' ? 5 : 4) * px} textAnchor="middle" fontSize={10 * px} fontFamily={MONO} fontWeight={500} fill="#fff">{i + 1}</text>
                </g>
              )
            })}

            {/* Det som tegnes nå: føring/måling med lengde ved markøren, stempelet som spøkelse. */}
            {visLinje && visLinje.length > 0 && (
              <g pointerEvents="none">
                <path d={visLinje.map((q, i) => `${i ? 'L' : 'M'}${q.x * W} ${q.y * H}`).join(' ')} fill="none"
                  stroke={verktoy === 'maal' ? VALGT : kursFarge(p, (fokusKurs ?? aktivKurs) ?? undefined)} strokeWidth={2 * px}
                  strokeDasharray={verktoy === 'maal' || foringSkjult ? `${8 * px} ${5 * px}` : undefined} />
                {visLinje.map((q, i) => <rect key={i} x={q.x * W - 2.5 * px} y={q.y * H - 2.5 * px} width={5 * px} height={5 * px} fill={VALGT} />)}
              </g>
            )}
            {maaling && (
              <g pointerEvents="none">
                <path d={maaling.map((q, i) => `${i ? 'L' : 'M'}${q.x * W} ${q.y * H}`).join(' ')} fill="none" stroke={VALGT} strokeWidth={2 * px} />
                {maaling.slice(1).map((q, i) => {
                  const a = maaling[i]
                  return (
                    <text key={i} x={(a.x + q.x) / 2 * W} y={(a.y + q.y) / 2 * H - 6 * px} fontSize={11 * px} textAnchor="middle" fill={VALGT} fontFamily={MONO} fontWeight={500}
                      stroke="#fff" strokeWidth={3 * px} paintOrder="stroke">{pekerTekst([a, q])}</text>
                  )
                })}
              </g>
            )}
            {festet && peker && <rect x={peker.x * W - 8 * px} y={peker.y * H - 8 * px} width={16 * px} height={16 * px} fill="none" stroke={VALGT} strokeWidth={1.8 * px} pointerEvents="none" />}
            {verktoy === 'punkt' && symbol && peker && !rom && tegnPunkt({ id: 'spokelse', type: symbol, x: peker.x, y: peker.y, vinkel, kursId: (fokusKurs ?? aktivKurs) ?? undefined }, true)}
            {visLinje && visLinje.length >= 2 && peker && mpe && (
              <text x={peker.x * W + 12 * px} y={peker.y * H - 10 * px} fontSize={11 * px} fill={VALGT} fontFamily={MONO} fontWeight={500}
                stroke="#fff" strokeWidth={3.5 * px} paintOrder="stroke" pointerEvents="none">
                {pekerTekst(visLinje.slice(-2))}{visLinje.length > 2 ? `  ·  ${pekerTekst(visLinje)}` : ''}
              </text>
            )}
            {markering && (() => {
              const kryss = markering.b.x < markering.a.x
              const x = Math.min(markering.a.x, markering.b.x) * W, y = Math.min(markering.a.y, markering.b.y) * H
              return (
                <rect x={x} y={y} width={Math.abs(markering.b.x - markering.a.x) * W} height={Math.abs(markering.b.y - markering.a.y) * H}
                  fill={kryss ? 'rgba(31,122,63,0.07)' : 'rgba(33,96,212,0.05)'} stroke={kryss ? '#1F7A3F' : VALGT}
                  strokeWidth={1.2 * px} strokeDasharray={kryss ? `${5 * px} ${3 * px}` : undefined} pointerEvents="none" />
              )
            })()}
          </svg>
        )}
      </div>
      {!side && <div className="tm-tom">{feil ? `Kunne ikke vise planen: ${feil}` : url ? 'Henter planen …' : 'Ingen plan ennå.'}</div>}
    </div>
  )
}
