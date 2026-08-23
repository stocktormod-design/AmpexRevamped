import { kan } from '@delt/kontor-tilgang'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/auth'
import { hentKunder, opprettKunde, type Kunde, type NyKunde } from '@/lib/kontor-lager'
import { antall, Beskjed, Felt, Knapp, Kort, Merke, Sidehode, stk } from '@/ui/kit'

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
 *
 * Registeret fylles nå fra tre kanter: importen, appen, og skjemaet nederst
 * her. Den siste er den som mangler når telefonen ringer og kunden ikke finnes
 * fra før — da skal man ikke måtte ut på en jobb for å få lagt henne inn.
 */

const TOM: NyKunde = {
  navn: '',
  er_firma: true,
  org_nr: '',
  epost: '',
  telefon: '',
  adresse: '',
  postnr: '',
  sted: '',
}

export function Kunder() {
  const [sok, setSok] = useState('')
  const [rader, setRader] = useState<Kunde[]>([])
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const [versjon, setVersjon] = useState(0)
  const teller = useRef(0)

  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'kunder.skriv')
  const [apen, setApen] = useState(false)
  const [ny, setNy] = useState<NyKunde>(TOM)
  const [jobber, setJobber] = useState(false)
  const [skjemafeil, setSkjemafeil] = useState<string | null>(null)
  const [kvittering, setKvittering] = useState<string | null>(null)

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
  }, [sok, versjon])

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

        {kanSkrive ? (
          <div className="inviter-boks">
            {!apen ? (
              <div className="stabel">
                {kvittering ? <Beskjed stil="ok">{kvittering}</Beskjed> : null}
                {/* Egen blokk rundt knappen: `.stabel` strekker barna sine, og
                    en knapp i full kortbredde leser som flatens hovedhandling.
                    Det er den ikke — registeret over den er det. */}
                <div>
                  <Knapp stil="merke" onClick={() => { setApen(true); setKvittering(null) }}>
                    Ny kunde
                  </Knapp>
                </div>
              </div>
            ) : (
              <form
                className="stabel"
                onSubmit={async ev => {
                  ev.preventDefault()
                  setJobber(true)
                  setSkjemafeil(null)
                  try {
                    await opprettKunde(ny)
                    setKvittering(`${ny.navn.trim()} er lagt inn i registeret.`)
                    setNy(TOM)
                    setApen(false)
                    // Sokestrengen er uendret, saa effekten under maa dyttes
                    // eksplisitt. Aa skrive raden rett inn i lista i stedet
                    // ville vist en kunde som ikke er lest tilbake fra basen.
                    setVersjon(v => v + 1)
                  } catch (e) {
                    setSkjemafeil(e instanceof Error ? e.message : String(e))
                  }
                  setJobber(false)
                }}
              >
                <div className="inviter-felt">
                  <Felt
                    firkant
                    autoFocus
                    etikett="Navn"
                    value={ny.navn}
                    onChange={e => setNy(k => ({ ...k, navn: e.target.value }))}
                  />
                  {/* Firma eller privat avgjør om org.nr betyr noe, og det er
                      det eneste feltet som endrer betydningen av et annet. */}
                  <label className="felt felt-firkant">
                    <span className="felt-etikett">Type</span>
                    <select
                      className="felt-inn"
                      value={ny.er_firma ? 'firma' : 'privat'}
                      onChange={e => setNy(k => ({ ...k, er_firma: e.target.value === 'firma' }))}
                    >
                      <option value="firma">Firma</option>
                      <option value="privat">Privatkunde</option>
                    </select>
                  </label>
                </div>
                <div className="inviter-felt">
                  <Felt
                    firkant
                    etikett="Organisasjonsnummer"
                    inputMode="numeric"
                    disabled={!ny.er_firma}
                    hjelp={ny.er_firma
                      ? 'Den eneste harde nøkkelen mot regnskapet. Fyll den ut hvis du har den.'
                      : 'Gjelder bare firmakunder.'}
                    value={ny.er_firma ? ny.org_nr : ''}
                    onChange={e => setNy(k => ({ ...k, org_nr: e.target.value }))}
                  />
                  <Felt
                    firkant
                    etikett="Telefon"
                    inputMode="tel"
                    value={ny.telefon}
                    onChange={e => setNy(k => ({ ...k, telefon: e.target.value }))}
                  />
                </div>
                <div className="inviter-felt">
                  <Felt
                    firkant
                    etikett="E-post"
                    type="email"
                    inputMode="email"
                    hjelp="Dit fakturaen går."
                    value={ny.epost}
                    onChange={e => setNy(k => ({ ...k, epost: e.target.value }))}
                  />
                  <Felt
                    firkant
                    etikett="Adresse"
                    value={ny.adresse}
                    onChange={e => setNy(k => ({ ...k, adresse: e.target.value }))}
                  />
                </div>
                <div className="inviter-felt">
                  <Felt
                    firkant
                    etikett="Postnummer"
                    inputMode="numeric"
                    value={ny.postnr}
                    onChange={e => setNy(k => ({ ...k, postnr: e.target.value }))}
                  />
                  <Felt
                    firkant
                    etikett="Sted"
                    value={ny.sted}
                    onChange={e => setNy(k => ({ ...k, sted: e.target.value }))}
                  />
                </div>
                {skjemafeil ? <Beskjed stil="feil">{skjemafeil}</Beskjed> : null}
                <div className="rad">
                  <Knapp stil="merke" type="submit" disabled={jobber || !ny.navn.trim()}>
                    {jobber ? 'Lagrer …' : 'Legg inn kunden'}
                  </Knapp>
                  <Knapp type="button" onClick={() => { setApen(false); setSkjemafeil(null) }}>
                    Avbryt
                  </Knapp>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </Kort>
    </>
  )
}
