import { useEffect, useRef, useState } from 'react'
import { hentKunder, type Kunde } from '@/lib/kontor-lager'
import { antall, Beskjed, Felt, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Kunderegisteret.
 *
 * Dette er registeret SpeedyCraft-importen lander i, og
 * `docs/DESKTOP_OG_IMPORT.md` kaller det nivå 1: «må med, ellers blir det ikke
 * salg». Derfor vises `source_system` som en egen merkelapp — en importert
 * kunde skal kunne skilles fra en som er lagt inn her, både under en
 * parallellkjøring og etterpå.
 *
 * Organisasjonsnummeret er den eneste harde nøkkelen på tvers av systemer, og
 * det er den kundededupen skal matche på. Derfor står det i egen kolonne og
 * ikke gjemt i en detalj.
 */

export function Kunder() {
  const [sok, setSok] = useState('')
  const [rader, setRader] = useState<Kunde[]>([])
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const teller = useRef(0)

  useEffect(() => {
    const id = window.setTimeout(async () => {
      const mitt = ++teller.current
      setLaster(true)
      try {
        const ut = await hentKunder(sok)
        if (mitt !== teller.current) return
        setRader(ut)
        setFeil(null)
      } catch (e) {
        if (mitt === teller.current) setFeil(e instanceof Error ? e.message : String(e))
      } finally {
        if (mitt === teller.current) setLaster(false)
      }
    }, 200)
    return () => window.clearTimeout(id)
  }, [sok])

  const firma = rader.filter(k => k.is_company).length
  const importerte = rader.filter(k => k.source_system).length
  const utenOrgnr = rader.filter(k => k.is_company && !k.org_nr).length

  return (
    <>
      <Sidehode
        tittel="Kunder"
        under={laster
          ? 'Søker …'
          : `${stk(rader.length, 'kunde', 'kunder')} · ${antall(firma)} firma${utenOrgnr > 0 ? `, ${antall(utenOrgnr)} uten org.nr` : ''}${importerte > 0 ? ` · ${antall(importerte)} importert` : ''}`}
        handling={
          <div style={{ width: 250 }}>
            <Felt
              placeholder="Søk navn, org.nr, telefon, sted …"
              value={sok}
              autoFocus
              onChange={e => setSok(e.target.value)}
            />
          </div>
        }
      />


      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <Kort tittel="Alle kunder" merkelapp={laster ? 'Søker …' : stk(rader.length, 'treff', 'treff')}>
        {rader.length === 0 ? (
          <p className="kort-hjelp">
            {laster
              ? 'Søker …'
              : sok.trim()
                ? 'Ingen kunder passer søket.'
                : 'Kunderegisteret er tomt. Det fylles av appen, eller av en import fra det gamle systemet.'}
          </p>
        ) : (
          <table className="linjer">
            <thead>
              <tr>
                <th>Navn</th>
                <th style={{ width: 130 }}>Org.nr</th>
                <th style={{ width: 150 }}>Telefon</th>
                <th>E-post</th>
                <th>Sted</th>
                <th className="h" style={{ width: 80 }}>Ordrer</th>
                <th style={{ width: 120 }}>Kilde</th>
              </tr>
            </thead>
            <tbody>
              {rader.map(k => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 500 }}>{k.name}</td>
                  <td className="valgbar dempet">{k.org_nr ?? (k.is_company ? '—' : '')}</td>
                  <td className="valgbar dempet">{k.phone ?? ''}</td>
                  <td className="valgbar dempet">{k.email ?? ''}</td>
                  <td className="dempet">{[k.postal_code, k.city].filter(Boolean).join(' ')}</td>
                  <td className="h">{k.ordrer === 0 ? <span className="dempet-mer">0</span> : antall(k.ordrer)}</td>
                  <td>
                    {k.source_system ? <Merke stil="endret">{k.source_system}</Merke> : <span className="dempet-mer">Ampex</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Kort>
    </>
  )
}
