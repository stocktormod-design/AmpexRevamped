import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, FileText, Folder, MapPin, Search, X } from 'lucide-react'
import { kan } from '@delt/kontor-tilgang'
import { fremdrift, aapneTekst } from '@delt/prosjekt-fremdrift'
import { mappeSti, tellRekursivt, type MappeNode } from '@delt/tegning-tre'
import { useAuth } from '@/auth'
import { supabase } from '@/supabase'
import { hentProsjektPlan, tegningUrl, type PlanEnhet, type PlanOppgave, type PlanTegning, type ProsjektPlan as Data } from '@/lib/plan-lager'
import { Beskjed, Knapp } from '@/ui/kit'
import { Planvisning, type Markor } from '@/ui/Planvisning'

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

  useEffect(() => {
    hentProsjektPlan(id).then(setData).catch(e => setFeil(e instanceof Error ? e.message : String(e)))
  }, [id])

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
    <div className="prosjekt-side">
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

            <nav className="tre-liste">
              {treff ? (
                treff.length ? treff.map(t => tegningRad(t, 0, true))
                  : <p className="dempet tre-tom">Ingen tegning passer. Esc tømmer søket.</p>
              ) : linjer.length === 0 ? (
                <p className="dempet tre-tom">Ingen tegninger ennå. De legges til fra appen.</p>
              ) : linjer.map(l => l.type === 'mappe' ? (
                <button key={l.id} type="button" className="tre-rad tre-mappe" style={{ paddingLeft: 10 + l.dybde * 16 }}
                  onClick={() => setLukket(s => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })}>
                  <ChevronRight size={14} strokeWidth={2.2} className={`tre-pil${l.apen ? ' apen' : ''}`} />
                  <Folder size={15} strokeWidth={1.8} className="tre-ikon" />
                  <span className="tre-tekst">{l.navn}</span>
                  <span className="tre-tall">{l.antall}</span>
                </button>
              ) : tegningRad(l.t, l.dybde + (mapper.length ? 1 : 0), false))}
            </nav>
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
                <p className="dempet">Ingen oppgaver. De deles ut fra appen — hold på tegningen der jobben skal gjøres.</p>
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
          <div className="plan"><div className="plan-tom">{aktiv ? 'Tegningen har ingen PDF ennå. Den lastes opp fra appen.' : 'Velg en tegning til venstre.'}</div></div>
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
