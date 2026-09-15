import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import { hentOrdrer, type Ordrerad, type Ordrestatus } from '@/lib/ordre-lager'
import { Delt, paaTelefon } from '@/ui/Delt'
import { Beskjed, Felt, Sidehode, stk } from '@/ui/kit'
import { MontorOrdre, planlagtTekst } from '@/ui/MontorOrdre'

/**
 * Alle MINE ordrer — også de ferdige.
 *
 * Forskjellen fra `MinDag` er tidsrommet, ikke innholdet: Hjem er i dag,
 * denne er historikken. Begge viser den samme ordren gjennom `MontorOrdre`,
 * så de to kan ikke komme i utakt om hva en ordre er.
 *
 * Dette er IKKE kontorets ordreflate. Den har hele firmaets portefølje,
 * statusfiltre, fakturaeksport og dekningsbidrag, og krever `ordre.les` — som
 * montøren ikke har. Se `lib/kontor-tilgang.ts`.
 */

const BOLKER: { navn: string; statuser: Ordrestatus[] }[] = [
  { navn: 'Åpne', statuser: ['mottatt', 'planlagt', 'pagaar'] },
  { navn: 'Ferdige', statuser: ['fakturaklar', 'fakturert'] },
]

export function MineOrdre() {
  const { profil } = useAuth()
  const [rader, setRader] = useState<Ordrerad[]>([])
  const [laster, setLaster] = useState(true)
  const [feil, setFeil] = useState<string | null>(null)
  const [valgt, setValgt] = useState<string | null>(null)
  const [sok, setSok] = useState('')

  useEffect(() => {
    if (!profil) return
    let avbrutt = false
    setLaster(true)
    const id = window.setTimeout(() => {
      hentOrdrer({ bareMine: profil.id, sok: sok.trim() || undefined })
        .then(ut => {
          if (avbrutt) return
          setRader(ut)
          setFeil(null)
          // Se `paaTelefon()` i Delt: autovalg hører til spaltevisningen.
          setValgt(v => (v && ut.some(o => o.id === v) ? v : (paaTelefon() ? null : (ut[0]?.id ?? null))))
        })
        .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
        .finally(() => { if (!avbrutt) setLaster(false) })
    }, 200)
    return () => { avbrutt = true; window.clearTimeout(id) }
  }, [profil?.id, sok])

  const grupper = useMemo(
    () => BOLKER
      .map(b => ({ navn: b.navn, rader: rader.filter(r => b.statuser.includes(r.status)) }))
      .filter(g => g.rader.length > 0),
    [rader],
  )

  const aktiv = rader.find(r => r.id === valgt) ?? null

  return (
    <>
      <Sidehode
        tittel="Mine ordrer"
        under={laster ? 'Henter …' : stk(rader.length, 'ordre', 'ordrer')}
        handling={<div style={{ maxWidth: 250, width: '100%' }}>
          <Felt placeholder="Søk tittel, kunde, adresse …" value={sok} onChange={e => setSok(e.target.value)} />
        </div>}
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="arbeidsflate">
        <Delt valgt={!!aktiv} tilbake={() => setValgt(null)}>
          <div className="liste">
            <div className="liste-kropp">
              {laster ? (
                <div className="liste-gruppe">Henter …</div>
              ) : rader.length === 0 ? (
                <div className="tomt-mykt"><p>{sok ? 'Ingen treff.' : 'Du står ikke på noen ordrer.'}</p></div>
              ) : (
                grupper.map(g => (
                  <div key={g.navn}>
                    <div className="liste-gruppe">{g.navn} · {g.rader.length}</div>
                    {g.rader.map(r => (
                      <button key={r.id} className="ordrerad" aria-selected={r.id === valgt} onClick={() => setValgt(r.id)}>
                        <div className="ordrerad-topp">
                          {r.order_number ? <span className="ordrerad-nr">#{r.order_number}</span> : null}
                          <span className="ordrerad-tittel">{r.title}</span>
                        </div>
                        <div className="ordrerad-bunn">
                          <span className="ordrerad-kunde">{r.address ?? r.customer_name ?? '—'}</span>
                          <span className="ordrerad-dato">{planlagtTekst(r.scheduled_at).replace('Ikke planlagt', '—')}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="detalj">
            {!aktiv || !profil
              ? <div className="tomt-mykt"><p>Velg en ordre</p></div>
              : <MontorOrdre key={aktiv.id} ordreId={aktiv.id} brukerId={profil.id} />}
          </div>
        </Delt>
      </div>
    </>
  )
}
