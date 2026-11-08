import { useMemo, useState, type ReactNode } from 'react'
import {
  forslagForRom, kursFarge, kursfortegnelse, matrise, nesteKursNr, niva,
  PAVIRKNINGER, pavirkningTekst, punkterPerRom, risikotall,
  type Fare, type Kurs, type Prosjektering as Dok, type Rom,
} from '@delt/prosjektering'
import { forslag as finnForslag, somFare, type Forslag } from '@delt/risiko-katalog'
import { getSymbol } from '@delt/symbols'
import { spenningsfall } from '@delt/kursforslag'
import { Knapp } from '@/ui/kit'
import type { Verktoy } from './Lerret'

/**
 * Dokumentet bak tegningen: rom for rom (FEL § 16), kursene, farene med matrise, SJA (FSE § 10)
 * og kompetanse. Flyttet ut av ordreskjermen 30.10 så tegnemodusen bruker det likt for ordre og
 * prosjekttegning. Valget er tegnemodusens: `valgt` er det ene valgte, `setValgt` velger.
 */

const KOMPETANSE_FORSLAG = [
  { hva: 'Fagbrev elektriker (eller tilsvarende) for de som utfører arbeidet', hvorfor: 'Arbeid på elektriske anlegg krever kvalifisert personell' },
  { hva: 'Faglig ansvarlig med installatørkompetanse i foretaket', hvorfor: 'Foretaket må være registrert hos DSB med faglig ansvarlig for installasjon' },
  { hva: 'Årlig kurs i FSE med førstehjelp og HLR', hvorfor: 'Alle som arbeider på eller nær anlegg skal ha årlig opplæring' },
  { hva: 'Opplæring i måleinstrumenter for sluttkontroll', hvorfor: 'Sluttkontroll med isolasjon-, kontinuitets-, jordfeil- og kortslutningsmålinger' },
  { hva: 'Stillas/arbeid i høyden (ved behov)', hvorfor: 'Montasje i tak og på fasade' },
]

export type Endre = (fn: (d: Dok) => Dok, samme?: boolean) => void

export function Tekst({ etikett, verdi, onEndre, rader = 2, hjelp }: { etikett: string; verdi: string; onEndre: (v: string) => void; rader?: number; hjelp?: string }) {
  return (
    <label className="pj-felt">
      <span>{etikett}</span>
      {rader <= 1
        ? <input value={verdi} onChange={e => onEndre(e.target.value)} placeholder={hjelp} />
        : <textarea rows={rader} value={verdi} onChange={e => onEndre(e.target.value)} placeholder={hjelp} />}
    </label>
  )
}

export function Seksjon({ tittel, children, hoyre }: { tittel: string; children: ReactNode; hoyre?: ReactNode }) {
  return (
    <section className="pj-seksjon">
      <div className="pj-seksjon-hode"><h3 className="plan-seksjon">{tittel}</h3>{hoyre}</div>
      {children}
    </section>
  )
}

// ── Oversikt ───────────────────────────────────────────────────────────────

export function Oversikt({ dok, endre, mangel, lastOpp, laster }: { dok: Dok; endre: Endre; mangel: string[]; lastOpp?: () => void; laster?: boolean }) {
  const m = dok.plan.malestokk
  const telling = new Map<string, number>()
  for (const p of dok.punkter) telling.set(p.type, (telling.get(p.type) ?? 0) + 1)
  return (
    <>
      <Seksjon tittel="Planen">
        <div className="pj-rad">
          <span>{dok.plan.key ? (dok.plan.type === 'pdf' ? 'PDF lagt inn' : 'Bilde lagt inn') : 'Ingen plan'}</span>
          {lastOpp && <Knapp stil="naken" onClick={lastOpp} disabled={laster}>{dok.plan.key ? 'Bytt' : 'Last opp'}</Knapp>}
        </div>
        <label className="pj-felt">
          <span>Målestokk</span>
          {m ? (
            <div className="pj-mal">
              <input type="number" min={0} step={0.01} value={m.meter || ''} placeholder="Lengde"
                onChange={e => endre(d => ({ ...d, plan: { ...d.plan, malestokk: d.plan.malestokk && { ...d.plan.malestokk, meter: Number(e.target.value) } } }), true)} />
              <span>m</span>
            </div>
          ) : <em className="pj-svak">–</em>}
        </label>
      </Seksjon>
      <Seksjon tittel="Kunden">
        <Tekst etikett="Hva må du vite om kunden før du velger løsning?" rader={5} verdi={dok.kunde}
          hjelp="Hvem bor der (barn, eldre)? Elbil nå eller senere? Varme: varmepumpe, ovner, gulvvarme? Planer om smarthus, solceller, utbygging?"
          onEndre={v => endre(d => ({ ...d, kunde: v }), true)} />
      </Seksjon>
      <Seksjon tittel="Punkter på planen">
        {telling.size === 0 ? <em className="pj-svak">–</em> : (
          <ul className="pj-telling">
            {[...telling].map(([t, n]) => <li key={t}><span>{getSymbol(t)?.label ?? t}</span><strong>{n}</strong></li>)}
          </ul>
        )}
      </Seksjon>
      {mangel.length > 0 && (
        <Seksjon tittel="Før det er ferdig">
          <ul className="pj-mangler">{mangel.map(x => <li key={x}>{x}</li>)}</ul>
        </Seksjon>
      )}
    </>
  )
}

