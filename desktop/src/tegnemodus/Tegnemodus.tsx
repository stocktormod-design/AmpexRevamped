import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft, Check, ChevronRight, Copy, Crosshair, Eye, EyeOff, Hand, Link2, MousePointer2, Plus, Printer, Redo2,
  RotateCcw, RotateCw, Ruler, Search, Spline, Square, Trash2, TriangleAlert, Undo2, Upload, X,
} from 'lucide-react'
import {
  foringLengde, hoydeFor, kursFarge, kursfortegnelse, mangler, meterPerEnhet, nesteKursNr, romAreal, romFor,
  standardHoyde, tomProsjektering, type Fare, type Kurs, type Prosjektering as Dok, type Pt,
} from '@delt/prosjektering'
import { SYMBOLS, getSymbol } from '@delt/symbols'
import {
  dupliserUtvalg, flyttUtvalg, kursAvUtvalg, roterUtvalg, settKurs, slagFor, slettUtvalg, sokKommandoer,
} from '@delt/tegning-redigering'
import {
  delLenke, delTegning, hentTegning, lagreTegning, lastOppPlan, planUrl, stoppDeling, type Eier,
} from '@/lib/tegningslag-lager'
import { gruppeFor, lagKursfortegnelse } from '@delt/kursforslag'
import type { Analyse } from '@/lib/tegningsanalyse'
import { Knapp } from '@/ui/kit'
import { Lerret, type Kontroll, type Verktoy } from './Lerret'
import { FareFane, KompetanseFane, KursFane, Oversikt, RomFane, Seksjon, SjaFane, Tekst, type Endre } from './dokument'

/**
 * TEGNEMODUSEN (Tormod 30.10: «oversiktlig, lett, intuitivt, avansert» — se
 * docs/TEGNEMODUS_RESEARCH.md for hva som er tatt fra AutoCAD, DDS-CAD, Revit, Bluebeam og Figma).
 *
 * Fullskjerm over kontoret. Ett lerret, ett hjem (Velg), ingen dialoger:
 *  - venstre: KURSENE (tavla), LAGENE og SYMBOLENE — det du styrer tegningen med;
 *  - høyre: EGENSKAPENE til det valgte, og dokumentet bak (kursfortegnelse, rom, risiko);
 *  - nederst: markøren i meter, målestokken, Ortho og Fest — som statuslinja i AutoCAD;
 *  - ⌘K: kommandolinja. Finner verktøy, symboler, kurser og rom ved navn.
 *
 * Samme modus for en ORDRE (planen lastes opp her) og en PROSJEKTTEGNING (planen er tegningen
 * fra mappetreet). Lagret dokument er det samme (`tegningslag`), og delingslenka er den samme.
 */

type HoyreFane = 'egenskaper' | 'kurser' | 'rom' | 'risiko' | 'oversikt'
type VenstreFane = 'kurser' | 'lag' | 'symboler'

const SYMBOLGRUPPER: { navn: string; typer: string[] }[] = [
  { navn: 'Uttak', typer: ['stikk-jord', 'stikk', 'stikk-3fas', 'data', 'tilkobling'] },
  { navn: 'Brytere', typer: ['bryter', 'bryter-2pol', 'serievender', 'dimmer'] },
  { navn: 'Lys', typer: ['lyspunkt', 'downlight', 'armatur', 'utelys'] },
  { navn: 'Varme og styring', typer: ['termostat', 'varmekabel', 'ovn', 'varmepumpe', 'bereder', 'sensor', 'lysfoler'] },
  { navn: 'Tavle og bokser', typer: ['fordeling', 'jordfeil', 'koblingsboks', 'koblingsboks-innfelt', 'elbillader', 'komfyr', 'motor', 'vifte'] },
  { navn: 'Brann', typer: ['royk', 'melder', 'klokke', 'sirene', 'summer', 'adresseledd', 'alarmsender', 'dorholder'] },
  { navn: 'Data og tele', typer: ['data-dobbel', 'fiber-dobbel', 'tele-dobbel', 'rack'] },
  { navn: 'Adgang og sikring', typer: ['kortleser', 'kortleser-tastatur', 'inngangsenhet', 'utgangsenhet', 'utpasseringsknapp', 'nodapner', 'magnetkontakt', 'ir-detektor', 'kamera', 'kamera-dome', 'ranskontakt', 'nokkelsafe', 'blinklampe'] },
]
const STANDARD_SIST = ['stikk-jord', 'lyspunkt', 'bryter', 'dimmer', 'downlight', 'termostat', 'varmekabel', 'data', 'fordeling']
const SIST_NOKKEL = 'tegnemodus:sist-brukte-symboler'
const lesSist = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(SIST_NOKKEL) ?? 'null'); if (Array.isArray(v) && v.length) return v.filter(t => getSymbol(t)).slice(0, 9) } catch { /* privat vindu */ }
  return STANDARD_SIST
}

const VERKTOY: { id: Verktoy; navn: string; tast: string; ikon: ReactNode }[] = [
  { id: 'velg', navn: 'Velg', tast: 'V', ikon: <MousePointer2 size={17} /> },
  { id: 'hand', navn: 'Hånd', tast: 'H', ikon: <Hand size={17} /> },
  { id: 'punkt', navn: 'Punkt', tast: 'P', ikon: null },
  { id: 'foring', navn: 'Føring', tast: 'F', ikon: <Spline size={17} /> },
  { id: 'rom', navn: 'Rom', tast: 'R', ikon: <Square size={17} /> },
  { id: 'fare-anlegg', navn: 'Risiko', tast: 'K', ikon: <TriangleAlert size={17} /> },
  { id: 'maal', navn: 'Mål', tast: 'M', ikon: <Ruler size={17} /> },
]

function SymbolIkon({ type, str = 18 }: { type: string; str?: number }) {
  const s = getSymbol(type)
  return (
    <svg viewBox="0 0 24 24" width={str} height={str} fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: s?.body ?? '' }} />
  )
}

const meter = (m: number | null | undefined, des = 1) => (m == null ? '–' : `${m.toLocaleString('nb-NO', { maximumFractionDigits: des })} m`)

