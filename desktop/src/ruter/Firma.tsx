import { kan, rollenavn } from '@delt/kontor-tilgang'
import { useCallback, useEffect, useState } from 'react'
import { hentFirma, type Firmaoppsett } from '@/lib/kontor-lager'
import { Inviter } from '@/ui/Inviter'
import { useAuth } from '@/auth'
import { Beskjed, initialer, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Firmaoppsettet.
 *
 * Tre ting som alle bor på kontor-PC-en, og ingen andre steder:
 *
 * 1. **Innstillingene** — oppbevaringstid, faglig ansvarlig, regnskapssystem.
 * 2. **Ansatte og roller.** Rollen bestemmer hva folk ser, både her og i appen.
 * 3. ~~Bake-nodene.~~ Tatt ut av flata 14. september (Tormod). Innmelding og
 *    Ampex-pool-bryteren ligger fortsatt i `lib/skann-lager.ts` om de skal inn
 *    igjen.
 *
 * Invitasjon er den ene tingen her som SKRIVER. Den gjør det gjennom
 * `supabase/functions/inviter-ansatt`, fordi `profiles.company_id` ikke kan
 * settes fra en klient — se migrasjonen 20260822120000. Resten er fortsatt
 * lesing; endring av innstillinger er neste steg.
 */

const REGNSKAP: Record<string, string> = {
  ingen: 'Ikke koblet',
  fiken: 'Fiken',
  tripletex: 'Tripletex',
  poweroffice: 'PowerOffice Go',
}

export function Firma() {
  const { profil } = useAuth()
  const [data, setData] = useState<Firmaoppsett | null>(null)
  const [feil, setFeil] = useState<string | null>(null)

  // Trukket ut av useEffect fordi invitasjonen må kunne be om lista på nytt:
  // den som nettopp ble invitert skal stå der med en gang, ikke etter en
  // oppfriskning av siden.
  const last = useCallback(() => {
    hentFirma()
      .then(setData)
      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => { last() }, [last])

  const ansvarlig = data?.ansatte.find(a => a.id === data.innstillinger?.faglig_ansvarlig)

  return (
    <>
      <Sidehode
        tittel="Firma"
        under={data?.company?.name ?? 'Innstillinger og ansatte'}
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="to-spalter">
        <div className="stabel">
          <Kort tittel="Ansatte" merkelapp={stk(data?.ansatte.length ?? 0, 'person', 'personer')}>
            {!data ? (
              <p className="kort-hjelp">Henter …</p>
            ) : data.ansatte.length === 0 ? (
              <p className="kort-hjelp">
                Ingen ansatte ennå. Inviter dem nedenfor — de får en e-post med en lenke der de
                velger sitt eget passord.
              </p>
            ) : (
              <table className="linjer">
                <thead>
                  <tr>
                    <th>Navn</th>
                    <th style={{ width: 170 }}>Rolle</th>
                    <th style={{ width: 150 }}>Telefon</th>
                    <th style={{ width: 150 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ansatte.map(a => (
                    <tr key={a.id}>
                      <td>
                        <span className="rad">
                          <span className="bruker-merke" style={{ width: 30, height: 30, fontSize: 11 }}>
                            {initialer(a.full_name)}
                          </span>
                          <span>
                            <span style={{ fontWeight: 500 }}>
                              {a.full_name || <span className="dempet-mer">Uten navn</span>}
                            </span>
                            {/* Adressen er ikke pynt: når en invitasjon ikke kom
                                fram, er det første man vil se hvilken adresse
                                den faktisk gikk til. */}
                            {a.epost ? <span className="ansatt-epost valgbar">{a.epost}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td className="dempet">{rollenavn(a.role)}</td>
                      <td className="dempet valgbar">{a.phone ?? ''}</td>
                      {/* To spoersmaal i én kolonne, i den rekkefoelgen de
                          faktisk stilles: har hun kommet seg inn, og hvor
                          slipper rollen henne inn når hun gjør det. En som er
                          invitert i gaar og en som har jobbet her i to aar så
                          helt like ut før `firmaets_ansatte()`. */}
                      <td>
                        {!a.har_logget_inn
                          ? <Merke stil="varsel">Invitert</Merke>
                          : a.role === 'montor' || a.role === 'laerling'
                            ? <span className="dempet-mer">Kun app</span>
                            : <Merke stil="noytral">Har tilgang</Merke>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {kan(profil?.role, 'bruker.inviter') ? (
              <div className="inviter-boks"><Inviter ferdig={last} /></div>
            ) : null}
          </Kort>

        </div>

        <div className="stabel">
          <div className="seksjon">
            <div className="seksjon-tittel">Innstillinger</div>
            {!data?.innstillinger ? (
              <p className="dempet-mer">Ingen innstillinger lagret.</p>
            ) : (
              <div className="stabel" style={{ gap: 16 }}>
                <div>
                  <div className="fakta-navn">Organisasjonsnummer</div>
                  <div className="fakta-verdi valgbar">{data.company?.org_number ?? '–'}</div>
                </div>
                <div>
                  <div className="fakta-navn">Oppbevaringstid</div>
                  <div className="fakta-verdi">{data.innstillinger.retention_years} år</div>
                </div>
                <div>
                  {/* Denne personen — ikke rollen «installatør» — er den som får
                      godkjenne faglig. Se `kan_godkjenne_faglig()`. */}
                  <div className="fakta-navn">Faglig ansvarlig</div>
                  <div className="fakta-verdi">{ansvarlig?.full_name ?? 'Ikke satt'}</div>
                </div>
                <div>
                  <div className="fakta-navn">Regnskapssystem</div>
                  <div className="fakta-verdi">
                    {REGNSKAP[data.innstillinger.regnskapssystem] ?? data.innstillinger.regnskapssystem}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="seksjon">
            <div className="seksjon-tittel">Kommer</div>
            <p className="kort-hjelp">
              Endre innstillinger og importere fra SpeedyCraft. Importen hører på denne
              maskinen fordi det er her den gamle databasen ligger.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
