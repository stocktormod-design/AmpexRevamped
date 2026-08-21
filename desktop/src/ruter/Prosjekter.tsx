import { useEffect, useMemo, useState } from 'react'
import { hentProsjekter, type Prosjekt } from '@/lib/kontor-lager'
import { antall, Beskjed, Felt, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Prosjekter.
 *
 * Et prosjekt i Ampex er rammen rundt tegninger, rom og oppgaver — ikke en
 * boks med ordrer. Derfor er kolonnene rom og oppgaver, ikke kroner: pengene
 * ligger på ordrene, og de har sin egen flate.
 *
 * Kontoret bruker denne til å se hvor langt et bygg har kommet og hvem som er
 * på det. Feltet bruker den samme datamodellen fra telefonen.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

const STATUS: Record<string, { navn: string; stil: 'ny' | 'varsel' | 'noytral' }> = {
  aktiv: { navn: 'Aktiv', stil: 'ny' },
  planlagt: { navn: 'Planlagt', stil: 'varsel' },
  ferdig: { navn: 'Ferdig', stil: 'noytral' },
}

export function Prosjekter() {
  const [rader, setRader] = useState<Prosjekt[]>([])
  const [sok, setSok] = useState('')
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)

  useEffect(() => {
    hentProsjekter()
      .then(setRader)
      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
      .finally(() => setLaster(false))
  }, [])

  const synlige = useMemo(() => {
    const s = sok.trim().toLowerCase()
    if (!s) return rader
    return rader.filter(p =>
      [p.name, p.customer_name, p.address].some(v => v?.toLowerCase().includes(s)),
    )
  }, [rader, sok])

  const apne = rader.reduce((n, p) => n + p.apneOppgaver, 0)
  const rom = rader.reduce((n, p) => n + p.rom, 0)
  const aktive = rader.filter(p => p.status === 'aktiv').length

  return (
    <>
      <Sidehode
        tittel="Prosjekter"
        under={laster
          ? 'Henter …'
          : `${antall(aktive)} aktive · ${antall(rom)} rom · ${stk(apne, 'åpen oppgave', 'åpne oppgaver')}`}
        handling={
          <div style={{ width: 250 }}>
            <Felt
              placeholder="Søk prosjekt, kunde, adresse …"
              value={sok}
              onChange={e => setSok(e.target.value)}
            />
          </div>
        }
      />


      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <Kort tittel="Alle prosjekter" merkelapp={laster ? 'Henter …' : stk(synlige.length, 'prosjekt', 'prosjekter')}>
        {synlige.length === 0 ? (
          <p className="kort-hjelp">
            {laster
              ? 'Henter prosjektene …'
              : rader.length === 0
                ? 'Ingen prosjekter ennå. De opprettes i appen, sammen med tegningen de hører til.'
                : 'Ingen prosjekter passer søket.'}
          </p>
        ) : (
          <table className="linjer">
            <thead>
              <tr>
                <th>Prosjekt</th>
                <th>Kunde</th>
                <th>Adresse</th>
                <th style={{ width: 110 }}>Status</th>
                <th className="h" style={{ width: 60 }}>Rom</th>
                <th className="h" style={{ width: 110 }}>Oppgaver</th>
                <th style={{ width: 180 }}>På jobben</th>
                <th style={{ width: 110 }}>Opprettet</th>
              </tr>
            </thead>
            <tbody>
              {synlige.map(p => {
                const st = STATUS[p.status ?? ''] ?? { navn: p.status ?? 'Ukjent', stil: 'noytral' as const }
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td className="dempet">{p.customer_name ?? '–'}</td>
                    <td className="dempet valgbar">{p.address ?? '–'}</td>
                    <td><Merke stil={st.stil}>{st.navn}</Merke></td>
                    <td className="h">{antall(p.rom)}</td>
                    {/* Åpne av totalt. Bare «12 oppgaver» sier ingenting om
                        hvor langt prosjektet har kommet. */}
                    <td className="h">
                      {p.oppgaver === 0 ? <span className="dempet-mer">–</span> : (
                        <>
                          <span style={{ color: p.apneOppgaver > 0 ? 'var(--gul)' : 'var(--gronn)' }}>
                            {antall(p.apneOppgaver)}
                          </span>
                          <span className="dempet-mer"> / {antall(p.oppgaver)}</span>
                        </>
                      )}
                    </td>
                    <td className="dempet">{p.deltakere.length ? p.deltakere.join(', ') : '–'}</td>
                    <td className="dempet-mer">{DATO.format(new Date(p.created_at))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Kort>
    </>
  )
}