export function Tegnemodus({ eier, tittel, sti, tilbake, fastPlan, jobbtekst = '' }: {
  eier: Eier
  tittel: string
  sti: { navn: string; href?: string }[]
  tilbake: string
  /** Prosjekttegning: planen er tegningen fra mappetreet og kan ikke byttes her. */
  fastPlan?: { key: string; type: 'pdf' | 'bilde' }
  /** Det risikoforslagene leser i tillegg til tegningen: ordretittel, beskrivelse, materiell. */
  jobbtekst?: string
}) {
  const [dok, setDok] = useState<Dok | null>(null)
  const [radId, setRadId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [status, setStatus] = useState<'lagret' | 'lagrer' | 'endret' | null>(null)
  const [verktoy, setVerktoy] = useState<Verktoy>('velg')
  const [symbol, setSymbol] = useState<string>(() => lesSist()[0])
  const [sist, setSist] = useState<string[]>(lesSist)
  const [valgt, setValgt] = useState<string[]>([])
  const [foringSkjult, setForingSkjult] = useState(true)
  const [aktivKurs, setAktivKurs] = useState<string | null>(null)
  const [fokusKurs, setFokusKurs] = useState<string | null>(null)
  const [skjult, setSkjult] = useState<Set<string>>(new Set())
  const [underlag, setUnderlag] = useState({ opasitet: 1, gra: false })
  const [orto, setOrto] = useState(false)
  const [fest, setFest] = useState(true)
  const [vinkel, setVinkel] = useState(0)
  const [peker, setPeker] = useState<Pt | null>(null)
  const [maaling, setMaaling] = useState<{ pts: Pt[]; meter: number | null } | null>(null)
  const [aspekt, setAspekt] = useState<number | null>(null)
  const [hoyre, setHoyre] = useState<HoyreFane>('egenskaper')
  const [venstre, setVenstre] = useState<VenstreFane>('kurser')
  const [palett, setPalett] = useState(false)
  const [taster, setTaster] = useState(false)
  const [kopiert, setKopiert] = useState(false)
  const [laster, setLaster] = useState(false)
  const [analyse, setAnalyse] = useState<Analyse | null>(null)
  const [analyserer, setAnalyserer] = useState<string | null>(null)
  const historie = useRef<Dok[]>([])
  const fremtid = useRef<Dok[]>([])
  const utklipp = useRef<{ dok: Dok; ids: string[]; n: number } | null>(null)
  const fil = useRef<HTMLInputElement>(null)
  const kontroll = useRef<Kontroll | null>(null)
  const eierNokkel = 'ordre' in eier ? `o:${eier.ordre}` : `t:${eier.tegning}`

  // ── Hent og lagre ─────────────────────────────────────────────────────────
  useEffect(() => {
    let levende = true
    hentTegning(eier).then(r => {
      if (!levende) return
      let d = r?.data ?? tomProsjektering()
      // Prosjekttegningen ER planen: dokumentet peker på den, så delingslenka og utskriften vet hva den er.
      if (fastPlan && (d.plan.key !== fastPlan.key || d.plan.type !== fastPlan.type)) d = { ...d, plan: { ...d.plan, key: fastPlan.key, type: fastPlan.type } }
      setDok(d); setRadId(r?.id ?? null); setToken(r?.del_token ?? null)
    }).catch(e => { if (levende) setFeil(e instanceof Error ? e.message : String(e)) })
    return () => { levende = false }
  }, [eierNokkel]) // eslint-disable-line react-hooks/exhaustive-deps

  const key = dok?.plan.key ?? null
  useEffect(() => {
    if (!key) { setUrl(null); return }
    let levende = true
    planUrl(key).then(u => { if (levende) setUrl(u) }).catch(e => { if (levende) setFeil(e.message) })
    return () => { levende = false }
  }, [key])

  /** Alle endringer går hit: angresteg (med mindre det er fortsettelsen av samme drag) og lagring. */
  const endre: Endre = useCallback((fn, samme) => {
    setDok(d => {
      if (!d) return d
      if (!samme) { historie.current = [...historie.current.slice(-79), d]; fremtid.current = [] }
      return fn(d)
    })
    setStatus('endret')
  }, [])

  const lagrer = useRef(false)
  const radRef = useRef<string | null>(null)
  radRef.current = radId
  useEffect(() => {
    if (status !== 'endret' || !dok) return
    const id = setTimeout(async () => {
      if (lagrer.current) return
      lagrer.current = true
      setStatus('lagrer')
      try {
        const ny = await lagreTegning(eier, radRef.current, dok)
        setRadId(ny)
        setStatus(s => (s === 'lagrer' ? 'lagret' : s))
      } catch (e) {
        setFeil(e instanceof Error ? e.message : String(e))
        setStatus('endret')
      } finally { lagrer.current = false }
    }, 700)
    return () => clearTimeout(id)
  }, [dok, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const angre = useCallback(() => {
    const forrige = historie.current.pop()
    if (!forrige) return
    setDok(d => { if (d) fremtid.current.push(d); return forrige })
    setStatus('endret')
  }, [])
  const gjor = useCallback(() => {
    const neste = fremtid.current.pop()
    if (!neste) return
    setDok(d => { if (d) historie.current.push(d); return neste })
    setStatus('endret')
  }, [])

  // ── Utvalg og verktøy ─────────────────────────────────────────────────────
  const velg = useCallback((ids: string[]) => {
    setValgt(ids)
    if (ids.length) setHoyre('egenskaper')
    const k = ids.length === 1 && dok?.kurser.some(x => x.id === ids[0]) ? ids[0] : null
    if (k) setAktivKurs(k)
  }, [dok])

  const velgSymbol = useCallback((t: string) => {
    setSymbol(t); setVerktoy('punkt'); setVinkel(0)
    setSist(s => {
      const n = [t, ...s.filter(x => x !== t)].slice(0, 9)
      try { localStorage.setItem(SIST_NOKKEL, JSON.stringify(n)) } catch { /* privat vindu */ }
      return n
    })
  }, [])

  const synligeIder = useCallback((d: Dok) => [
    ...(skjult.has('punkter') ? [] : d.punkter.filter(x => !skjult.has(`type:${x.type}`) && !skjult.has(`kurs:${x.kursId ?? 'ingen'}`)).map(x => x.id)),
    ...d.foringer.filter(x => !skjult.has(x.skjult ? 'skjult' : 'apen') && !skjult.has(`kurs:${x.kursId ?? 'ingen'}`)).map(x => x.id),
    ...(skjult.has('farer') ? [] : d.farer.filter(x => x.x != null).map(x => x.id)),
  ], [skjult])

  const kursAvValgte = useCallback(() => {
    if (!dok) return
    const ids = valgt.filter(id => dok.punkter.some(x => x.id === id) || dok.foringer.some(x => x.id === id))
    let kursId = ''
    if (ids.length) {
      // Kursen får navnet til rommet det første punktet står i (DDS-CAD 11).
      const forste = dok.punkter.find(x => ids.includes(x.id))
      const navn = forste ? romFor(forste, dok.rom)?.navn ?? '' : ''
      const r = kursAvUtvalg(dok, ids, navn)
      kursId = r.kursId
      endre(() => r.p)
    } else {
      kursId = crypto.randomUUID()
      endre(d => ({ ...d, kurser: [...d.kurser, { id: kursId, nr: nesteKursNr(d.kurser), navn: '', vern: '', rcd: '', kabel: '', forlegning: '', merknad: '' }] }))
    }
    setAktivKurs(kursId); setValgt([kursId]); setHoyre('egenskaper'); setVenstre('kurser')
  }, [dok, valgt, endre])

  // Kursfortegnelsen av tegningen: punktene uten kurs fordeles, tomme felt fylles. Ett angre-steg.
  const [beskjed, setBeskjed] = useState<string | null>(null)
  useEffect(() => { if (!beskjed) return; const t = setTimeout(() => setBeskjed(null), 6000); return () => clearTimeout(t) }, [beskjed])
  const autoKurser = useCallback(() => {
    if (!dok) return
    const r = lagKursfortegnelse(dok)
    if (!r.nye.length && !r.fylt) { setBeskjed('Ingenting å fordele'); return }
    endre(() => r.p)
    setVenstre('kurser'); setHoyre('kurser'); setValgt(r.nye)
    setBeskjed(`${r.nye.length} nye kurser${r.fylt ? ` · ${r.fylt} fylt ut` : ''}`)
  }, [dok, endre])

  const veksleLag = (k: string) => setSkjult(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  // ── Analysen: rom og symboler fra PDF-en, som forslag ─────────────────────
  async function analyser(bytes?: ArrayBuffer) {
    setAnalyse(null); setAnalyserer('Henter tegningen …')
    try {
      const { analyserPdf } = await import('@/lib/tegningsanalyse')
      let data = bytes
      if (!data) {
        const svar = await fetch(url ?? '')
        if (!svar.ok) throw new Error('Fikk ikke hentet planen')
        data = await svar.arrayBuffer()
      }
      setAnalyse(await analyserPdf(data, setAnalyserer))
    } catch (e) { setFeil(`Klarte ikke lese tegningen: ${e instanceof Error ? e.message : String(e)}`) } finally { setAnalyserer(null) }
  }
  const godtaForslag = useCallback(() => {
    const a = analyse
    if (!a) return
    endre(d => ({ ...d, rom: [...d.rom, ...a.rom], punkter: [...d.punkter, ...a.punkter], plan: { ...d.plan, malestokk: d.plan.malestokk ?? a.malestokk } }))
    setAnalyse(null)
  }, [analyse, endre])

  async function velgFil(f: File | undefined) {
    if (!f) return
    setLaster(true); setFeil(null)
    try {
      const { key: k, type } = await lastOppPlan(f)
      endre(d => ({ ...d, plan: { ...d.plan, key: k, type, malestokk: null } }))
      if (type === 'pdf') void analyser(await f.arrayBuffer())
    } catch (e) { setFeil(e instanceof Error ? e.message : String(e)) } finally { setLaster(false) }
  }

  async function del() {
    if (!dok) return
    try {
      const id = radRef.current ?? await lagreTegning(eier, null, dok)
      setRadId(id)
      const t = await delTegning(id, token)
      setToken(t)
      await navigator.clipboard.writeText(delLenke(t)).catch(() => {})
      setKopiert(true); setTimeout(() => setKopiert(false), 1800)
    } catch (e) { setFeil(e instanceof Error ? e.message : String(e)) }
  }

  // ── Tastaturet ────────────────────────────────────────────────────────────
  const tilstand = useRef({ dok, valgt, verktoy, fokusKurs, analyse, palett, taster, sist })
  tilstand.current = { dok, valgt, verktoy, fokusKurs, analyse, palett, taster, sist }
  useEffect(() => {
    const tast = (e: KeyboardEvent) => {
      const s = tilstand.current
      const mod = e.metaKey || e.ctrlKey
      // ⌘K er kommandolinja her inne — fanges før kontorets egen Ctrl+K (assistenten).
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopImmediatePropagation(); setPalett(v => !v); return }
      if (s.palett) return
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      const d = s.dok
      if (!d) return
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) gjor(); else angre(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); gjor(); return }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); velg(synligeIder(d)); return }
      if (mod && e.key.toLowerCase() === 'c' && s.valgt.length) { utklipp.current = { dok: d, ids: s.valgt, n: 0 }; return }
      if (mod && (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'd')) {
        e.preventDefault()
        const kilde = e.key.toLowerCase() === 'd' ? { dok: d, ids: s.valgt, n: 0 } : utklipp.current
        if (!kilde || !kilde.ids.length) return
        kilde.n += 1
        const fra = dupliserUtvalg({ ...d, punkter: kilde.dok.punkter, foringer: kilde.dok.foringer, farer: kilde.dok.farer }, kilde.ids, 0.015 * kilde.n, 0.015 * kilde.n)
        const nye = new Set(fra.nye)
        endre(x => ({
          ...x,
          punkter: [...x.punkter, ...fra.p.punkter.filter(y => nye.has(y.id))],
          foringer: [...x.foringer, ...fra.p.foringer.filter(y => nye.has(y.id))],
          farer: [...x.farer, ...fra.p.farer.filter(y => nye.has(y.id))],
        }))
        setValgt(fra.nye)
        return
      }
      if (mod || e.altKey) return
      if (e.key === 'Escape') {
        // Ett nivå ut: forslag → verktøy → fokus → utvalg.
        if (s.taster) { setTaster(false); return }
        if (s.analyse) { setAnalyse(null); return }
        if (s.verktoy !== 'velg') { setVerktoy('velg'); return }
        if (s.fokusKurs) { setFokusKurs(null); return }
        setValgt([]); return
      }
      if (e.key === 'Enter' && s.analyse && s.verktoy !== 'foring' && s.verktoy !== 'maal') { e.preventDefault(); godtaForslag(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.valgt.length) {
        e.preventDefault(); const ids = s.valgt; endre(x => slettUtvalg(x, ids)); setValgt([]); return
      }
      if (e.key.startsWith('Arrow') && s.valgt.length) {
        e.preventDefault()
        const steg = e.shiftKey ? 0.01 : 0.001
        const dx = e.key === 'ArrowLeft' ? -steg : e.key === 'ArrowRight' ? steg : 0
        const dy = e.key === 'ArrowUp' ? -steg : e.key === 'ArrowDown' ? steg : 0
        const ids = s.valgt; endre(x => flyttUtvalg(x, ids, dx, dy)); return
      }
      if (e.key === '.' || e.key === ',') {
        const g = e.key === '.' ? 90 : -90
        if (s.verktoy === 'punkt') setVinkel(v => (((v + g) % 360) + 360) % 360)
        else if (s.valgt.length) { const ids = s.valgt; endre(x => roterUtvalg(x, ids, g)) }
        return
      }
      if (e.key === '?') { setTaster(v => !v); return }
      if (e.key === '0') { kontroll.current?.tilpass(); return }
      if (e.key === '+' || e.key === '=') { kontroll.current?.zoom(1.4); return }
      if (e.key === '-') { kontroll.current?.zoom(1 / 1.4); return }
      if (/^[1-9]$/.test(e.key)) { const t = s.sist[Number(e.key) - 1]; if (t) velgSymbol(t); return }
      const k = e.key.toLowerCase()
      if (k === 'c') { kursAvValgte(); return }
      if (k === 'o') { setOrto(v => !v); return }
      if (k === 's') { setFest(v => !v); return }
      if (k === 'u') { setVerktoy('malestokk'); return }
      if (k === 'k') { setVerktoy(e.shiftKey ? 'fare-montor' : 'fare-anlegg'); return }
      const v = VERKTOY.find(x => x.tast.toLowerCase() === k)
      if (v) setVerktoy(v.id)
    }
    window.addEventListener('keydown', tast, true)
    return () => window.removeEventListener('keydown', tast, true)
  }, [angre, gjor, velg, synligeIder, endre, godtaForslag, velgSymbol, kursAvValgte])

  const mangel = useMemo(() => (dok ? mangler(dok) : []), [dok])
  const mpe = dok && aspekt ? meterPerEnhet(dok.plan.malestokk, aspekt) : null

  if (feil && !dok) return <div className="tm"><div className="tm-tom">{feil}</div></div>
  if (!dok) return <div className="tm"><div className="tm-tom">Henter tegningen …</div></div>

  const fokus = fokusKurs ? dok.kurser.find(k => k.id === fokusKurs) : undefined

  return (
    <div className="tm">
      {/* ── Toppstripa ── */}
      <header className="tm-topp">
        <a className="tm-tilbake" href={tilbake} title="Tilbake"><ArrowLeft size={16} /></a>
        <nav className="tm-sti">
          {sti.map((s, i) => (
            <span key={i}>{s.href ? <a href={s.href}>{s.navn}</a> : s.navn}<ChevronRight size={12} /></span>
          ))}
          <strong>{tittel}</strong>
          <em>{status === 'lagrer' ? 'Lagrer …' : status === 'endret' ? 'Endret' : status === 'lagret' ? 'Lagret' : ''}</em>
        </nav>
        <button type="button" className="tm-sok" onClick={() => setPalett(true)}>
          <Search size={14} /> <span>Søk etter verktøy, symbol, kurs eller rom</span> <kbd>⌘K</kbd>
        </button>
        <div className="tm-topp-hoyre">
          <button type="button" className="tm-ikon" onClick={angre} title="Angre (⌘Z)" disabled={!historie.current.length}><Undo2 size={16} /></button>
          <button type="button" className="tm-ikon" onClick={gjor} title="Gjør om (⌘⇧Z)" disabled={!fremtid.current.length}><Redo2 size={16} /></button>
          {token ? (
            <>
              <button type="button" className="tm-lenke" onClick={del} title="Kopier lenka">{kopiert ? <Check size={14} /> : <Copy size={14} />} {kopiert ? 'Kopiert' : 'Kopier lenke'}</button>
              <Knapp stil="naken" onClick={async () => { if (radId && confirm('Trekke tilbake lenka? Den som har den, kommer ikke inn lenger.')) { await stoppDeling(radId); setToken(null) } }}>Stopp deling</Knapp>
              <Knapp stil="primar" onClick={() => window.open(delLenke(token), '_blank')}><Printer size={14} /> Se som kunden</Knapp>
            </>
          ) : <Knapp stil="primar" onClick={del}><Link2 size={14} /> Del med kunden</Knapp>}
        </div>
      </header>

      <div className="tm-kropp">
        {/* ── Venstre: kurser, lag, symboler ── */}
        <aside className="tm-venstre">
          <nav className="tm-faner">
            {(['kurser', 'lag', 'symboler'] as VenstreFane[]).map(f => (
              <button key={f} type="button" className={venstre === f ? 'valgt' : ''} onClick={() => setVenstre(f)}>
                {f === 'kurser' ? 'Kurser' : f === 'lag' ? 'Lag' : 'Symboler'}
              </button>
            ))}
          </nav>
          <div className="tm-panel">
            {venstre === 'kurser' && (
              <KursListe dok={dok} aspekt={aspekt} valgt={valgt} aktivKurs={aktivKurs} fokusKurs={fokusKurs} skjult={skjult}
                velg={velg} setAktivKurs={setAktivKurs} setFokusKurs={setFokusKurs} veksleLag={veksleLag} nyKurs={kursAvValgte} autoKurser={autoKurser} />
            )}
            {venstre === 'lag' && (
              <LagListe dok={dok} mpe={mpe} skjult={skjult} veksleLag={veksleLag} underlag={underlag} setUnderlag={setUnderlag} velg={velg} />
            )}
            {venstre === 'symboler' && <SymbolPanel symbol={verktoy === 'punkt' ? symbol : null} sist={sist} velg={velgSymbol} />}
          </div>
        </aside>

        {/* ── Lerretet ── */}
        <main className="tm-midt">
          <div className="tm-verktoy">
            {VERKTOY.map(v => (
              <button key={v.id} type="button" className={verktoy === v.id || (v.id === 'fare-anlegg' && verktoy === 'fare-montor') ? 'valgt' : ''}
                onClick={() => (v.id === 'punkt' ? velgSymbol(symbol) : setVerktoy(v.id))} title={`${v.navn} (${v.tast})`}>
                {v.id === 'punkt' ? <SymbolIkon type={symbol} /> : v.ikon}
                <kbd>{v.tast}</kbd>
              </button>
            ))}
            <span className="tm-skille" />
            <button type="button" onClick={kursAvValgte} title="Kurs av valgte (C)"><span className="tm-c">C</span></button>
          </div>

          {dok.plan.key ? (
            <Lerret url={url} type={dok.plan.type} p={dok} verktoy={verktoy} symbol={symbol} valgt={valgt} onVelg={velg} onEndre={endre}
              foringSkjult={foringSkjult} aktivKurs={aktivKurs} fokusKurs={fokusKurs} onFokusKurs={setFokusKurs} skjult={skjult}
              underlag={underlag} orto={orto} fest={fest} vinkel={vinkel} forslag={analyse} onPeker={setPeker} onMaal={setMaaling}
              onSide={(w, h) => setAspekt(w / h)} kontroll={kontroll} />
          ) : (
            <button type="button" className="tm-slipp" onClick={() => fil.current?.click()}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void velgFil(e.dataTransfer.files[0]) }}>
              <Upload size={24} />
              <strong>{laster ? 'Laster opp …' : 'Plantegning'}</strong>
              <span>PDF · PNG · JPG</span>
            </button>
          )}

          {/* Valg for verktøyet som er i bruk — flyter øverst, som Figmas kontekstlinje. */}
          {(verktoy === 'foring' || verktoy === 'punkt' || fokus) && (
            <div className="tm-flyt tm-kontekst">
              {fokus && <span className="tm-fokus"><i style={{ background: kursFarge(dok, fokus.id) }} />Fokus: kurs {fokus.nr}{fokus.navn ? ` · ${fokus.navn}` : ''}<button type="button" onClick={() => setFokusKurs(null)}><X size={13} /></button></span>}
              {verktoy === 'foring' && (
                <div className="tm-veksle">
                  <button type="button" className={foringSkjult ? 'valgt' : ''} onClick={() => setForingSkjult(true)}>Skjult</button>
                  <button type="button" className={!foringSkjult ? 'valgt' : ''} onClick={() => setForingSkjult(false)}>Åpent</button>
                </div>
              )}
              {verktoy === 'punkt' && (
                <span className="tm-stempel"><SymbolIkon type={symbol} str={16} />{getSymbol(symbol)?.label}{vinkel ? ` · ${vinkel}°` : ''}
                  <button type="button" onClick={() => setVinkel(v => (v + 90) % 360)} title="Roter (.)"><RotateCw size={13} /></button></span>
              )}
              {(verktoy === 'foring' || verktoy === 'punkt') && !fokus && (
                <label className="tm-kursvalg">
                  <i style={{ background: kursFarge(dok, aktivKurs ?? undefined) }} />
                  <select value={aktivKurs ?? ''} onChange={e => { if (e.target.value === '+') kursAvValgte(); else setAktivKurs(e.target.value || null) }}>
                    <option value="">Ingen kurs</option>
                    {dok.kurser.map(k => <option key={k.id} value={k.id}>Kurs {k.nr}{k.navn ? ` · ${k.navn}` : ''}</option>)}
                    <option value="+">Ny kurs …</option>
                  </select>
                </label>
              )}
            </div>
          )}

          {/* Forslagene fra PDF-en: godta eller forkast, som i Bluebeam/Fieldwire. */}
          {(analyserer || analyse) ? (
            <div className="tm-flyt tm-forslag">
              {analyserer ? <span>{analyserer}</span> : analyse && (analyse.rom.length || analyse.punkter.length) ? (
                <>
                  <span><strong>{[analyse.rom.length ? `${analyse.rom.length} rom` : null, analyse.punkter.length ? `${analyse.punkter.length} symboler` : null].filter(Boolean).join(' og ')}</strong>
                    {analyse.nevner ? ` · 1:${analyse.nevner}` : ''}{analyse.rom.some(r => r.funnet === 'usikker') ? ` · ${analyse.rom.filter(r => r.funnet === 'usikker').length} usikre` : ''}
                    {analyse.ukjente.length ? ` · ukjent: ${analyse.ukjente.slice(0, 3).join(', ')}${analyse.ukjente.length > 3 ? ' …' : ''}` : ''}</span>
                  <Knapp stil="naken" onClick={() => setAnalyse(null)}>Forkast <kbd>Esc</kbd></Knapp>
                  <Knapp stil="primar" onClick={godtaForslag}>Legg inn <kbd>↵</kbd></Knapp>
                </>
              ) : (
                <><span>Ingen funn</span><Knapp stil="naken" onClick={() => setAnalyse(null)}>OK</Knapp></>
              )}
            </div>
          ) : dok.plan.type === 'pdf' && url && dok.rom.length === 0 && dok.punkter.length === 0 ? (
            <button type="button" className="tm-flyt tm-finn" onClick={() => void analyser()}>Finn rom og symboler</button>
          ) : null}

          {taster && <Hurtigtaster lukk={() => setTaster(false)} />}
        </main>

        {/* ── Høyre: egenskaper og dokumentet ── */}
        <aside className="tm-hoyre">
          <nav className="tm-faner">
            {([['egenskaper', 'Egenskaper'], ['kurser', 'Fortegnelse'], ['rom', 'Rom'], ['risiko', 'Risiko'], ['oversikt', 'Oversikt']] as [HoyreFane, string][]).map(([f, n]) => (
              <button key={f} type="button" className={hoyre === f ? 'valgt' : ''} onClick={() => setHoyre(f)}>{n}</button>
            ))}
          </nav>
          <div className="tm-panel">
            {feil && <div className="tm-feil">{feil}<button type="button" onClick={() => setFeil(null)}><X size={13} /></button></div>}
            {hoyre === 'egenskaper' && (
              <Egenskaper dok={dok} endre={endre} valgt={valgt} velg={velg} mpe={mpe} kursAvValgte={kursAvValgte}
                fokus={id => setFokusKurs(id)} visRom={() => setHoyre('rom')} visRisiko={() => setHoyre('risiko')}  />
            )}
            {hoyre === 'kurser' && (
              <KursFane dok={dok} endre={endre} valgt={valgt[0] ?? null} setValgt={id => velg(id ? [id] : [])} aspekt={aspekt}
                aktivKurs={aktivKurs} setAktivKurs={setAktivKurs} fokus={id => setFokusKurs(id)} tegnForing={id => { setAktivKurs(id); setVerktoy('foring') }} />
            )}
            {hoyre === 'rom' && <RomFane dok={dok} endre={endre} valgt={valgt[0] ?? null} setValgt={id => { setValgt(id ? [id] : []); if (id) kontroll.current?.vis([id]) }} />}
            {hoyre === 'risiko' && <Risiko dok={dok} endre={endre} valgt={valgt[0] ?? null} setValgt={id => setValgt(id ? [id] : [])} setVerktoy={setVerktoy} jobbtekst={jobbtekst} />}
            {hoyre === 'oversikt' && <Oversikt dok={dok} endre={endre} mangel={mangel} lastOpp={fastPlan ? undefined : () => fil.current?.click()} laster={laster} />}
          </div>
        </aside>
      </div>

      {/* ── Statuslinja ── */}
      <footer className="tm-status">
        <span className="tm-xy">{peker && mpe ? `X ${meter(peker.x * mpe.x, 2)}   Y ${meter(peker.y * mpe.y, 2)}` : peker ? 'Ingen målestokk' : ''}</span>
        <button type="button" className={`tm-pille${dok.plan.malestokk?.meter ? '' : ' varsel'}`} onClick={() => { if (dok.plan.malestokk) velg(['malestokk']); else setVerktoy('malestokk') }}
          title="Målestokk (U)">
          {dok.plan.malestokk?.meter ? `Målestokk ${meter(dok.plan.malestokk.meter, 2)}` : 'Sett målestokk'}
        </button>
        {maaling && <span className="tm-maaling"><Ruler size={13} /> {meter(maaling.meter, 2)}</span>}
        {valgt.length > 0 && <span className="tm-antall">{valgt.length} valgt</span>}
        <span className="tm-hjelp">{beskjed ? <strong>{beskjed}</strong> : fokus ? `Fokus · kurs ${fokus.nr}` : ''}</span>
        <button type="button" className={`tm-pille${orto ? ' paa' : ''}`} onClick={() => setOrto(v => !v)} title="Ortho (O)">Ortho</button>
        <button type="button" className={`tm-pille${fest ? ' paa' : ''}`} onClick={() => setFest(v => !v)} title="Fest (S)">Fest</button>
        <button type="button" className="tm-pille" onClick={() => kontroll.current?.tilpass()} title="Tilpass (0)">Tilpass</button>
        <button type="button" className="tm-pille" onClick={() => setTaster(v => !v)} title="Hurtigtaster">?</button>
      </footer>

      {palett && (
        <Kommandolinje dok={dok} lukk={() => setPalett(false)} kommandoer={lagKommandoer({
          dok, setVerktoy, velgSymbol, velg, kontroll, kursAvValgte, autoKurser, setFokusKurs, setOrto, setFest, setUnderlag, veksleLag,
          analyser: dok.plan.type === 'pdf' && url ? () => void analyser() : null, setHoyre, setTaster, del,
        })} />
      )}
      <input ref={fil} type="file" accept="image/png,image/jpeg,application/pdf" hidden onChange={e => void velgFil(e.target.files?.[0])} />
    </div>
  )
}