// ── Rom for rom (FEL § 16) ─────────────────────────────────────────────────

export function RomFane({ dok, endre, valgt, setValgt }: { dok: Dok; endre: Endre; valgt: string | null; setValgt: (id: string | null) => void }) {
  const ppr = punkterPerRom(dok)
  const settRom = (id: string, fn: (r: Rom) => Rom) => endre(d => ({ ...d, rom: d.rom.map(r => (r.id === id ? fn(r) : r)) }), true)
  if (dok.rom.length === 0) return null
  return (
    <>
      {dok.rom.map(r => {
        const apen = valgt === r.id
        const forslag = forslagForRom(r.navn)
        const pt = ppr.get(r.id)
        return (
          <div key={r.id} className={`pj-kort ${apen ? 'apen' : ''}`}>
            <button type="button" className="pj-kort-hode" onClick={() => setValgt(apen ? null : r.id)}>
              <strong>{r.navn}</strong>
              <span>{r.pavirkninger.join(' · ') || 'Ikke vurdert'}</span>
            </button>
            {apen && (
              <div className="pj-kort-kropp">
                <Tekst etikett="Navn" rader={1} verdi={r.navn} onEndre={v => settRom(r.id, x => ({ ...x, navn: v }))} />
                {(!r.bruk && !r.brukere && r.pavirkninger.length === 0) && (
                  <Knapp stil="naken" onClick={() => settRom(r.id, x => ({ ...x, bruk: forslag.bruk, brukere: forslag.brukere, pavirkninger: forslag.pavirkninger }))}>
                    Fyll inn forslag for {r.navn.toLowerCase()}
                  </Knapp>
                )}
                <Tekst etikett="Bruk" verdi={r.bruk} onEndre={v => settRom(r.id, x => ({ ...x, bruk: v }))} />
                <Tekst etikett="Brukere" verdi={r.brukere} onEndre={v => settRom(r.id, x => ({ ...x, brukere: v }))} />
                <div className="pj-felt">
                  <span>Ytre påvirkninger</span>
                  <div className="pj-chips">
                    {PAVIRKNINGER.map(p => {
                      const paa = r.pavirkninger.includes(p.kode)
                      return (
                        <button key={p.kode} type="button" className={paa ? 'paa' : ''} title={p.tekst}
                          onClick={() => settRom(r.id, x => ({ ...x, pavirkninger: paa ? x.pavirkninger.filter(k => k !== p.kode) : [...x.pavirkninger, p.kode].sort() }))}>
                          {p.kode}
                        </button>
                      )
                    })}
                  </div>
                  {r.pavirkninger.length > 0 && <ul className="pj-forklar">{r.pavirkninger.map(k => <li key={k}><b>{k}</b> {pavirkningTekst(k)}</li>)}</ul>}
                </div>
                {forslag.nek.length > 0 && (
                  <div className="pj-felt"><span>Vurder etter NEK 400</span><ul className="pj-forklar">{forslag.nek.map(n => <li key={n}>{n}</li>)}</ul></div>
                )}
                <Tekst etikett="Vurdering og valg" rader={3} verdi={r.notat} hjelp="Hva betyr dette for løsningen? IP-grad, jordfeilvern, kursdeling …" onEndre={v => settRom(r.id, x => ({ ...x, notat: v }))} />
                {pt && <div className="pj-svak">Punkter: {[...pt].map(([t, n]) => `${n} ${getSymbol(t)?.label.toLowerCase() ?? t}`).join(', ')}</div>}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// ── Kurser (installasjonstegningen) ────────────────────────────────────────

const KURSFELT: { k: keyof Kurs; navn: string; hjelp: string }[] = [
  { k: 'vern', navn: 'Vern', hjelp: 'C10, B16 …' },
  { k: 'rcd', navn: 'Jordfeilvern', hjelp: '30 mA type A' },
  { k: 'kabel', navn: 'Kabel', hjelp: 'IFXI 3G1,5' },
  { k: 'forlegning', navn: 'Forlegning', hjelp: 'A1 skjult i isolert vegg' },
]

export function KursFane({ dok, endre, valgt, setValgt, aspekt, setAktivKurs, fokus, tegnForing }: {
  dok: Dok; endre: Endre; valgt: string | null; setValgt: (id: string | null) => void; aspekt: number | null
  aktivKurs: string | null; setAktivKurs: (id: string | null) => void
  /** Fokus på kursen: resten dimmes, klikk legger på/tar av. */
  fokus: (id: string) => void
  tegnForing: (id: string) => void
}) {
  const rader = useMemo(() => kursfortegnelse(dok, aspekt), [dok, aspekt])
  const settKurs = (id: string, fn: (k: Kurs) => Kurs) => endre(d => ({ ...d, kurser: d.kurser.map(k => (k.id === id ? fn(k) : k)) }), true)
  return (
    <>
      <Seksjon tittel={`Kurser (${dok.kurser.length})`} hoyre={
        <Knapp stil="naken" onClick={() => {
          const id = crypto.randomUUID()
          endre(d => ({ ...d, kurser: [...d.kurser, { id, nr: nesteKursNr(d.kurser), navn: '', vern: '', rcd: '', kabel: '', forlegning: '', merknad: '' }] }))
          setAktivKurs(id); setValgt(id)
        }}>Ny kurs</Knapp>
      }>
        {rader.map(({ kurs: k, punkter, rom, lengde }) => {
          const apen = valgt === k.id
          const sum = punkter.reduce((s, [, n]) => s + n, 0)
          const du = lengde != null ? spenningsfall(lengde, k.kabel, k.vern) : null
          return (
            <div key={k.id} className={`pj-kort ${apen ? 'apen' : ''}`}>
              <button type="button" className="pj-kort-hode" onClick={() => { setValgt(apen ? null : k.id); setAktivKurs(k.id) }}>
                <strong><span className="pj-kursnr" style={{ background: kursFarge(dok, k.id) }}>{k.nr}</span>{k.navn || 'Uten navn'}</strong>
                <span>{[k.vern, k.kabel.replace(/^[A-Z]{3,5}\s+(?=\d)/, ''), sum ? `${sum} pkt` : null, lengde != null ? `${lengde.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} m` : null].filter(Boolean).join(' · ') || 'Ikke fylt ut'}</span>
                {du != null && <span className={du > 4 ? 'pj-du varsel' : 'pj-du'} title="Spenningsfall ved full last på vernet, målt langs føringene">ΔU {du.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} %</span>}
              </button>
              {apen && (
                <div className="pj-kort-kropp">
                  <div className="pj-to">
                    <Tekst etikett="Nr" rader={1} verdi={k.nr} onEndre={v => settKurs(k.id, x => ({ ...x, nr: v }))} />
                    <Tekst etikett="Forsyner" rader={1} verdi={k.navn} hjelp="Stue stikk" onEndre={v => settKurs(k.id, x => ({ ...x, navn: v }))} />
                  </div>
                  <div className="pj-to">
                    {KURSFELT.map(f => <Tekst key={f.k} etikett={f.navn} rader={1} verdi={k[f.k]} hjelp={f.hjelp} onEndre={v => settKurs(k.id, x => ({ ...x, [f.k]: v }))} />)}
                  </div>
                  <Tekst etikett="Merknad" rader={1} verdi={k.merknad} onEndre={v => settKurs(k.id, x => ({ ...x, merknad: v }))} />
                  {sum > 0 && <div className="pj-svak">{punkter.map(([t, n]) => `${n} ${getSymbol(t)?.label.toLowerCase() ?? t}`).join(', ')}{rom.length ? ` · ${rom.join(', ')}` : ''}</div>}
                  <div className="pj-rad">
                    <Knapp stil="naken" onClick={() => fokus(k.id)}>Fokus</Knapp>
                    <Knapp stil="naken" onClick={() => tegnForing(k.id)}>Tegn føring <kbd>F</kbd></Knapp>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </Seksjon>
    </>
  )
}

// ── Farer og risikomatrise ─────────────────────────────────────────────────

const NIVA_NAVN = { lav: 'Lav', middels: 'Middels', hoy: 'Høy' }

export function Matrise({ farer, etter, valgt, onVelg }: { farer: Fare[]; etter: boolean; valgt?: string | null; onVelg?: (id: string) => void }) {
  const m = matrise(farer, etter)
  const nr = new Map(farer.map((f, i) => [f.id, i + 1]))
  return (
    <div className="pj-matrise">
      <div className="pj-matrise-y">Konsekvens</div>
      <div className="pj-matrise-rute">
        {[5, 4, 3, 2, 1].map(k => [1, 2, 3, 4, 5].map(s => {
          const her = m.get(`${s},${k}`) ?? []
          return (
            <div key={`${s},${k}`} className={`pj-celle ${niva(s, k)}`} title={`S${s} × K${k} = ${s * k}`}>
              {her.map(f => (
                <button key={f.id} type="button" className={valgt === f.id ? 'valgt' : ''} onClick={() => onVelg?.(f.id)}>{nr.get(f.id)}</button>
              ))}
            </div>
          )
        }))}
      </div>
      <div className="pj-matrise-x">Sannsynlighet</div>
    </div>
  )
}

function Tall({ verdi, onEndre }: { verdi: number; onEndre: (v: number) => void }) {
  return (
    <select value={verdi} onChange={e => onEndre(Number(e.target.value))}>
      {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  )
}

export function FareFane({ dok, endre, valgt, setValgt, setVerktoy, jobbtekst }: { dok: Dok; endre: Endre; valgt: string | null; setValgt: (id: string | null) => void; setVerktoy: (v: Verktoy) => void; jobbtekst: string }) {
  const [etter, setEtter] = useState(false)
  const settFare = (id: string, fn: (f: Fare) => Fare) => endre(d => ({ ...d, farer: d.farer.map(f => (f.id === id ? fn(f) : f)) }), true)
  const forslag = useMemo(() => finnForslag({ tekst: jobbtekst, tegning: dok }), [jobbtekst, dok])
  return (
    <>
      {forslag.length > 0 && <Forslagsliste forslag={forslag} endre={endre} setValgt={setValgt} />}
      <Seksjon tittel="Risikomatrise" hoyre={
        <div className="pj-veksle">
          <button type="button" className={!etter ? 'valgt' : ''} onClick={() => setEtter(false)}>Før tiltak</button>
          <button type="button" className={etter ? 'valgt' : ''} onClick={() => setEtter(true)}>Etter tiltak</button>
        </div>
      }>
        <Matrise farer={dok.farer} etter={etter} valgt={valgt} onVelg={setValgt} />
      </Seksjon>
      <Seksjon tittel={`Farer (${dok.farer.length})`} hoyre={
        <Knapp stil="naken" onClick={() => {
          const id = crypto.randomUUID()
          endre(d => ({ ...d, farer: [...d.farer, { id, tittel: '', gjelder: 'anlegg', s: 3, k: 3, tiltak: '', restS: 2, restK: 3 }] }))
          setValgt(id)
        }}>Ny fare</Knapp>
      }>
        {dok.farer.map((f, i) => {
          const apen = valgt === f.id
          const fr = risikotall(f.s, f.k), etterR = risikotall(f.restS, f.restK)
          return (
            <div key={f.id} className={`pj-kort ${apen ? 'apen' : ''}`}>
              <button type="button" className="pj-kort-hode" onClick={() => setValgt(apen ? null : f.id)}>
                <strong><span className={`pj-nr ${niva(f.s, f.k)}`}>{i + 1}</span>{f.tittel || 'Uten navn'}</strong>
                <span>{f.gjelder === 'anlegg' ? 'Anlegget' : 'Montøren'} · {fr} → {etterR} {NIVA_NAVN[niva(f.restS, f.restK)].toLowerCase()}</span>
              </button>
              {apen && (
                <div className="pj-kort-kropp">
                  <Tekst etikett="Fare" rader={1} verdi={f.tittel} hjelp="F.eks. Fuktig miljø på bad" onEndre={v => settFare(f.id, x => ({ ...x, tittel: v }))} />
                  <div className="pj-to">
                    <label className="pj-felt"><span>Gjelder</span>
                      <select value={f.gjelder} onChange={e => settFare(f.id, x => ({ ...x, gjelder: e.target.value as Fare['gjelder'] }))}>
                        <option value="anlegg">Anlegget og brukerne</option><option value="montor">Montøren</option>
                      </select>
                    </label>
                    <label className="pj-felt"><span>Rom</span>
                      <select value={f.romId ?? ''} onChange={e => settFare(f.id, x => ({ ...x, romId: e.target.value || undefined }))}>
                        <option value="">Hele boligen</option>
                        {dok.rom.map(r => <option key={r.id} value={r.id}>{r.navn}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="pj-sk">
                    <span>Før tiltak</span><label>S <Tall verdi={f.s} onEndre={v => settFare(f.id, x => ({ ...x, s: v }))} /></label>
                    <label>K <Tall verdi={f.k} onEndre={v => settFare(f.id, x => ({ ...x, k: v }))} /></label><b className={niva(f.s, f.k)}>{fr}</b>
                  </div>
                  <Tekst etikett="Tiltak" rader={3} verdi={f.tiltak} onEndre={v => settFare(f.id, x => ({ ...x, tiltak: v }))} />
                  <div className="pj-sk">
                    <span>Restrisiko</span><label>S <Tall verdi={f.restS} onEndre={v => settFare(f.id, x => ({ ...x, restS: v }))} /></label>
                    <label>K <Tall verdi={f.restK} onEndre={v => settFare(f.id, x => ({ ...x, restK: v }))} /></label><b className={niva(f.restS, f.restK)}>{etterR}</b>
                  </div>
                  {f.x == null && <Knapp stil="naken" onClick={() => { endre(d => ({ ...d, farer: d.farer.filter(x => x.id !== f.id) })); setVerktoy(f.gjelder === 'anlegg' ? 'fare-anlegg' : 'fare-montor') }}>Pek på planen i stedet</Knapp>}
                </div>
              )}
            </div>
          )
        })}
      </Seksjon>
    </>
  )
}

/**
 * Dynamisk risikovurdering: bare farene jobben faktisk har (lib/risiko-katalog.ts). Hvert forslag
 * sier hva i jobben som utløste det. «Legg til» gjør det til en vanlig fare som kan rettes;
 * «Gjelder ikke» husker avgjørelsen, så det ikke dukker opp igjen.
 */
function Forslagsliste({ forslag, endre, setValgt }: { forslag: Forslag[]; endre: Endre; setValgt: (id: string | null) => void }) {
  const leggTil = (f: Forslag) => {
    const id = crypto.randomUUID()
    endre(d => ({ ...d, farer: [...d.farer, somFare(f, id)] }))
    setValgt(id)
  }
  return (
    <Seksjon tittel={`Forslag fra jobben (${forslag.length})`} hoyre={
      <Knapp stil="naken" onClick={() => endre(d => ({ ...d, farer: [...d.farer, ...forslag.map(f => somFare(f, crypto.randomUUID()))] }))}>Legg til alle</Knapp>
    }>
      {forslag.map(f => (
        <div key={f.id} className="pj-forslag">
          <div>
            <strong>{f.tittel}</strong>
            <span className="pj-svak">{f.gjelder === 'anlegg' ? 'Anlegget' : 'Montøren'} · fordi {f.fordi} · {f.nek}</span>
          </div>
          <Knapp stil="naken" onClick={() => endre(d => ({ ...d, avvist: [...d.avvist, f.id] }))}>Gjelder ikke</Knapp>
          <Knapp onClick={() => leggTil(f)}>Legg til</Knapp>
        </div>
      ))}
    </Seksjon>
  )
}

// ── SJA (FSE § 10) ─────────────────────────────────────────────────────────

export function SjaFane({ dok, endre }: { dok: Dok; endre: Endre }) {
  const s = dok.sja
  const sett = (fn: (s: Dok['sja']) => Dok['sja']) => endre(d => ({ ...d, sja: fn(d.sja) }), true)
  return (
    <>
      <Tekst etikett="Arbeidsmoment" rader={1} verdi={s.arbeidsmoment} hjelp="F.eks. Tilkobling av ny kurs i eksisterende tavle" onEndre={v => sett(x => ({ ...x, arbeidsmoment: v }))} />
      <div className="pj-to">
        <label className="pj-felt"><span>Sted</span>
          <select value={s.romId ?? ''} onChange={e => sett(x => ({ ...x, romId: e.target.value || undefined }))}>
            <option value="">Velg rom</option>{dok.rom.map(r => <option key={r.id} value={r.id}>{r.navn}</option>)}
          </select>
        </label>
        <Tekst etikett="Deltakere" rader={1} verdi={s.deltakere} onEndre={v => sett(x => ({ ...x, deltakere: v }))} />
      </div>
      <Seksjon tittel="Steg" hoyre={<Knapp stil="naken" onClick={() => sett(x => ({ ...x, steg: [...x.steg, { id: crypto.randomUUID(), steg: '', fare: '', tiltak: '', ansvarlig: '' }] }))}>Nytt steg</Knapp>}>
        {s.steg.length === 0 && <em className="pj-svak">–</em>}
        {s.steg.map((st, i) => {
          const settSteg = (felt: 'steg' | 'fare' | 'tiltak' | 'ansvarlig', v: string) => sett(x => ({ ...x, steg: x.steg.map(y => (y.id === st.id ? { ...y, [felt]: v } : y)) }))
          return (
            <div key={st.id} className="pj-kort apen">
              <div className="pj-kort-kropp">
                <div className="pj-rad"><strong>Steg {i + 1}</strong>
                  <Knapp stil="naken" onClick={() => sett(x => ({ ...x, steg: x.steg.filter(y => y.id !== st.id) }))}>Fjern</Knapp></div>
                <Tekst etikett="Hva gjøres" rader={1} verdi={st.steg} onEndre={v => settSteg('steg', v)} />
                <Tekst etikett="Fare" rader={1} verdi={st.fare} onEndre={v => settSteg('fare', v)} />
                <Tekst etikett="Tiltak" rader={2} verdi={st.tiltak} onEndre={v => settSteg('tiltak', v)} />
                <Tekst etikett="Ansvarlig" rader={1} verdi={st.ansvarlig} onEndre={v => settSteg('ansvarlig', v)} />
              </div>
            </div>
          )
        })}
      </Seksjon>
      <Tekst etikett="Konklusjon" rader={3} verdi={s.konklusjon} hjelp="Kan jobben gjøres trygt med tiltakene? Hva må være på plass før start?" onEndre={v => sett(x => ({ ...x, konklusjon: v }))} />
    </>
  )
}

// ── Kompetanse ─────────────────────────────────────────────────────────────

export function KompetanseFane({ dok, endre }: { dok: Dok; endre: Endre }) {
  const settK = (id: string, felt: 'hva' | 'hvorfor', v: string) => endre(d => ({ ...d, kompetanse: d.kompetanse.map(k => (k.id === id ? { ...k, [felt]: v } : k)) }), true)
  const mangler = KOMPETANSE_FORSLAG.filter(f => !dok.kompetanse.some(k => k.hva === f.hva))
  return (
    <>
      {dok.kompetanse.map(k => (
        <div key={k.id} className="pj-kort apen">
          <div className="pj-kort-kropp">
            <Tekst etikett="Kompetanse" rader={1} verdi={k.hva} onEndre={v => settK(k.id, 'hva', v)} />
            <Tekst etikett="Hvorfor" rader={2} verdi={k.hvorfor} onEndre={v => settK(k.id, 'hvorfor', v)} />
            <Knapp stil="naken" onClick={() => endre(d => ({ ...d, kompetanse: d.kompetanse.filter(x => x.id !== k.id) }))}>Fjern</Knapp>
          </div>
        </div>
      ))}
      <div className="pj-rad">
        <Knapp stil="naken" onClick={() => endre(d => ({ ...d, kompetanse: [...d.kompetanse, { id: crypto.randomUUID(), hva: '', hvorfor: '' }] }))}>Ny</Knapp>
        {mangler.length > 0 && <Knapp stil="naken" onClick={() => endre(d => ({ ...d, kompetanse: [...d.kompetanse, ...mangler.map(f => ({ id: crypto.randomUUID(), ...f }))] }))}>Legg til vanlige forslag ({mangler.length})</Knapp>}
      </div>
    </>
  )
}


