import { kan, rollenavn } from '@delt/kontor-tilgang'
import { useCallback, useEffect, useState } from 'react'
import { hentFirma, type Firmaoppsett } from '@/lib/kontor-lager'
import { Inviter } from '@/ui/Inviter'
import { lagInnmeldingskode, settAmpexPool } from '@/lib/skann-lager'
import { useAuth } from '@/auth'
import { Beskjed, initialer, Knapp, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Firmaoppsettet.
 *
 * Tre ting som alle bor på kontor-PC-en, og ingen andre steder:
 *
 * 1. **Innstillingene** — oppbevaringstid, faglig ansvarlig, regnskapssystem.
 * 2. **Ansatte og roller.** Rollen bestemmer hva folk ser, både her og i appen.
 * 3. **Bake-nodene.** `docs/STATUS.md` slår fast at poolens klientside hører i
 *    Desktop og ikke i montørappen. Dette er begynnelsen på den: se hvilke
 *    maskiner som er meldt inn og om de svarer.
 *
 * Invitasjon er den ene tingen her som SKRIVER. Den gjør det gjennom
 * `supabase/functions/inviter-ansatt`, fordi `profiles.company_id` ikke kan
 * settes fra en klient — se migrasjonen 20260822120000. Resten er fortsatt
 * lesing; endring av innstillinger er neste steg.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
})

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
  const [kode, setKode] = useState<string | null>(null)
  const [poolPa, setPoolPa] = useState<boolean | null>(null)
  const [jobber, setJobber] = useState(false)
  const styrer = kan(profil?.role, 'pool.styr')

  // Trukket ut av useEffect fordi invitasjonen må kunne be om lista på nytt:
  // den som nettopp ble invitert skal stå der med en gang, ikke etter en
  // oppfriskning av siden.
  const last = useCallback(() => {
    hentFirma()
      .then(d => { setData(d); setPoolPa(d.innstillinger?.ampex_pool ?? false) })
      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => { last() }, [last])

  const ansvarlig = data?.ansatte.find(a => a.id === data.innstillinger?.faglig_ansvarlig)

  return (
    <>
      <Sidehode
        tittel="Firma"
        under={data?.company?.name ?? 'Innstillinger, ansatte og bake-noder'}
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

          <Kort tittel="Bake-noder" merkelapp="Maskiner som kan kjøre GPU-bake">
            {!data ? (
              <p className="kort-hjelp">Henter …</p>
            ) : data.noder.length === 0 ? (
              <p className="kort-hjelp">
                Ingen maskiner meldt inn. En PC med skjermkort melder seg inn med en engangskode
                herfra, og blir da firmaets egen bakekapasitet.
              </p>
            ) : (
              <table className="linjer">
                <thead>
                  <tr>
                    <th>Maskin</th>
                    <th>GPU</th>
                    <th className="h" style={{ width: 90 }}>VRAM</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 130 }}>Sist sett</th>
                    <th style={{ width: 90 }}>Pool</th>
                  </tr>
                </thead>
                <tbody>
                  {data.noder.map(n => (
                    <tr key={n.id}>
                      <td style={{ fontWeight: 500 }}>{n.name}</td>
                      <td className="dempet">{n.gpu_name ?? '–'}</td>
                      <td className="h dempet">{n.vram_mb ? `${Math.round(n.vram_mb / 1024)} GB` : '–'}</td>
                      {/* Statusene er tabellens egne: idle, busy, offline.
                          Sto tidligere som online/paused, som er verdier
                          `worker_nodes` ikke kan inneholde — kolonna har en
                          check-constraint. Alt havnet derfor på «Nede». */}
                      <td>
                        {n.revoked_at ? (
                          <Merke stil="feil">Trukket</Merke>
                        ) : n.status === 'idle' ? (
                          <Merke stil="ny">Ledig</Merke>
                        ) : n.status === 'busy' ? (
                          <Merke stil="endret">Baker</Merke>
                        ) : (
                          <Merke stil="noytral">Nede</Merke>
                        )}
                      </td>
                      <td className="dempet-mer">
                        {n.last_heartbeat_at ? DATO.format(new Date(n.last_heartbeat_at)) : 'aldri'}
                      </td>
                      {/* Hvorvidt maskinen tar jobber fra ANDRE firmaer. Verdt
                          en kolonne: det er den ene innstillingen på en node
                          som har noe å si utenfor firmaets egne vegger. */}
                      <td className="dempet-mer">
                        {n.is_public ? 'Ampex' : 'Egen'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* ── Innmelding ────────────────────────────────────────────────
                Koden vises ÉN gang og lever i 30 minutter. Den byttes mot et
                node-token som lagres på PC-en; selve tokenet ser vi aldri, og
                basen lagrer kun en hash av det. */}
            {styrer ? (
              <div style={{ marginTop: 14 }}>
                <Knapp
                  stil="stille"
                  disabled={jobber}
                  onClick={() => {
                    setJobber(true)
                    setFeil(null)
                    lagInnmeldingskode()
                      .then(setKode)
                      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
                      .finally(() => setJobber(false))
                  }}
                >
                  {jobber ? 'Lager kode …' : 'Meld inn en PC'}
                </Knapp>
                {kode ? (
                  <div style={{ marginTop: 12 }}>
                    <p className="felt-hjelp">
                      Kjør dette på maskinen. Koden gjelder i 30 minutter og kan brukes én gang.
                    </p>
                    <pre className="kode-blokk valgbar">ampex-worker enroll --code {kode}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ── Ampex-poolen ──────────────────────────────────────────────
                Dette er ikke en ytelsesbryter. Slått på betyr at et skann —
                LiDAR av kundens bolig — kan pakkes ut på en maskin firmaet
                ikke eier. Basen håndhever det uansett, men den som krysser av
                skal forstå hva han krysser av for. */}
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--kant)' }}>
              <div className="rad" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>Ampex-poolen</div>
                  <p className="felt-hjelp" style={{ margin: '4px 0 0', maxWidth: 460 }}>
                    Har firmaet ingen egen maskin oppe, kan skann bakes hos Ampex etter halvannet
                    minutts ventetid. Da forlater skannet — LiDAR av kundens bolig — firmaets egne
                    maskiner. Av som standard.
                  </p>
                </div>
                <Knapp
                  stil={poolPa ? 'merke' : 'stille'}
                  disabled={!styrer || jobber || poolPa == null}
                  onClick={() => {
                    const ny = !poolPa
                    setJobber(true)
                    setFeil(null)
                    settAmpexPool(ny)
                      .then(() => setPoolPa(ny))
                      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
                      .finally(() => setJobber(false))
                  }}
                >
                  {poolPa ? 'På' : 'Av'}
                </Knapp>
              </div>
              {!styrer ? (
                <p className="felt-hjelp" style={{ marginTop: 8 }}>
                  Bare eier og administrator kan endre dette.
                </p>
              ) : null}
            </div>

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
              Endre innstillinger og importere fra
              SpeedyCraft. Alt tre hører på denne maskinen fordi det er her den gamle databasen
              ligger.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