// ── Venstre: kursene ─────────────────────────────────────────────────────

function KursListe({ dok, aspekt, valgt, aktivKurs, fokusKurs, skjult, velg, setAktivKurs, setFokusKurs, veksleLag, nyKurs, autoKurser }: {
  dok: Dok; aspekt: number | null; valgt: string[]; aktivKurs: string | null; fokusKurs: string | null; skjult: Set<string>
  velg: (ids: string[]) => void; setAktivKurs: (id: string | null) => void; setFokusKurs: (id: string | null) => void
  veksleLag: (k: string) => void; nyKurs: () => void; autoKurser: () => void
}) {
  const rader = useMemo(() => kursfortegnelse(dok, aspekt), [dok, aspekt])
  const uten = dok.punkter.filter(p => !p.kursId)
  const fordelbare = uten.filter(p => gruppeFor(p.type)).length
  return (
    <>
      <div className="tm-panel-hode">
        <span>Tavla</span>
        <button type="button" className="tm-ny" onClick={nyKurs} title="Ny kurs (C)"><Plus size={14} /> Ny kurs</button>
      </div>
      {fordelbare > 0 && (
        <button type="button" className="tm-auto" onClick={autoKurser}>
          <strong>Lag kursfortegnelse</strong>
          <small>{fordelbare}</small>
        </button>
      )}
      <ul className="tm-liste">
        {rader.map(({ kurs: k, punkter, lengde }) => {
          const n = punkter.reduce((s, [, x]) => s + x, 0)
          const av = skjult.has(`kurs:${k.id}`)
          return (
            <li key={k.id} className={`${valgt.includes(k.id) ? 'valgt' : ''}${aktivKurs === k.id ? ' aktiv' : ''}${av ? ' av' : ''}`}>
              <button type="button" className="tm-rad" onClick={() => { setAktivKurs(k.id); velg([k.id]) }} onDoubleClick={() => setFokusKurs(k.id)}>
                <span className="tm-nr" style={{ background: kursFarge(dok, k.id) }}>{k.nr}</span>
                <span className="tm-rad-tekst">{k.navn || 'Uten navn'}<small>{[k.vern, `${n} pkt`, lengde != null ? meter(lengde) : null].filter(Boolean).join(' · ')}</small></span>
              </button>
              <button type="button" className={`tm-mini${fokusKurs === k.id ? ' paa' : ''}`} onClick={() => setFokusKurs(fokusKurs === k.id ? null : k.id)} title="Fokus"><Crosshair size={14} /></button>
              <button type="button" className="tm-mini" onClick={() => veksleLag(`kurs:${k.id}`)} title={av ? 'Vis' : 'Skjul'}>{av ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </li>
          )
        })}
        {uten.length > 0 && (
          <li className={skjult.has('kurs:ingen') ? 'av' : ''}>
            <button type="button" className="tm-rad" onClick={() => velg(uten.map(p => p.id))}>
              <span className="tm-nr tom">–</span>
              <span className="tm-rad-tekst">Uten kurs<small>{uten.length} pkt</small></span>
            </button>
            <span className="tm-mini" />
            <button type="button" className="tm-mini" onClick={() => veksleLag('kurs:ingen')}>{skjult.has('kurs:ingen') ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </li>
        )}
      </ul>
    </>
  )
}

// ── Venstre: lagene ──────────────────────────────────────────────────────

function LagListe({ dok, mpe, skjult, veksleLag, underlag, setUnderlag, velg }: {
  dok: Dok; mpe: { x: number; y: number } | null; skjult: Set<string>; veksleLag: (k: string) => void
  underlag: { opasitet: number; gra: boolean }; setUnderlag: (u: { opasitet: number; gra: boolean }) => void; velg: (ids: string[]) => void
}) {
  const typer = new Map<string, string[]>()
  for (const p of dok.punkter) typer.set(p.type, [...(typer.get(p.type) ?? []), p.id])
  const sk = dok.foringer.filter(f => f.skjult), ap = dok.foringer.filter(f => !f.skjult)
  const sum = (fs: typeof sk) => (mpe ? fs.reduce((s, f) => s + (foringLengde(f, mpe) ?? 0), 0) : null)
  const rad = (k: string, navn: ReactNode, tall: ReactNode, ids?: string[]) => (
    <li key={k} className={skjult.has(k) ? 'av' : ''}>
      <button type="button" className="tm-rad" onClick={() => ids?.length && velg(ids)} disabled={!ids?.length}>
        <span className="tm-rad-tekst">{navn}</span><span className="tm-tall">{tall}</span>
      </button>
      <button type="button" className="tm-mini" onClick={() => veksleLag(k)} title={skjult.has(k) ? 'Vis' : 'Skjul'}>{skjult.has(k) ? <EyeOff size={14} /> : <Eye size={14} />}</button>
    </li>
  )
  return (
    <>
      <div className="tm-panel-hode"><span>Underlag</span></div>
      <div className="tm-underlag-valg">
        <input type="range" min={0.15} max={1} step={0.05} value={underlag.opasitet} onChange={e => setUnderlag({ ...underlag, opasitet: Number(e.target.value) })} />
        <label><input type="checkbox" checked={underlag.gra} onChange={e => setUnderlag({ ...underlag, gra: e.target.checked })} /> Grå</label>
        <button type="button" className="tm-mini" onClick={() => veksleLag('underlag')}>{skjult.has('underlag') ? <EyeOff size={14} /> : <Eye size={14} />}</button>
      </div>
      <div className="tm-panel-hode"><span>Lag</span></div>
      <ul className="tm-liste">
        {rad('rom', 'Rom', dok.rom.length, dok.rom.map(r => r.id))}
        {rad('punkter', 'Punkter', dok.punkter.length, dok.punkter.map(p => p.id))}
        {[...typer].sort((a, b) => b[1].length - a[1].length).map(([t, ids]) => (
          <li key={t} className={`tm-under${skjult.has(`type:${t}`) ? ' av' : ''}`}>
            <button type="button" className="tm-rad" onClick={() => velg(ids)}>
              <SymbolIkon type={t} str={16} /><span className="tm-rad-tekst">{getSymbol(t)?.label ?? t}</span><span className="tm-tall">{ids.length}</span>
            </button>
            <button type="button" className="tm-mini" onClick={() => veksleLag(`type:${t}`)}>{skjult.has(`type:${t}`) ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </li>
        ))}
        {rad('skjult', 'Føringer, skjult', <>{sk.length}{sum(sk) != null ? ` · ${meter(sum(sk))}` : ''}</>, sk.map(f => f.id))}
        {rad('apen', 'Føringer, åpent', <>{ap.length}{sum(ap) != null ? ` · ${meter(sum(ap))}` : ''}</>, ap.map(f => f.id))}
        {rad('farer', 'Risiko', dok.farer.filter(f => f.x != null).length, dok.farer.filter(f => f.x != null).map(f => f.id))}
        {rad('malestokk', 'Målestokk', dok.plan.malestokk ? meter(dok.plan.malestokk.meter, 2) : '–', dok.plan.malestokk ? ['malestokk'] : [])}
      </ul>
    </>
  )
}

// ── Venstre: symbolene ───────────────────────────────────────────────────

function SymbolPanel({ symbol, sist, velg }: { symbol: string | null; sist: string[]; velg: (t: string) => void }) {
  const [sok, setSok] = useState('')
  const treff = sok ? sokKommandoer(SYMBOLS.map(s => ({ navn: s.label, ord: s.id, id: s.id })), sok) : null
  const knapp = (t: string, tast?: number) => (
    <button key={t} type="button" className={`tm-sym${symbol === t ? ' valgt' : ''}`} onClick={() => velg(t)} title={getSymbol(t)?.label}>
      <SymbolIkon type={t} str={22} />
      <span>{getSymbol(t)?.label}</span>
      {tast ? <kbd>{tast}</kbd> : null}
    </button>
  )
  return (
    <>
      <label className="tm-symsok"><Search size={14} /><input value={sok} onChange={e => setSok(e.target.value)} placeholder="Søk: stikk, dimmer, termostat …" /></label>
      {treff ? <div className="tm-symnett">{treff.map(t => knapp(t.id))}</div> : (
        <>
          <div className="tm-panel-hode"><span>Sist brukt</span><small>tast 1–9</small></div>
          <div className="tm-symnett">{sist.map((t, i) => knapp(t, i + 1))}</div>
          {SYMBOLGRUPPER.map(g => (
            <div key={g.navn}>
              <div className="tm-panel-hode"><span>{g.navn}</span></div>
              <div className="tm-symnett">{g.typer.filter(t => getSymbol(t)).map(t => knapp(t))}</div>
            </div>
          ))}
          <p className="tm-svak">Symbolene følger NEK 144 / IEC 60617.</p>
        </>
      )}
    </>
  )
}

// ── Høyre: egenskapene til det valgte ────────────────────────────────────

const KURSFELT: { k: keyof Kurs; navn: string; hjelp: string }[] = [
  { k: 'vern', navn: 'Vern', hjelp: 'C16' },
  { k: 'rcd', navn: 'Jordfeilvern', hjelp: '30 mA type A' },
  { k: 'kabel', navn: 'Kabel', hjelp: 'IFXI 3G2,5' },
  { k: 'forlegning', navn: 'Forlegning', hjelp: 'A1' },
]

function Egenskaper({ dok, endre, valgt, velg, mpe, kursAvValgte, fokus, visRom, visRisiko }: {
  dok: Dok; endre: Endre; valgt: string[]; velg: (ids: string[]) => void; mpe: { x: number; y: number } | null
  kursAvValgte: () => void; fokus: (id: string) => void; visRom: () => void; visRisiko: () => void
}) {
  const ider = valgt.filter(id => slagFor(dok, id))
  if (!ider.length) {
    const telling = { punkter: dok.punkter.length, kurser: dok.kurser.length, rom: dok.rom.length, uten: dok.punkter.filter(p => !p.kursId).length }
    return (
      <>
        <div className="tm-tall-rad">
          <div><strong>{telling.punkter}</strong><span>punkter</span></div>
          <div><strong>{telling.kurser}</strong><span>kurser</span></div>
          <div><strong>{telling.rom}</strong><span>rom</span></div>
          <div className={telling.uten ? 'varsel' : ''}><strong>{telling.uten}</strong><span>uten kurs</span></div>
        </div>
      </>
    )
  }
  const kursSelect = (verdi: string | undefined | null, onEndre: (v: string | null) => void, blandet = false) => (
    <label className="pj-felt"><span>Kurs</span>
      <select value={blandet ? '*' : verdi ?? ''} onChange={e => { if (e.target.value === '+') kursAvValgte(); else if (e.target.value !== '*') onEndre(e.target.value || null) }}>
        {blandet && <option value="*">Blandet</option>}
        <option value="">Ingen</option>
        {dok.kurser.map(k => <option key={k.id} value={k.id}>{k.nr}{k.navn ? ` · ${k.navn}` : ''}</option>)}
        <option value="+">Ny kurs av valgte …</option>
      </select>
    </label>
  )
  const slett = <div className="pj-rad"><span /><Knapp stil="naken" onClick={() => { endre(d => slettUtvalg(d, ider)); velg([]) }}><Trash2 size={14} /> Slett <kbd>⌫</kbd></Knapp></div>

  // ── Flere valgt: bare det som er felles. ──
  if (ider.length > 1) {
    const pkt = dok.punkter.filter(p => ider.includes(p.id))
    const kl = [...pkt, ...dok.foringer.filter(f => ider.includes(f.id))]
    const kurser = new Set(kl.map(x => x.kursId ?? ''))
    const typer = new Map<string, number>()
    for (const p of pkt) typer.set(p.type, (typer.get(p.type) ?? 0) + 1)
    const hoyder = new Set(pkt.map(p => hoydeFor(p)))
    return (
      <Seksjon tittel={`${ider.length} valgt`}>
        <p className="tm-svak">{[...typer].map(([t, n]) => `${n} ${getSymbol(t)?.label.toLowerCase() ?? t}`).join(', ')}
          {ider.length - pkt.length > 0 ? `${pkt.length ? ', ' : ''}${ider.length - pkt.length} annet` : ''}</p>
        {kl.length > 0 && kursSelect([...kurser][0] || null, v => endre(d => settKurs(d, ider, v)), kurser.size > 1)}
        {kl.length > 0 && <Knapp onClick={kursAvValgte}>Ny kurs av valgte <kbd>C</kbd></Knapp>}
        {pkt.length > 0 && (
          <label className="pj-felt"><span>Høyde over gulv (cm)</span>
            <input type="number" min={0} step={5} placeholder={hoyder.size > 1 ? 'Blandet' : String([...hoyder][0] ?? '')} defaultValue=""
              onKeyDown={e => {
                if (e.key !== 'Enter') return
                const v = (e.target as HTMLInputElement).value
                const ids = new Set(pkt.map(p => p.id))
                endre(d => ({ ...d, punkter: d.punkter.map(p => (ids.has(p.id) ? { ...p, hoyde: v === '' ? undefined : Number(v) } : p)) }))
              }} />
          </label>
        )}
        {pkt.length > 0 && (
          <div className="pj-rad">
            <span>Roter</span>
            <button type="button" className="tm-mini" onClick={() => endre(d => roterUtvalg(d, ider, -90))} title=","><RotateCcw size={14} /></button>
            <button type="button" className="tm-mini" onClick={() => endre(d => roterUtvalg(d, ider, 90))} title="."><RotateCw size={14} /></button>
          </div>
        )}
        {slett}
      </Seksjon>
    )
  }

  const id = ider[0]
  const slag = slagFor(dok, id)
  if (slag === 'punkt') {
    const p = dok.punkter.find(x => x.id === id)!
    const settP = (fn: (x: typeof p) => typeof p, samme = false) => endre(d => ({ ...d, punkter: d.punkter.map(x => (x.id === id ? fn(x) : x)) }), samme)
    const rom = romFor(p, dok.rom)
    return (
      <Seksjon tittel={getSymbol(p.type)?.label ?? p.type}>
        <label className="pj-felt"><span>Symbol</span>
          <select value={p.type} onChange={e => settP(x => ({ ...x, type: e.target.value }))}>
            {SYMBOLGRUPPER.map(g => <optgroup key={g.navn} label={g.navn}>{g.typer.filter(t => getSymbol(t)).map(t => <option key={t} value={t}>{getSymbol(t)!.label}</option>)}</optgroup>)}
          </select>
        </label>
        {kursSelect(p.kursId, v => settP(x => ({ ...x, kursId: v ?? undefined })))}
        <div className="pj-to">
          <label className="pj-felt"><span>Høyde (cm)</span>
            <input type="number" min={0} step={5} value={p.hoyde ?? ''} placeholder={standardHoyde(p.type) != null ? `${standardHoyde(p.type)} std.` : 'Tak'}
              onChange={e => settP(x => ({ ...x, hoyde: e.target.value === '' ? undefined : Number(e.target.value) }), true)} />
          </label>
          <div className="pj-felt"><span>Vinkel</span>
            <div className="pj-rad">
              <button type="button" className="tm-mini" onClick={() => endre(d => roterUtvalg(d, [id], -90))}><RotateCcw size={14} /></button>
              <b>{p.vinkel ?? 0}°</b>
              <button type="button" className="tm-mini" onClick={() => endre(d => roterUtvalg(d, [id], 90))}><RotateCw size={14} /></button>
            </div>
          </div>
        </div>
        <Tekst etikett="Merknad" rader={1} verdi={p.notat ?? ''} hjelp="IP44, komfyrvakt, dobbel …" onEndre={v => settP(x => ({ ...x, notat: v || undefined }), true)} />
        <p className="tm-svak">{rom ? `I ${rom.navn}` : 'Ikke i noe rom'}{mpe ? ` · X ${meter(p.x * mpe.x, 2)}, Y ${meter(p.y * mpe.y, 2)}` : ''}</p>
        {slett}
      </Seksjon>
    )
  }
  if (slag === 'foring') {
    const f = dok.foringer.find(x => x.id === id)!
    const settF = (fn: (x: typeof f) => typeof f) => endre(d => ({ ...d, foringer: d.foringer.map(x => (x.id === id ? fn(x) : x)) }))
    return (
      <Seksjon tittel="Føringsvei">
        {kursSelect(f.kursId, v => settF(x => ({ ...x, kursId: v ?? undefined })))}
        <div className="tm-veksle">
          <button type="button" className={f.skjult ? 'valgt' : ''} onClick={() => settF(x => ({ ...x, skjult: true }))}>Skjult (i vegg)</button>
          <button type="button" className={!f.skjult ? 'valgt' : ''} onClick={() => settF(x => ({ ...x, skjult: false }))}>Åpent (på vegg)</button>
        </div>
        <p className="tm-svak">{meter(foringLengde(f, mpe))} målt på planen · {f.pts.length} knekkpunkter.</p>
        {slett}
      </Seksjon>
    )
  }
  if (slag === 'kurs') {
    const k = dok.kurser.find(x => x.id === id)!
    const settK = (fn: (x: Kurs) => Kurs) => endre(d => ({ ...d, kurser: d.kurser.map(x => (x.id === id ? fn(x) : x)) }), true)
    const pkt = dok.punkter.filter(p => p.kursId === id)
    const len = dok.foringer.filter(f => f.kursId === id).reduce((s, f) => s + (foringLengde(f, mpe) ?? 0), 0)
    return (
      <Seksjon tittel={`Kurs ${k.nr}`} hoyre={<span className="tm-nr" style={{ background: kursFarge(dok, id) }}>{k.nr}</span>}>
        <div className="pj-to">
          <Tekst etikett="Nr" rader={1} verdi={k.nr} onEndre={v => settK(x => ({ ...x, nr: v }))} />
          <Tekst etikett="Forsyner" rader={1} verdi={k.navn} hjelp="Stue stikk" onEndre={v => settK(x => ({ ...x, navn: v }))} />
        </div>
        <div className="pj-to">
          {KURSFELT.map(f => <Tekst key={f.k} etikett={f.navn} rader={1} verdi={k[f.k]} hjelp={f.hjelp} onEndre={v => settK(x => ({ ...x, [f.k]: v }))} />)}
        </div>
        <Tekst etikett="Merknad" rader={1} verdi={k.merknad} onEndre={v => settK(x => ({ ...x, merknad: v }))} />
        <p className="tm-svak">{pkt.length} punkter{mpe && len ? ` · ${meter(len)} føring` : ''}</p>
        <div className="pj-rad">
          <Knapp onClick={() => fokus(id)}><Crosshair size={14} /> Fokus</Knapp>
          <Knapp stil="naken" onClick={() => velg(pkt.map(p => p.id))}>Velg punktene</Knapp>
        </div>
        {slett}
      </Seksjon>
    )
  }
  if (slag === 'rom') {
    const r = dok.rom.find(x => x.id === id)!
    return (
      <Seksjon tittel={r.navn}>
        <Tekst etikett="Navn" rader={1} verdi={r.navn} onEndre={v => endre(d => ({ ...d, rom: d.rom.map(x => (x.id === id ? { ...x, navn: v } : x)) }), true)} />
        <p className="tm-svak">{meter(romAreal(r, mpe)) === '–' ? '– m²' : `${romAreal(r, mpe)!.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} m²`}
          {r.funnet === 'usikker' ? ' · funnet på tegningen, men arealet stemte ikke med påskriften' : r.funnet ? ' · funnet på tegningen' : ''}</p>
        {r.funnet === 'usikker' && <Knapp stil="naken" onClick={() => endre(d => ({ ...d, rom: d.rom.map(x => (x.id === id ? { ...x, funnet: 'bekreftet' } : x)) }))}>Det stemmer</Knapp>}
        <Knapp stil="naken" onClick={visRom}>Bruk, brukere og påvirkninger →</Knapp>
        {slett}
      </Seksjon>
    )
  }
  if (slag === 'fare') {
    const f = dok.farer.find(x => x.id === id)!
    const settF = (fn: (x: Fare) => Fare) => endre(d => ({ ...d, farer: d.farer.map(x => (x.id === id ? fn(x) : x)) }), true)
    return (
      <Seksjon tittel={f.tittel || 'Fare'}>
        <Tekst etikett="Fare" rader={1} verdi={f.tittel} hjelp="Fuktig miljø på bad" onEndre={v => settF(x => ({ ...x, tittel: v }))} />
        <div className="tm-veksle">
          <button type="button" className={f.gjelder === 'anlegg' ? 'valgt' : ''} onClick={() => settF(x => ({ ...x, gjelder: 'anlegg' }))}>Anlegget</button>
          <button type="button" className={f.gjelder === 'montor' ? 'valgt' : ''} onClick={() => settF(x => ({ ...x, gjelder: 'montor' }))}>Montøren</button>
        </div>
        <Knapp stil="naken" onClick={visRisiko}>Sannsynlighet, konsekvens og tiltak →</Knapp>
        {slett}
      </Seksjon>
    )
  }
  if (slag === 'malestokk' && dok.plan.malestokk) {
    return (
      <Seksjon tittel="Målestokk">
        <label className="pj-felt"><span>Meter</span>
          <input type="number" min={0} step={0.01} value={dok.plan.malestokk.meter || ''} autoFocus
            onChange={e => endre(d => ({ ...d, plan: { ...d.plan, malestokk: d.plan.malestokk && { ...d.plan.malestokk, meter: Number(e.target.value) } } }), true)} />
        </label>
        {slett}
      </Seksjon>
    )
  }
  return null
}

function Risiko({ dok, endre, valgt, setValgt, setVerktoy, jobbtekst }: {
  dok: Dok; endre: Endre; valgt: string | null; setValgt: (id: string | null) => void; setVerktoy: (v: Verktoy) => void; jobbtekst: string
}) {
  const [del, setDel] = useState<'farer' | 'sja' | 'kompetanse'>('farer')
  return (
    <>
      <div className="tm-veksle tm-veksle-full">
        <button type="button" className={del === 'farer' ? 'valgt' : ''} onClick={() => setDel('farer')}>Farer</button>
        <button type="button" className={del === 'sja' ? 'valgt' : ''} onClick={() => setDel('sja')}>SJA</button>
        <button type="button" className={del === 'kompetanse' ? 'valgt' : ''} onClick={() => setDel('kompetanse')}>Kompetanse</button>
      </div>
      {del === 'farer' && <FareFane dok={dok} endre={endre} valgt={valgt} setValgt={setValgt} setVerktoy={setVerktoy} jobbtekst={jobbtekst} />}
      {del === 'sja' && <SjaFane dok={dok} endre={endre} />}
      {del === 'kompetanse' && <KompetanseFane dok={dok} endre={endre} />}
    </>
  )
}

// ── ⌘K ───────────────────────────────────────────────────────────────────

type Kommando = { id: string; navn: string; ord?: string; gruppe: string; tast?: string; ikon?: ReactNode; kjor: () => void }

function lagKommandoer(k: {
  dok: Dok; setVerktoy: (v: Verktoy) => void; velgSymbol: (t: string) => void; velg: (ids: string[]) => void
  kontroll: React.MutableRefObject<Kontroll | null>; kursAvValgte: () => void; autoKurser: () => void; setFokusKurs: (id: string | null) => void
  setOrto: (f: (v: boolean) => boolean) => void; setFest: (f: (v: boolean) => boolean) => void
  setUnderlag: (f: (u: { opasitet: number; gra: boolean }) => { opasitet: number; gra: boolean }) => void; veksleLag: (k: string) => void
  analyser: (() => void) | null; setHoyre: (f: HoyreFane) => void; setTaster: (v: boolean) => void; del: () => void
}): Kommando[] {
  const { dok } = k
  const vis = (ids: string[]) => { k.velg(ids); k.kontroll.current?.vis(ids) }
  return [
    ...VERKTOY.filter(v => v.id !== 'punkt').map(v => ({ id: `v:${v.id}`, navn: v.navn, ord: 'verktøy', gruppe: 'Verktøy', tast: v.tast, ikon: v.ikon, kjor: () => k.setVerktoy(v.id) })),
    { id: 'v:montor', navn: 'Risiko for montøren', ord: 'fare', gruppe: 'Verktøy', tast: '⇧K', kjor: () => k.setVerktoy('fare-montor') },
    { id: 'v:mal', navn: 'Sett målestokk', ord: 'kalibrer skala', gruppe: 'Verktøy', tast: 'U', kjor: () => k.setVerktoy('malestokk') },
    { id: 'kurs:ny', navn: 'Ny kurs av valgte', ord: 'krets lag kurs', gruppe: 'Kurser', tast: 'C', kjor: k.kursAvValgte },
    { id: 'kurs:auto', navn: 'Lag kursfortegnelse av tegningen', ord: 'auto automatisk fordel kurser vern kabel', gruppe: 'Kurser', kjor: k.autoKurser },
    { id: 'kurs:uten', navn: 'Velg alle punkter uten kurs', ord: 'kurs mangler', gruppe: 'Kurser', kjor: () => vis(dok.punkter.filter(p => !p.kursId).map(p => p.id)) },
    ...dok.kurser.map(x => ({
      id: `kurs:${x.id}`, navn: `Kurs ${x.nr}${x.navn ? ` · ${x.navn}` : ''}`, ord: `krets ${x.vern} fokus`, gruppe: 'Kurser',
      ikon: <span className="tm-nr" style={{ background: kursFarge(dok, x.id) }}>{x.nr}</span>,
      kjor: () => { k.setFokusKurs(x.id); vis([...dok.punkter.filter(p => p.kursId === x.id).map(p => p.id)]) },
    })),
    ...SYMBOLS.map(s => ({ id: `s:${s.id}`, navn: s.label, ord: `symbol ${s.id} stemple`, gruppe: 'Symboler', ikon: <SymbolIkon type={s.id} str={16} />, kjor: () => k.velgSymbol(s.id) })),
    ...[...new Set(dok.punkter.map(p => p.type))].map(t => ({
      id: `alle:${t}`, navn: `Velg alle: ${getSymbol(t)?.label ?? t}`, ord: 'marker', gruppe: 'Velg', kjor: () => k.velg(dok.punkter.filter(p => p.type === t).map(p => p.id)),
    })),
    ...dok.rom.map(r => ({ id: `rom:${r.id}`, navn: r.navn, ord: 'rom', gruppe: 'Rom', ikon: <Square size={14} />, kjor: () => vis([r.id]) })),
    ...(k.analyser ? [{ id: 'finn', navn: 'Finn rom og symboler på tegningen', ord: 'analyse gjenkjenn auto les', gruppe: 'Tegningen', kjor: k.analyser }] : []),
    { id: 'tilpass', navn: 'Tilpass visningen', ord: 'zoom hele', gruppe: 'Visning', tast: '0', kjor: () => k.kontroll.current?.tilpass() },
    { id: 'orto', navn: 'Ortho av/på', ord: 'rett vinkel 90', gruppe: 'Visning', tast: 'O', kjor: () => k.setOrto(v => !v) },
    { id: 'fest', navn: 'Fest til punkter av/på', ord: 'snapp snap', gruppe: 'Visning', tast: 'S', kjor: () => k.setFest(v => !v) },
    { id: 'gra', navn: 'Grått underlag av/på', ord: 'bleik plan', gruppe: 'Visning', kjor: () => k.setUnderlag(u => ({ ...u, gra: !u.gra })) },
    { id: 'svak', navn: 'Svakere underlag', ord: 'bleik plan', gruppe: 'Visning', kjor: () => k.setUnderlag(u => ({ ...u, opasitet: Math.max(0.15, u.opasitet - 0.25) })) },
    ...[['rom', 'Rom'], ['punkter', 'Punkter'], ['skjult', 'Skjulte føringer'], ['apen', 'Åpne føringer'], ['farer', 'Risiko']].map(([id, n]) => ({
      id: `lag:${id}`, navn: `Vis/skjul ${n.toLowerCase()}`, ord: 'lag', gruppe: 'Visning', kjor: () => k.veksleLag(id),
    })),
    { id: 'kf', navn: 'Kursfortegnelse', ord: 'tabell', gruppe: 'Dokument', kjor: () => k.setHoyre('kurser') },
    { id: 'risiko', navn: 'Risikovurdering', ord: 'farer sja matrise', gruppe: 'Dokument', kjor: () => k.setHoyre('risiko') },
    { id: 'del', navn: 'Del med kunden', ord: 'lenke', gruppe: 'Dokument', kjor: k.del },
    { id: 'taster', navn: 'Hurtigtaster', ord: 'hjelp', gruppe: 'Hjelp', tast: '?', kjor: () => k.setTaster(true) },
  ]
}

function Kommandolinje({ kommandoer, lukk }: { dok: Dok; kommandoer: Kommando[]; lukk: () => void }) {
  const [sok, setSok] = useState('')
  const [i, setI] = useState(0)
  const treff = useMemo(() => sokKommandoer(kommandoer, sok).slice(0, 40), [kommandoer, sok])
  useEffect(() => setI(0), [sok])
  const kjor = (k: Kommando | undefined) => { if (!k) return; lukk(); k.kjor() }
  return (
    <div className="tm-palett-bak" onPointerDown={e => { if (e.target === e.currentTarget) lukk() }}>
      <div className="tm-palett" role="dialog">
        <label className="tm-palett-sok">
          <Search size={16} />
          <input autoFocus value={sok} onChange={e => setSok(e.target.value)} placeholder="Skriv en kommando, et symbol, en kurs eller et rom"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(treff.length - 1, x + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)) }
              if (e.key === 'Enter') { e.preventDefault(); kjor(treff[i]) }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); lukk() }
            }} />
        </label>
        <ul className="tm-palett-liste">
          {treff.map((k, n) => (
            <li key={k.id} className={n === i ? 'valgt' : ''} onPointerEnter={() => setI(n)} onClick={() => kjor(k)}>
              <span className="tm-palett-ikon">{k.ikon}</span>
              <span className="tm-palett-navn">{k.navn}</span>
              <small>{k.gruppe}</small>
              {k.tast && <kbd>{k.tast}</kbd>}
            </li>
          ))}
          {treff.length === 0 && <li className="tom">Ingenting heter det.</li>}
        </ul>
      </div>
    </div>
  )
}

