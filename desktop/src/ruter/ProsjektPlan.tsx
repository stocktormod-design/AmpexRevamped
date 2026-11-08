import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ArrowLeft, ChevronRight, FileText, Folder, FolderUp, MapPin, Pencil, PenTool, Plus, Search, Trash2, X } from 'lucide-react'
import { kan } from '@delt/kontor-tilgang'
import { fremdrift, aapneTekst } from '@delt/prosjekt-fremdrift'
import { mappeSti, tellRekursivt, type MappeNode } from '@delt/tegning-tre'
import { useAuth } from '@/auth'
import { supabase } from '@/supabase'
import {
  flyttMappe, flyttTegning, hentProsjektPlan, omdopMappe, opprettMappe, slettMappe,
  tegningUrl, type PlanEnhet, type PlanMappe, type PlanOppgave, type PlanTegning, type ProsjektPlan as Data,
} from '@/lib/plan-lager'

/** Drag-typen vi bruker internt i treet (filer bruker «Files»). */
const TRE_TYPE = 'application/x-ampex-tre'
import { Beskjed, Knapp } from '@/ui/kit'
import { Planvisning, type Markor } from '@/ui/Planvisning'
import type { ImportPlan } from '@delt/tegning-import'
import { filerFraSlipp, filerFraVelger, kjorImport, planlegg, type Fremdrift, type Resultat, type SluppetFil } from '@/lib/tegning-import-lager'

/**
 * Ett prosjekt på kontoret — TRE + DOKUMENT (Tormod 2026-09-24: «det er
 * hovedsaklig at det skal være kjempe oversiktlig og lett å finne fram
 * tegninger»). Venstre: alt du leter etter — søk, fag, mappetreet med antall,
 * status og oppgaver. Høyre: tegningen du valgte, med statuslaget over.
 *
 * Finne fram er tastaturet: «/» søker, ↑/↓ blar mellom tegningene i lista,
 * Esc tømmer søket. Siste tegning huskes per prosjekt på denne PC-en.
 *
 * Kontoret kan rette en montert-status (en montør som glemte å trykke) — samme
 * felt og samme rad som telefonen skriver.
 */

const TYPE: Record<string, string> = {
  royk: 'Røykdetektor', varme: 'Varmedetektor', multi: 'Multikriteriedetektor', melder: 'Manuell melder',
  klokke: 'Brannklokke', sirene: 'Sirene', sentral: 'Brannsentral', annet: 'Annet',
}
const FAG: Record<string, string> = { elkraft: 'Elkraft', svakstrom: 'Svakstrøm', automasjon: 'Automasjon', annet: 'Annet' }
const GRONN = '#1F7A3F', GRA = '#8E8E93', ROD = '#B3261E', BLEKK = '#1D1D1F'
const DATO = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' })
const sisteNokkel = (id: string) => `siste-tegning:${id}`

function Ring({ andel, str = 56 }: { andel: number; str?: number }) {
  const r = str / 2 - 5, o = 2 * Math.PI * r
  return (
    <svg width={str} height={str} viewBox={`0 0 ${str} ${str}`} className="ring">
      <circle cx={str / 2} cy={str / 2} r={r} fill="none" stroke="var(--fyll)" strokeWidth="5" />
      <circle cx={str / 2} cy={str / 2} r={r} fill="none" stroke={andel >= 1 ? 'var(--gronn)' : 'var(--blekk)'} strokeWidth="5"
        strokeLinecap="round" strokeDasharray={o} strokeDashoffset={o * (1 - Math.max(0, Math.min(1, andel)))}
        transform={`rotate(-90 ${str / 2} ${str / 2})`} className="ring-bue" />
      <text x={str / 2} y={str / 2 + 4.5} textAnchor="middle" className="ring-tall">{Math.round(andel * 100)}</text>
    </svg>
  )
}

