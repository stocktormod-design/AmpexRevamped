import { useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { meterPerEnhet, romAreal, hoydeFor, kursFarge, kursfortegnelse, niva, pavirkningTekst, punkterPerRom, risikotall, type Prosjektering } from '@delt/prosjektering'
import { getSymbol } from '@delt/symbols'
import { hentDelt, type Delt } from '@/lib/tegningslag-lager'
import { Lerret } from '@/tegnemodus/Lerret'
import { Matrise } from '@/tegnemodus/dokument'

/**
 * Det kunden ser (`#/del/<nøkkel>`, ingen innlogging). Ett dokument i oppgavens rekkefølge:
 * planen med farene pekt ut, kunden, rom for rom, SJA, kompetanse og risikomatrisen. Planen kan
 * flyttes og zoomes på skjerm; på papir (Skriv ut → Lagre som PDF) står den stille i full bredde.
 */

const FARGE = { lav: '#1F7A3F', middels: '#B7791F', hoy: '#B3261E' }
const DATO = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })

export function DeltOrdre({ token }: { token: string }) {
  const [d, setD] = useState<Delt | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [valgt, setValgt] = useState<string | null>(null)
  const [side, setSide] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    hentDelt(token).then(setD).catch(e => setFeil(e instanceof Error ? e.message : String(e)))
  }, [token])
  useEffect(() => { if (d) document.title = `${d.ordre.title} — dokumentasjon` }, [d])

  if (feil) return <div className="dp-tom">{feil}</div>
  if (!d) return <div className="dp-tom">Henter …</div>
  const p = d.data
  const anlegg = p.farer.filter(f => f.gjelder === 'anlegg')
  const montor = p.farer.filter(f => f.gjelder === 'montor')
  const nr = new Map(p.farer.map((f, i) => [f.id, i + 1]))
  const romNavn = (id?: string) => p.rom.find(r => r.id === id)?.navn ?? 'Hele boligen'

  return (
    <div className="dp">
      <header className="dp-hode">
        <div>
          <div className="dp-firma">{d.firma.name}{d.firma.org_number ? ` · org.nr. ${d.firma.org_number}` : ''}</div>
          <h1>{d.ordre.title}</h1>
          <div className="dp-under">{[d.ordre.order_number != null ? `Ordre #${d.ordre.order_number}` : null, d.ordre.customer_name, d.ordre.address].filter(Boolean).join(' · ')}{' · '}oppdatert {DATO.format(new Date(d.oppdatert))}</div>
        </div>
        <button type="button" className="dp-skriv" onClick={() => window.print()}><Printer size={15} /> Skriv ut / PDF</button>
      </header>

      <section className="dp-seksjon">
        <h2><span>1</span>Planen og hvor risikoen er høyest</h2>
        <div className="dp-plan dp-skjerm">
          <Lerret url={d.planUrl} type={p.plan.type} p={p} verktoy="velg" valgt={valgt ? [valgt] : []} onVelg={ids => setValgt(ids[0] ?? null)} lese />
        </div>
        {d.planUrl && p.plan.type === 'bilde' && (
          <div className="dp-plan-papir" style={side ? { aspectRatio: `${side.w} / ${side.h}` } : undefined}>
            <img src={d.planUrl} alt="" onLoad={e => setSide({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            {side && <StatiskLag p={p} w={side.w} h={side.h} />}
          </div>
        )}
        <div className="dp-to">
          <FareListe tittel="For anlegget og brukerne" farer={anlegg} nr={nr} romNavn={romNavn} />
          <FareListe tittel="For montøren" farer={montor} nr={nr} romNavn={romNavn} />
        </div>
        {p.kunde.trim() && (
          <div className="dp-boks">
            <h3>Det vi må vite om kunden før vi velger løsning</h3>
            <p className="dp-pre">{p.kunde}</p>
          </div>
        )}
      </section>

      <section className="dp-seksjon">
        <h2><span>2</span>Anlegget rom for rom <small>FEL § 16 · NEK 400-5-51</small></h2>
        <RomTabell p={p} planAspekt={side ? side.w / side.h : null} />
      </section>

      <section className="dp-seksjon">
        <h2><span>3</span>Sikker jobbanalyse <small>FSE § 10</small></h2>
        {p.sja.arbeidsmoment ? (
          <>
            <dl className="dp-dl">
              <dt>Arbeidsmoment</dt><dd>{p.sja.arbeidsmoment}</dd>
              <dt>Sted</dt><dd>{romNavn(p.sja.romId)}</dd>
              {p.sja.deltakere && <><dt>Deltakere</dt><dd>{p.sja.deltakere}</dd></>}
            </dl>
            <table className="dp-tabell">
              <thead><tr><th>#</th><th>Hva gjøres</th><th>Fare</th><th>Tiltak</th><th>Ansvarlig</th></tr></thead>
              <tbody>{p.sja.steg.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td>{s.steg}</td><td>{s.fare}</td><td>{s.tiltak}</td><td>{s.ansvarlig}</td></tr>)}</tbody>
            </table>
            {p.sja.konklusjon && <p className="dp-pre"><b>Konklusjon:</b> {p.sja.konklusjon}</p>}
          </>
        ) : <p className="dp-svak">Ikke fylt ut.</p>}
      </section>

      <section className="dp-seksjon">
        <h2><span>4</span>Kompetanse</h2>
        {p.kompetanse.length ? (
          <table className="dp-tabell">
            <thead><tr><th>Kurs og kvalifikasjoner</th><th>Hvorfor</th></tr></thead>
            <tbody>{p.kompetanse.map(k => <tr key={k.id}><td>{k.hva}</td><td>{k.hvorfor}</td></tr>)}</tbody>
          </table>
        ) : <p className="dp-svak">Ikke fylt ut.</p>}
      </section>

      <section className="dp-seksjon dp-ny-side">
        <h2><span>5</span>Risikomatrise</h2>
        <div className="dp-to">
          <div><h3>Før tiltak</h3><Matrise farer={p.farer} etter={false} /></div>
          <div><h3>Etter tiltak</h3><Matrise farer={p.farer} etter /></div>
        </div>
        <table className="dp-tabell">
          <thead><tr><th>#</th><th>Fare</th><th>Gjelder</th><th>S</th><th>K</th><th>Risiko</th><th>Tiltak</th><th>Rest</th></tr></thead>
          <tbody>{p.farer.map((f, i) => (
            <tr key={f.id}>
              <td>{i + 1}</td><td>{f.tittel}<div className="dp-svak">{romNavn(f.romId)}</div></td>
              <td>{f.gjelder === 'anlegg' ? 'Anlegget' : 'Montøren'}</td><td>{f.s}</td><td>{f.k}</td>
              <td><b style={{ color: FARGE[niva(f.s, f.k)] }}>{risikotall(f.s, f.k)}</b></td>
              <td>{f.tiltak}</td>
              <td><b style={{ color: FARGE[niva(f.restS, f.restK)] }}>{risikotall(f.restS, f.restK)}</b> <span className="dp-svak">(S{f.restS} K{f.restK})</span></td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      {p.kurser.length > 0 && (
        <section className="dp-seksjon dp-ny-side">
          <h2><span>6</span>Kursfortegnelse <small>NEK 400-5-514</small></h2>
          <p className="dp-svak">Heltrukket strek er åpen føring, stiplet er skjult i vegg eller himling.</p>
          <Kursfortegnelse p={p} aspekt={side ? side.w / side.h : null} />
        </section>
      )}

      <footer className="dp-fot">Laget i Ampex · {d.firma.name}</footer>
    </div>
  )
}

function FareListe({ tittel, farer, nr, romNavn }: { tittel: string; farer: Prosjektering['farer']; nr: Map<string, number>; romNavn: (id?: string) => string }) {
  const sortert = [...farer].sort((a, b) => risikotall(b.s, b.k) - risikotall(a.s, a.k))
  return (
    <div className="dp-boks">
      <h3>{tittel}</h3>
      {sortert.length === 0 ? <p className="dp-svak">Ingen.</p> : (
        <ol className="dp-farer">
          {sortert.map(f => (
            <li key={f.id}><span className="dp-nr" style={{ background: FARGE[niva(f.s, f.k)] }}>{nr.get(f.id)}</span>
              <span><b>{f.tittel}</b> <span className="dp-svak">· {romNavn(f.romId)} · risiko {risikotall(f.s, f.k)}</span></span></li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Kursfortegnelse({ p, aspekt }: { p: Prosjektering; aspekt: number | null }) {
  const rader = kursfortegnelse(p, aspekt)
  return (
    <table className="dp-tabell">
      <thead><tr><th>Kurs</th><th>Forsyner</th><th>Vern</th><th>Jordfeil</th><th>Kabel og forlegning</th><th>Punkter</th><th>Lengde</th></tr></thead>
      <tbody>{rader.map(({ kurs: k, punkter, rom, lengde }) => (
        <tr key={k.id}>
          <td><span className="dp-kursnr" style={{ background: kursFarge(p, k.id) }}>{k.nr}</span></td>
          <td>{k.navn}{rom.length > 0 && <div className="dp-svak">{rom.join(', ')}</div>}{k.merknad && <div className="dp-svak">{k.merknad}</div>}</td>
          <td>{k.vern}</td><td>{k.rcd}</td>
          <td>{k.kabel}{k.forlegning && <div className="dp-svak">{k.forlegning}</div>}</td>
          <td>{punkter.map(([t, n]) => `${n} ${getSymbol(t)?.label.toLowerCase() ?? t}`).join(', ')}
            {(() => {
              const h = [...new Set(p.punkter.filter(x => x.kursId === k.id).map(x => { const v = hoydeFor(x); return v != null ? `${getSymbol(x.type)?.label.toLowerCase() ?? x.type} ${v} cm` : null }).filter(Boolean))]
              return h.length ? <div className="dp-svak">Høyde: {h.join(', ')}</div> : null
            })()}</td>
          <td>{lengde != null ? `${lengde.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} m` : '–'}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

function RomTabell({ p, planAspekt }: { p: Prosjektering; planAspekt: number | null }) {
  const ppr = useMemo(() => punkterPerRom(p), [p])
  const mpe = planAspekt ? meterPerEnhet(p.plan.malestokk, planAspekt) : null
  if (!p.rom.length) return <p className="dp-svak">Ingen rom.</p>
  return (
    <table className="dp-tabell dp-rom">
      <thead><tr><th>Rom</th><th>Bruk og brukere</th><th>Ytre påvirkninger</th><th>Vurdering</th></tr></thead>
      <tbody>{p.rom.map(r => {
        const a = romAreal(r, mpe)
        const pt = ppr.get(r.id)
        return (
          <tr key={r.id}>
            <td><b>{r.navn}</b>{a != null && <div className="dp-svak">{a.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} m²</div>}
              {pt && <div className="dp-svak">{[...pt].map(([t, n]) => `${n} ${getSymbol(t)?.label.toLowerCase() ?? t}`).join(', ')}</div>}</td>
            <td>{r.bruk}<div className="dp-svak">{r.brukere}</div></td>
            <td>{r.pavirkninger.map(k => <div key={k}><b>{k}</b> {pavirkningTekst(k)}</div>)}</td>
            <td className="dp-pre">{r.notat}</td>
          </tr>
        )
      })}</tbody>
    </table>
  )
}

/** Papirversjonen av laget: samme figurer som lerretet i tegnemodusen, i fast størrelse. */
function StatiskLag({ p, w, h }: { p: Prosjektering; w: number; h: number }) {
  const k = w / 900 // «skjermpiksler» på papir: planen er ~900 px bred i utskriften
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="dp-lag">
      {p.rom.map(r => (
        <g key={r.id}>
          {r.polygon && r.polygon.length >= 3
            ? <polygon points={r.polygon.map(q => `${q.x * w},${q.y * h}`).join(' ')} fill="none" stroke="#1D1D1F" strokeWidth={1.2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />
            : <rect x={r.form.x * w} y={r.form.y * h} width={r.form.w * w} height={r.form.h * h} fill="none" stroke="#1D1D1F" strokeWidth={1.2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />}
          {r.polygon && r.polygon.length >= 3
            ? <text x={(r.form.x + r.form.w / 2) * w} y={(r.form.y + r.form.h / 2) * h} textAnchor="middle" fontSize={11 * k} fontWeight={600}>{r.navn}</text>
            : <text x={r.form.x * w + 6 * k} y={r.form.y * h + 15 * k} fontSize={11 * k} fontWeight={600}>{r.navn}</text>}
        </g>
      ))}
      {p.foringer.map(f => (
        <path key={f.id} d={f.pts.map((q, i) => `${i ? 'L' : 'M'}${q.x * w} ${q.y * h}`).join(' ')} fill="none"
          stroke={kursFarge(p, f.kursId)} strokeWidth={1.6 * k} strokeDasharray={f.skjult ? `${6 * k} ${4 * k}` : undefined} />
      ))}
      {p.punkter.map(pt => (
        <g key={pt.id} transform={`translate(${pt.x * w} ${pt.y * h})`}>
          <circle r={9 * k} fill="#fff" />
          <g transform={`scale(${(15 * k) / 24}) translate(-12 -12)`} stroke="#1D1D1F" fill="none" strokeWidth={1.8} color="#1D1D1F"
            dangerouslySetInnerHTML={{ __html: getSymbol(pt.type)?.body ?? '' }} />
          {pt.kursId && (() => {
            const nr = p.kurser.find(x => x.id === pt.kursId)?.nr ?? ''
            return (
              <g transform={`translate(${8 * k} ${-8 * k})`}>
                <rect x={0} y={-6 * k} width={(nr.length * 5.5 + 6) * k} height={11 * k} rx={5.5 * k} fill={kursFarge(p, pt.kursId)} />
                <text x={(nr.length * 5.5 + 6) / 2 * k} y={2.6 * k} textAnchor="middle" fontSize={8 * k} fontWeight={700} fill="#fff">{nr}</text>
              </g>
            )
          })()}
        </g>
      ))}
      {p.farer.filter(f => f.x != null).map((f, i) => (
        <g key={f.id} transform={`translate(${f.x! * w} ${f.y! * h})`}>
          {f.gjelder === 'anlegg'
            ? <path d={`M0 ${-12 * k} L${11 * k} ${8 * k} L${-11 * k} ${8 * k}Z`} fill={FARGE[niva(f.s, f.k)]} />
            : <rect x={-9 * k} y={-9 * k} width={18 * k} height={18 * k} rx={3 * k} fill={FARGE[niva(f.s, f.k)]} />}
          <text y={4 * k} textAnchor="middle" fontSize={10 * k} fontWeight={700} fill="#fff">{p.farer.indexOf(f) + 1 || i + 1}</text>
        </g>
      ))}
    </svg>
  )
}