function Hurtigtaster({ lukk }: { lukk: () => void }) {
  const rader: [string, string][] = [
    ['V H P F R K M', 'Velg, hånd, punkt, føring, rom, risiko, mål'],
    ['1–9', 'Sist brukte symboler'], ['.  ,', 'Roter 90°'], ['C', 'Ny kurs av valgte'],
    ['Dobbeltklikk punkt', 'Fokus på kursen'], ['Esc', 'Ett nivå ut'], ['Enter', 'Avslutt føring · legg inn forslag'],
    ['Shift', 'Rett vinkel · legg til i utvalget'], ['Alt + dra', 'Kopier'], ['Mellomrom + dra', 'Flytt planen'],
    ['Piler', 'Flytt litt (Shift: mer)'], ['⌘C ⌘V ⌘D', 'Kopier, lim inn, dupliser'], ['⌘Z ⌘⇧Z', 'Angre, gjør om'],
    ['⌘A', 'Velg alt synlig'], ['O  S', 'Ortho, fest'], ['0  +  −', 'Tilpass, zoom'], ['⌘K', 'Kommandolinja'],
  ]
  return (
    <div className="tm-flyt tm-taster" onPointerDown={e => e.stopPropagation()}>
      <div className="tm-panel-hode"><span>Hurtigtaster</span><button type="button" className="tm-mini" onClick={lukk}><X size={14} /></button></div>
      <dl>{rader.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
    </div>
  )
}
