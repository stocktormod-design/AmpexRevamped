import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabase'
import { Beskjed, Knapp, Kort, Merke, Nokkeltall, Sidehode, Tomt } from '@/ui/kit'

/**
 * Tilbakemeldinger fra appen (boblen nede til høyre). Bare Ampex-admins ser dem —
 * RLS og `tilbakemeldinger_admin()` sjekker `ampex_admins`, ikke denne skjermen.
 */

type Rad = {
  id: string
  created_at: string
  type: 'feil' | 'forslag' | 'ros'
  vurdering: number | null
  tekst: string
  rute: string | null
  ruter: { rute: string; t: string }[] | null
  app_versjon: string | null
  bygg: string | null
  plattform: string | null
  os: string | null
  modell: string | null
  ram_mb: number | null
  ledig_disk_mb: number | null
  ekstra: { rolle?: string; minutter_i_appen?: number } | null
  status: 'ny' | 'sett' | 'fikset' | 'avvist'
  navn: string | null
  epost: string
  firma: string | null
}

const TID = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const TYPENAVN = { feil: 'Feil', forslag: 'Forslag', ros: 'Ros' } as const
const STATUSNAVN = { ny: 'Ny', sett: 'Sett', fikset: 'Fikset', avvist: 'Avvist' } as const

function topp(rader: Rad[], felt: (r: Rad) => string | null): string {
  const tell = new Map<string, number>()
  for (const r of rader) { const k = felt(r); if (k) tell.set(k, (tell.get(k) ?? 0) + 1) }
  const [navn, n] = [...tell.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  return navn ? `${navn} (${n})` : '–'
}

export function Tilbakemeldinger() {
  const [rader, setRader] = useState<Rad[] | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [filter, setFilter] = useState<'alle' | Rad['type']>('alle')
  const [visAvsluttede, setVisAvsluttede] = useState(false)
  const [apen, setApen] = useState<string | null>(null)

  const hent = useCallback(async () => {
    const { data, error } = await supabase.rpc('tilbakemeldinger_admin', { grense: 500 })
    if (error) { setFeil(error.message); return }
    setFeil(null)
    setRader(data as Rad[])
  }, [])
  useEffect(() => { void hent() }, [hent])

  async function settStatus(id: string, status: Rad['status']) {
    const { error } = await supabase.from('tilbakemelding').update({ status }).eq('id', id)
    if (error) { setFeil(error.message); return }
    setRader(r => r?.map(x => (x.id === id ? { ...x, status } : x)) ?? null)
  }

  const alle = rader ?? []
  const vist = useMemo(() => alle.filter(r =>
    (filter === 'alle' || r.type === filter) && (visAvsluttede || r.status === 'ny' || r.status === 'sett'),
  ), [alle, filter, visAvsluttede])

  const vurderte = alle.filter(r => r.vurdering !== null)
  const snitt = vurderte.length ? vurderte.reduce((s, r) => s + (r.vurdering ?? 0), 0) / vurderte.length : null
  const siste7 = alle.filter(r => Date.now() - new Date(r.created_at).getTime() < 7 * 864e5).length
  const personer = new Set(alle.map(r => r.epost)).size

  return (
    <>
      <Sidehode tittel="Tilbakemeldinger" under="Fra boblen i appen" handling={<Knapp onClick={() => void hent()}>Oppdater</Knapp>} />
      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <Nokkeltall tall={[
        { navn: 'Åpne feil', verdi: alle.filter(r => r.type === 'feil' && (r.status === 'ny' || r.status === 'sett')).length,
          under: `${alle.filter(r => r.status === 'ny').length} nye totalt`, aksent: alle.some(r => r.status === 'ny') },
        { navn: 'Snittvurdering', verdi: snitt === null ? '–' : snitt.toFixed(1).replace('.', ','), under: `${vurderte.length} har gitt stjerner` },
        { navn: 'Siste 7 dager', verdi: siste7, under: `${personer} personer totalt` },
        { navn: 'Mest brukt', verdi: topp(alle, r => r.modell), under: `Versjon ${topp(alle, r => r.bygg ? `${r.app_versjon} (${r.bygg})` : r.app_versjon)}` },
      ]} />

      <Kort
        tittel={`${vist.length} av ${alle.length}`}
        verktoy={
          <div style={{ display: 'flex', gap: 8 }}>
            {(['alle', 'feil', 'forslag', 'ros'] as const).map(f => (
              <Knapp key={f} stil={filter === f ? 'primar' : 'stille'} onClick={() => setFilter(f)}>
                {f === 'alle' ? 'Alle' : TYPENAVN[f]}
              </Knapp>
            ))}
            <Knapp stil={visAvsluttede ? 'primar' : 'stille'} onClick={() => setVisAvsluttede(v => !v)}>
              Vis fiksede/avviste
            </Knapp>
          </div>
        }
      >
        {rader === null ? <Tomt>Henter …</Tomt> : vist.length === 0 ? <Tomt>Ingen her.</Tomt> : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {vist.map(r => (
              <div key={r.id} style={{ padding: '14px 0', borderTop: '1px solid var(--hairline, #e5e5ea)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Merke stil={r.type === 'feil' ? 'feil' : r.type === 'forslag' ? 'endret' : 'ny'}>{TYPENAVN[r.type]}</Merke>
                  {r.status !== 'ny' ? <Merke>{STATUSNAVN[r.status]}</Merke> : <Merke stil="varsel">Ny</Merke>}
                  <strong>{r.navn ?? r.epost}</strong>
                  <span style={{ opacity: 0.6 }}>{r.firma ?? ''} · {TID.format(new Date(r.created_at))}</span>
                  {r.vurdering ? <span title="Vurdering">{'★'.repeat(r.vurdering)}{'☆'.repeat(5 - r.vurdering)}</span> : null}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {(['sett', 'fikset', 'avvist'] as const).map(s => (
                      <Knapp key={s} stil={r.status === s ? 'primar' : 'naken'} onClick={() => void settStatus(r.id, r.status === s ? 'ny' : s)}>
                        {STATUSNAVN[s]}
                      </Knapp>
                    ))}
                  </span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{r.tekst}</p>
                <div style={{ fontSize: 13, opacity: 0.65, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>{r.modell ?? 'ukjent enhet'} · {r.os}</span>
                  <span>Ampex {r.app_versjon} ({r.bygg})</span>
                  {r.ram_mb ? <span>{(r.ram_mb / 1024).toFixed(0)} GB RAM</span> : null}
                  {r.ledig_disk_mb !== null ? <span>{(r.ledig_disk_mb / 1024).toFixed(1)} GB ledig</span> : null}
                  {r.ekstra?.rolle ? <span>Rolle: {r.ekstra.rolle}</span> : null}
                  {r.ekstra?.minutter_i_appen !== undefined ? <span>{r.ekstra.minutter_i_appen} min i appen</span> : null}
                  <span>Skjerm: <code>{r.rute ?? '–'}</code></span>
                  {r.ruter && r.ruter.length > 1 ? (
                    <a href="#" onClick={e => { e.preventDefault(); setApen(apen === r.id ? null : r.id) }}>
                      {apen === r.id ? 'Skjul spor' : `Spor (${r.ruter.length})`}
                    </a>
                  ) : null}
                </div>
                {apen === r.id && r.ruter ? (
                  <ol style={{ fontSize: 13, opacity: 0.75, margin: '6px 0 0 18px' }}>
                    {r.ruter.map((x, i) => <li key={i}><code>{x.rute}</code> · {new Date(x.t).toLocaleTimeString('nb-NO')}</li>)}
                  </ol>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Kort>
    </>
  )
}