export function ProsjektPlan({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [aktivId, setAktivId] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [valgt, setValgt] = useState<string | null>(null)
  const [fokus, setFokus] = useState<{ x: number; y: number; n: number } | null>(null)
  const [lagrer, setLagrer] = useState(false)
  const [fane, setFane] = useState<'tegninger' | 'status'>('tegninger')
  const [sok, setSok] = useState('')
  const [fag, setFag] = useState<string | null>(null)
  const [lukket, setLukket] = useState<Set<string>>(new Set())
  const sokFelt = useRef<HTMLInputElement>(null)
  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'prosjekt.skriv')

  // Hierarki: ny mappe / nytt navn / intern drag. Skrivingene ligger i plan-lager.
  const [nyMappe, setNyMappe] = useState<{ parentId: string | null; under: string } | null>(null)
  const [redigerer, setRedigerer] = useState<{ id: string; navn: string } | null>(null)
  const [treNavn, setTreNavn] = useState('')
  const [draTre, setDraTre] = useState<{ type: 'mappe' | 'tegning'; id: string } | null>(null)
  const [slippPaa, setSlippPaa] = useState<string | null | 'rot'>(null)

  const last = () => hentProsjektPlan(id).then(setData).catch(e => setFeil(e instanceof Error ? e.message : String(e)))

  function startNyMappe(parentId: string | null, under: string) {
    setRedigerer(null); setNyMappe({ parentId, under }); setTreNavn('')
  }
  function startOmdop(m: { id: string; navn: string }) {
    setNyMappe(null); setRedigerer({ id: m.id, navn: m.navn }); setTreNavn(m.navn)
  }
  function avbrytTre() { setNyMappe(null); setRedigerer(null); setTreNavn('') }

  async function lagreTre() {
    const navn = treNavn.trim()
    if (!navn) return
    try {
      if (redigerer) await omdopMappe(redigerer.id, navn)
      else if (nyMappe) await opprettMappe(id, nyMappe.parentId, navn, profil?.id ?? null, profil?.company_id ?? null)
      avbrytTre()
      await last()
    } catch (x) {
      setFeil(x instanceof Error ? x.message : String(x))
    }
  }

  async function slettMappeMedInnhold(m: PlanMappe) {
    if (!data) return
    const innhold = m.parent_id ? data.mapper.find(x => x.id === m.parent_id)?.name ?? 'forelderen' : 'prosjektets rot'
    const n = tellRekursivt(m.id, mapper, tegninger)
    const sporsmal = n > 0
      ? `Slette «${m.name}»? ${n} ${n === 1 ? 'tegning' : 'tegninger'} og alle undermapper flyttes til ${innhold}.`
      : `Slette «${m.name}»?`
    if (!window.confirm(sporsmal)) return
    try {
      await slettMappe(m, data.mapper, data.tegninger)
      await last()
    } catch (x) {
      setFeil(x instanceof Error ? x.message : String(x))
    }
  }

  function treDragStart(e: DragEvent, v: { type: 'mappe' | 'tegning'; id: string }) {
    if (!kanSkrive) return
    e.dataTransfer.setData(TRE_TYPE, JSON.stringify(v))
    e.dataTransfer.effectAllowed = 'move'
    setDraTre(v)
  }
  function treDragOver(e: DragEvent, mal: string | 'rot') {
    if (!kanSkrive || !Array.from(e.dataTransfer.types).includes(TRE_TYPE)) return
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setSlippPaa(mal)
  }
  async function treSlipp(e: DragEvent, forelder: string | null) {
    if (!kanSkrive || !Array.from(e.dataTransfer.types).includes(TRE_TYPE)) return
    e.preventDefault(); e.stopPropagation()
    const raa = e.dataTransfer.getData(TRE_TYPE)
    setDraTre(null); setSlippPaa(null)
    if (!raa || !data) return
    try {
      const v = JSON.parse(raa) as { type: 'mappe' | 'tegning'; id: string }
      if (v.type === 'mappe') await flyttMappe(v.id, forelder, data.mapper)
      else await flyttTegning(v.id, forelder)
      await last()
    } catch (x) {
      setFeil(x instanceof Error ? x.message : String(x))
    }
  }
  useEffect(() => { void last() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── OneDrive-mappa inn: dra over siden, se hva som skjer, så skrives det ──
  const [dra, setDra] = useState(false)
  const [slipp, setSlipp] = useState<{ plan: ImportPlan; filer: SluppetFil[] } | null>(null)
  const [opplasting, setOpplasting] = useState<Fremdrift | null>(null)
  const [resultat, setResultat] = useState<Resultat | null>(null)
  const velger = useRef<HTMLInputElement>(null)
  const harFiler = (e: DragEvent) => kanSkrive && !opplasting && Array.from(e.dataTransfer.types).includes('Files')
  function forbered(filer: SluppetFil[]) {
    if (!data) return
    setResultat(null)
    const plan = planlegg(filer, data.mapper.map(m => ({ id: m.id, name: m.name, parentId: m.parent_id })),
      data.tegninger.map(t => ({ folderId: t.folder_id, name: t.name })))
    setSlipp({ plan, filer })
  }
  async function slippet(e: DragEvent) {
    e.preventDefault()
    setDra(false)
    if (!harFiler(e)) return
    try { forbered(await filerFraSlipp(e.dataTransfer)) } catch (x) { setFeil(`Kunne ikke lese mappa: ${x instanceof Error ? x.message : String(x)}`) }
  }
  async function leggInn() {
    if (!slipp) return
    const { plan, filer } = slipp
    setSlipp(null)
    try {
      const r = await kjorImport(id, plan, filer, setOpplasting)
      setResultat(r)
      if (r.lagtInn && !aktivId) setAktivId(plan.tegninger[0]?.id ?? null)
    } catch (x) {
      setFeil(x instanceof Error ? x.message : String(x))
    } finally {
      setOpplasting(null)
      await last()
    }
  }

  const mapper: MappeNode[] = useMemo(() => (data?.mapper ?? []).map(m => ({ id: m.id, name: m.name, parentId: m.parent_id })), [data])
  const tegninger = useMemo(() => (data?.tegninger ?? []).map(t => ({ ...t, folderId: t.folder_id })), [data])
  const sti = (t: PlanTegning) => mappeSti(t.folder_id, mapper).join(' / ')

  // Rekkefølgen tegningene står i på venstre side — også den ↑/↓ blar i.
  const treff = useMemo(() => {
    const ord = sok.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!ord.length && !fag) return null
    return tegninger.filter(t => {
      if (fag && t.discipline !== fag) return false
      const hay = [t.name, t.plan, FAG[t.discipline ?? ''], mappeSti(t.folder_id, mapper).join(' ')].join(' ').toLowerCase()
      return ord.every(o => hay.includes(o))
    })
  }, [sok, fag, tegninger, mapper])

  type Linje = { type: 'mappe'; id: string; navn: string; dybde: number; antall: number; apen: boolean } | { type: 'tegning'; t: PlanTegning; dybde: number }
  const linjer: Linje[] = useMemo(() => {
    const ut: Linje[] = []
    const gaa = (parent: string | null, dybde: number) => {
      for (const m of mapper.filter(x => x.parentId === parent)) {
        const apen = !lukket.has(m.id)
        ut.push({ type: 'mappe', id: m.id, navn: m.name, dybde, antall: tellRekursivt(m.id, mapper, tegninger), apen })
        if (apen) gaa(m.id, dybde + 1)
      }
      for (const t of tegninger.filter(x => (x.folder_id ?? null) === parent)) ut.push({ type: 'tegning', t, dybde })
    }
    gaa(null, 0)
    return ut
  }, [mapper, tegninger, lukket])
  const synligeTegninger = treff ?? linjer.flatMap(l => (l.type === 'tegning' ? [l.t] : []))

  // Åpner på tegningen du så på sist (på denne PC-en), ellers den med mest på.
  useEffect(() => {
    if (!data || aktivId) return
    const medFil = data.tegninger.filter(t => t.file_path)
    if (!medFil.length) return
    let sist: string | null = null
    try { sist = localStorage.getItem(sisteNokkel(id)) } catch { /* privat vindu */ }
    if (sist && medFil.some(t => t.id === sist)) { setAktivId(sist); return }
    const vekt = (tid: string) => data.enheter.filter(e => e.drawing_id === tid).length + data.oppgaver.filter(o => o.drawing_id === tid && o.status === 'open').length
    setAktivId([...medFil].sort((a, b) => vekt(b.id) - vekt(a.id))[0].id)
  }, [data, aktivId, id])

  const aktiv = data?.tegninger.find(t => t.id === aktivId) ?? null
  useEffect(() => {
    if (!aktiv) return
    try { localStorage.setItem(sisteNokkel(id), aktiv.id) } catch { /* privat vindu */ }
    setUrl(null)
    if (!aktiv.file_path) return
    let levende = true
    tegningUrl(aktiv.file_path).then(u => { if (levende) setUrl(u) }).catch(e => setFeil(e instanceof Error ? e.message : String(e)))
    return () => { levende = false }
  }, [aktiv?.id, aktiv?.file_path, id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tastaturet: «/» søker, ↑/↓ blar, Esc tømmer.
  useEffect(() => {
    const tast = (e: KeyboardEvent) => {
      const iFelt = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === '/' && !iFelt) { e.preventDefault(); sokFelt.current?.focus(); return }
      if (e.key === 'Escape' && iFelt) { setSok(''); setFag(null); sokFelt.current?.blur(); return }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && fane === 'tegninger' && synligeTegninger.length) {
        e.preventDefault()
        const i = synligeTegninger.findIndex(t => t.id === aktivId)
        const ny = e.key === 'ArrowDown' ? Math.min(i + 1, synligeTegninger.length - 1) : Math.max(i - 1, 0)
        velgTegning(synligeTegninger[ny < 0 ? 0 : ny].id)
      }
    }
    window.addEventListener('keydown', tast)
    return () => window.removeEventListener('keydown', tast)
  })
  useEffect(() => { document.querySelector('.tre-rad[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }) }, [aktivId])

  function velgTegning(tid: string) { setAktivId(tid); setValgt(null) }

  if (feil && !data) return <Beskjed stil="feil">{feil}</Beskjed>
  if (!data) return <div className="prosjekt-side"><div className="tre" /><div className="plan"><div className="plan-tom">Henter prosjektet …</div></div></div>

  const naa = new Date()
  const navn = new Map(data.medlemmer.map(m => [m.user_id, m.user_name ?? 'Ukjent']))
  const apen = (o: PlanOppgave) => o.status === 'open'
  const forfalt = (o: PlanOppgave) => apen(o) && !!o.frist_at && new Date(o.frist_at) < naa
  const tall = fremdrift(
    data.enheter.map(e => ({ montert: !!e.placed_at })),
    data.oppgaver.map(o => ({ apen: apen(o), frist: o.frist_at ? new Date(o.frist_at) : null })),
    naa,
  )
  const fagAntall = [...tegninger.reduce((m, t) => m.set(t.discipline ?? 'annet', (m.get(t.discipline ?? 'annet') ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
  const perType = [...data.enheter.reduce((m, e) => {
    const r = m.get(e.kind) ?? { alle: 0, montert: 0 }
    r.alle++; if (e.placed_at) r.montert++
    return m.set(e.kind, r)
  }, new Map<string, { alle: number; montert: number }>())].sort((a, b) => b[1].alle - a[1].alle)
  const enheterPaa = (tid: string) => data.enheter.filter(e => e.drawing_id === tid)
  const apneOppgaver = data.oppgaver.filter(apen).length

  const markorer: Markor[] = aktiv ? [
    ...enheterPaa(aktiv.id).map(e => ({
      id: e.id, x: e.x, y: e.y, form: 'enhet' as const,
      farge: e.placed_at ? GRONN : GRA, fylt: !!e.placed_at,
      tittel: `${TYPE[e.kind] ?? e.kind} ${e.tag}`,
      under: e.placed_at ? `Montert ${DATO.format(new Date(e.placed_at))}` : 'Ikke montert',
    })),
    ...data.oppgaver.filter(o => apen(o) && o.drawing_id === aktiv.id && o.pin_x !== null && o.pin_y !== null).map(o => ({
      id: o.id, x: o.pin_x!, y: o.pin_y!, form: 'pin' as const,
      farge: forfalt(o) ? ROD : BLEKK, fylt: true, tittel: o.title,
      under: [o.assigned_to ? navn.get(o.assigned_to) : 'Ingen mottaker', o.frist_at ? `frist ${DATO.format(new Date(o.frist_at))}` : null].filter(Boolean).join(' · '),
    })),
  ] : []
  const valgtEnhet: PlanEnhet | null = data.enheter.find(e => e.id === valgt) ?? null

  function velgOppgave(o: PlanOppgave) {
    setValgt(o.id)
    if (o.drawing_id && o.pin_x !== null && o.pin_y !== null && data!.tegninger.some(t => t.id === o.drawing_id && t.file_path)) {
      setAktivId(o.drawing_id)
      setFokus({ x: o.pin_x, y: o.pin_y, n: Date.now() })
    }
  }

  async function veksleMontert(e: PlanEnhet) {
    const neste = e.placed_at ? null : new Date().toISOString()
    setLagrer(true)
    const { error } = await supabase.from('fire_devices').update({ placed_at: neste }).eq('id', e.id)
    setLagrer(false)
    if (error) { setFeil(`Kunne ikke lagre: ${error.message}`); return }
    setData(d => d && ({ ...d, enheter: d.enheter.map(x => (x.id === e.id ? { ...x, placed_at: neste } : x)) }))
  }

  /** Én tegning i lista. Tallet til høyre er komponenter montert/alle — grønt når alt er på plass. */
  const tegningRad = (t: PlanTegning, dybde: number, medSti: boolean) => {
    const e = enheterPaa(t.id)
    const m = e.filter(x => x.placed_at).length
    return (
      <button key={t.id} type="button" className="tre-rad" aria-current={t.id === aktivId ? 'true' : undefined}
        draggable={kanSkrive}
        onDragStart={e => treDragStart(e, { type: 'tegning', id: t.id })}
        onDragEnd={() => { setDraTre(null); setSlippPaa(null) }}
        style={{ paddingLeft: 10 + dybde * 16 }} onClick={() => velgTegning(t.id)}>
        <FileText size={15} strokeWidth={1.8} className="tre-ikon" />
        <span className="tre-tekst">
          {t.name}
          {medSti ? <small>{[sti(t) || null, FAG[t.discipline ?? ''] ?? null].filter(Boolean).join(' · ')}</small> : null}
        </span>
        {e.length ? <span className={`tre-tall${m === e.length ? ' ferdig' : ''}`}>{m}/{e.length}</span> : null}
      </button>
    )
  }

  const p = data.prosjekt
  return (
    <div className="prosjekt-side"
      onDragOver={e => { if (harFiler(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDra(true) } }}
      onDrop={slippet}>
      {dra ? (
        <div className="slipp-flate" onDragLeave={e => { if (e.currentTarget === e.target) setDra(false) }}>
          <div className="slipp-tekst">
            <FolderUp size={28} strokeWidth={1.6} />
            <strong>Slipp mappa her</strong>
          </div>
        </div>
      ) : null}
      {slipp ? <ImportArk plan={slipp.plan} mapper={data.mapper} onAvbryt={() => setSlipp(null)} onLeggInn={leggInn} /> : null}
      <input ref={velger} type="file" hidden multiple
        {...{ webkitdirectory: '' }}
        onChange={e => { if (e.target.files?.length) forbered(filerFraVelger(e.target.files)); e.target.value = '' }} />
      <aside className="tre">
        <a className="plan-tilbake" href="#/prosjekt"><ArrowLeft size={15} strokeWidth={2} /> Prosjekter</a>
        <div>
          <h1 className="plan-navn">{p.name}</h1>
          <div className="dempet">{[p.customer_name, p.address].filter(Boolean).join(' · ') || '–'}</div>
        </div>

        {tall ? (
          <button type="button" className="tre-status" onClick={() => setFane('status')}>
            <Ring andel={tall.andel} />
            <span>
              <span className="plan-hoved">{tall.hoved}</span>
              <span className={tall.forfalt ? 'plan-forfalt' : 'dempet'}>{aapneTekst(tall)}</span>
            </span>
          </button>
        ) : null}

        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
        {opplasting ? (
          <div className="import-fremdrift">
            <span>Legger inn tegninger … {opplasting.ferdig} av {opplasting.totalt}</span>
            <div className="plan-stolpe"><div style={{ width: `${opplasting.totalt ? (opplasting.ferdig / opplasting.totalt) * 100 : 0}%` }} /></div>
          </div>
        ) : resultat ? (
          <Beskjed stil={resultat.feilet.length ? 'varsel' : 'ok'}>
            {resultat.lagtInn} {resultat.lagtInn === 1 ? 'tegning' : 'tegninger'} lagt inn.
            {resultat.feilet.length ? ` ${resultat.feilet.length} feilet: ${resultat.feilet.slice(0, 3).map(f => `${f.navn} (${f.grunn})`).join(', ')}${resultat.feilet.length > 3 ? ' …' : ''}.` : ''}
          </Beskjed>
        ) : null}

        <div className="tre-faner" role="tablist">
          <button type="button" role="tab" aria-selected={fane === 'tegninger'} onClick={() => setFane('tegninger')}>
            Tegninger <span>{tegninger.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={fane === 'status'} onClick={() => setFane('status')}>
            Status og oppgaver {apneOppgaver ? <span>{apneOppgaver}</span> : null}
          </button>
        </div>

        {fane === 'tegninger' ? (
          <>
            <label className="tre-sok">
              <Search size={15} strokeWidth={2} />
              <input ref={sokFelt} value={sok} onChange={e => setSok(e.target.value)} placeholder="Søk i tegningene" />
              {sok ? <button type="button" onClick={() => setSok('')} aria-label="Tøm"><X size={14} strokeWidth={2.2} /></button> : <kbd>/</kbd>}
            </label>
            {fagAntall.length > 1 ? (
              <div className="tre-fag">
                {fagAntall.map(([f, n]) => (
                  <button key={f} type="button" aria-pressed={fag === f} onClick={() => setFag(fag === f ? null : f)}>
                    {FAG[f] ?? f} <span>{n}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {kanSkrive && (nyMappe || redigerer) ? (
              <form className="tre-ny" onSubmit={e => { e.preventDefault(); void lagreTre() }}>
                <label>
                  {redigerer ? `Nytt navn på «${redigerer.navn}»` : `Ny mappe i «${nyMappe?.under ?? 'prosjektet'}»`}
                </label>
                <input
                  autoFocus
                  value={treNavn}
                  onChange={e => setTreNavn(e.target.value)}
                  placeholder="Mappenavn"
                  onKeyDown={e => { if (e.key === 'Escape') avbrytTre() }}
                />
                <div className="tre-ny-knapper">
                  <Knapp type="submit" stil="merke" disabled={!treNavn.trim()}>Lagre</Knapp>
                  <button type="button" onClick={avbrytTre}>Avbryt</button>
                </div>
              </form>
            ) : null}

            <nav
              className={`tre-liste${slippPaa === 'rot' ? ' tre-rot-slipp' : ''}`}
              onDragOver={e => treDragOver(e, 'rot')}
              onDragLeave={() => setSlippPaa(p => (p === 'rot' ? null : p))}
              onDrop={e => void treSlipp(e, null)}
            >
              {treff ? (
                treff.length ? treff.map(t => tegningRad(t, 0, true))
                  : <p className="dempet tre-tom">Ingen treff.</p>
              ) : linjer.length === 0 ? (
                <button type="button" className="import-tom" disabled={!kanSkrive} onClick={() => velger.current?.click()}>
                  <FolderUp size={22} strokeWidth={1.6} />
                  <strong>{kanSkrive ? 'Legg inn tegninger' : 'Ingen tegninger'}</strong>
                </button>
              ) : linjer.map(l => l.type === 'mappe' ? (
                <div
                  key={l.id}
                  className={`tre-skal${slippPaa === l.id ? ' slipp' : ''}`}
                  draggable={kanSkrive}
                  onDragStart={e => treDragStart(e, { type: 'mappe', id: l.id })}
                  onDragEnd={() => { setDraTre(null); setSlippPaa(null) }}
                  onDragOver={e => treDragOver(e, l.id)}
                  onDragLeave={() => setSlippPaa(p => (p === l.id ? null : p))}
                  onDrop={e => void treSlipp(e, l.id)}
                >
                  <button type="button" className="tre-rad tre-mappe" style={{ paddingLeft: 10 + l.dybde * 16 }}
                    onClick={() => setLukket(s => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })}>
                    <ChevronRight size={14} strokeWidth={2.2} className={`tre-pil${l.apen ? ' apen' : ''}`} />
                    <Folder size={15} strokeWidth={1.8} className="tre-ikon" />
                    <span className="tre-tekst">{l.navn}</span>
                    <span className="tre-tall">{l.antall}</span>
                  </button>
                  {kanSkrive ? (
                    <span className="tre-handling">
                      <button type="button" title="Ny undermappe" aria-label="Ny undermappe" onClick={() => startNyMappe(l.id, l.navn)}>
                        <Plus size={13} strokeWidth={2.2} />
                      </button>
                      <button type="button" title="Gi nytt navn" aria-label="Gi nytt navn" onClick={() => startOmdop({ id: l.id, navn: l.navn })}>
                        <Pencil size={13} strokeWidth={2} />
                      </button>
                      <button type="button" title="Slett mappa" aria-label="Slett mappa" onClick={() => {
                        const m = data.mapper.find(x => x.id === l.id)
                        if (m) void slettMappeMedInnhold(m)
                      }}>
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </span>
                  ) : null}
                </div>
              ) : tegningRad(l.t, l.dybde + (mapper.length ? 1 : 0), false))}
            </nav>
            {draTre ? (
              <p className="tre-slipp-hint">Slipp på en mappe — eller her for prosjektets rot.</p>
            ) : null}
            {kanSkrive ? (
              <div className="tre-bunn">
                <button type="button" className="import-lenke" onClick={() => startNyMappe(null, 'prosjektet')}>
                  <Plus size={14} strokeWidth={2} /> Ny mappe
                </button>
                {linjer.length ? (
                  <button type="button" className="import-lenke" onClick={() => velger.current?.click()}>
                    <FolderUp size={14} strokeWidth={2} /> Legg inn flere tegninger
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="tre-liste">
            {perType.length ? (
              <section>
                <h2 className="plan-seksjon">Komponenter montert</h2>
                {perType.map(([kind, r]) => (
                  <div key={kind} className="plan-type">
                    <span>{TYPE[kind] ?? kind}</span>
                    <span className="plan-type-tall">{r.montert} / {r.alle}</span>
                    <div className="plan-stolpe"><div style={{ width: `${(r.montert / r.alle) * 100}%` }} /></div>
                  </div>
                ))}
              </section>
            ) : null}
            <section>
              <h2 className="plan-seksjon">Oppgaver</h2>
              {data.oppgaver.length === 0 ? (
                <p className="dempet">Ingen oppgaver.</p>
              ) : [...data.oppgaver].sort((a, b) => Number(!apen(a)) - Number(!apen(b))).map(o => (
                <button key={o.id} type="button" className={`tre-rad${apen(o) ? '' : ' ferdig'}`}
                  aria-current={valgt === o.id ? 'true' : undefined} onClick={() => velgOppgave(o)}>
                  <span className="tre-tekst">
                    {o.title}
                    <small className={forfalt(o) ? 'plan-forfalt' : undefined}>
                      {[o.assigned_to ? navn.get(o.assigned_to) : 'Ingen mottaker', o.frist_at ? `frist ${DATO.format(new Date(o.frist_at))}` : null].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  {o.pin_x !== null ? <MapPin size={14} strokeWidth={2} className="tre-ikon" /> : null}
                </button>
              ))}
            </section>
          </div>
        )}
      </aside>

      <section className="dok">
        {aktiv ? (
          <header className="dok-hode">
            <div className="dok-tittel">
              <span className="dok-sti">{[sti(aktiv) || null, FAG[aktiv.discipline ?? ''] ?? null, aktiv.plan].filter(Boolean).join(' · ')}</span>
              <strong>{aktiv.name}</strong>
            </div>
            {kanSkrive && aktiv.file_path ? (
              <a className="knapp knapp-primar dok-tegn" href={`#/prosjekt/${id}/tegn/${aktiv.id}`}>
                <PenTool size={14} strokeWidth={2} /> Tegn
              </a>
            ) : null}
            {enheterPaa(aktiv.id).length ? (
              <div className="dok-forklaring">
                <span><i className="fk-montert" /> Montert</span>
                <span><i className="fk-ikke" /> Ikke montert</span>
                <span><i className="fk-pin" /> Oppgave</span>
              </div>
            ) : null}
          </header>
        ) : null}
        {aktiv?.file_path ? (
          <Planvisning url={url} markorer={markorer} valgt={valgt} fokus={fokus} onVelg={setValgt} />
        ) : (
          <div className="plan"><div className="plan-tom">{aktiv ? 'Tegningen har ingen PDF.' : 'Velg en tegning'}</div></div>
        )}

        {valgtEnhet ? (
          <div className="plan-kort dok-kort">
            <div className="plan-kort-hode">
              <strong>{TYPE[valgtEnhet.kind] ?? valgtEnhet.kind} {valgtEnhet.tag}</strong>
              <span className={valgtEnhet.placed_at ? 'plan-ok' : 'dempet'}>
                {valgtEnhet.placed_at ? `Montert ${DATO.format(new Date(valgtEnhet.placed_at))}` : 'Ikke montert'}
              </span>
            </div>
            <dl className="plan-dl">
              <dt>Modell</dt><dd>{valgtEnhet.model ?? '–'}</dd>
              <dt>Serienr.</dt><dd>{valgtEnhet.serial ?? '–'}</dd>
              {valgtEnhet.note ? (<><dt>Fra tegningen</dt><dd>{valgtEnhet.note}</dd></>) : null}
            </dl>
            {kanSkrive ? (
              <Knapp stil={valgtEnhet.placed_at ? 'stille' : 'merke'} disabled={lagrer} onClick={() => veksleMontert(valgtEnhet)}>
                {valgtEnhet.placed_at ? 'Angre montert' : 'Marker montert'}
              </Knapp>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

/**
 * Hva slippet blir til, før noe skrives. Mappetreet vises slik det blir — da
 * ser du med én gang om innpakningen ble skrelt riktig.
 */
function ImportArk({ plan, mapper, onAvbryt, onLeggInn }: {
  plan: ImportPlan
  mapper: { id: string; name: string }[]
  onAvbryt: () => void
  onLeggInn: () => void
}) {
  useEffect(() => {
    const tast = (e: KeyboardEvent) => { if (e.key === 'Escape') onAvbryt(); if (e.key === 'Enter' && plan.tegninger.length) onLeggInn() }
    window.addEventListener('keydown', tast)
    return () => window.removeEventListener('keydown', tast)
  }, [plan, onAvbryt, onLeggInn])

  const navn = new Map([...mapper.map(m => [m.id, m.name] as const), ...plan.mapper.map(m => [m.id, m.name] as const)])
  const nye = new Set(plan.mapper.map(m => m.id))
  // Gruppér per mappe tegningen havner i, i den rekkefølgen planen har.
  const grupper = new Map<string, number>()
  for (const t of plan.tegninger) grupper.set(t.folderId ?? '', (grupper.get(t.folderId ?? '') ?? 0) + 1)
  const forelder = new Map(plan.mapper.map(m => [m.id, m.parentId] as const))
  const sti = (id: string) => { const ut: string[] = []; for (let x: string | null | undefined = id; x; x = forelder.get(x)) ut.unshift(navn.get(x) ?? '?'); return ut.join(' / ') }
  const ikkePdf = plan.hoppetOver.filter(h => h.grunn === 'ikke-pdf').length
  const finnes = plan.hoppetOver.filter(h => h.grunn !== 'ikke-pdf').length

  return (
    <div className="import-slor" onClick={onAvbryt}>
      <div className="import-ark" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h2>{plan.tegninger.length ? `Legg inn ${plan.tegninger.length} ${plan.tegninger.length === 1 ? 'tegning' : 'tegninger'}` : 'Ingenting nytt å legge inn'}</h2>
        <p className="dempet">
          {[
            plan.mapper.length ? `${plan.mapper.length} nye mapper` : null,
            plan.gjenbrukteMapper ? `${plan.gjenbrukteMapper} som finnes fra før` : null,
            finnes ? `${finnes} tegninger finnes allerede og hoppes over` : null,
            ikkePdf ? `${ikkePdf} filer er ikke PDF` : null,
          ].filter(Boolean).join(' · ') || 'Alt havner på rota av prosjektet.'}
        </p>
        {grupper.size ? (
          <ul className="import-mapper">
            {[...grupper].map(([fid, n]) => (
              <li key={fid || 'rot'}>
                <Folder size={14} strokeWidth={1.8} />
                <span>{fid ? sti(fid) : 'Rota av prosjektet'}{fid && nye.has(fid) ? <em>ny</em> : null}</span>
                <span className="tre-tall">{n}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="import-knapper">
          <Knapp stil="naken" onClick={onAvbryt}>Avbryt</Knapp>
          <Knapp stil="primar" disabled={!plan.tegninger.length} onClick={onLeggInn}>Legg inn</Knapp>
        </div>
      </div>
    </div>
  )
}
