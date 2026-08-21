import { rollenavn } from '@delt/kontor-tilgang'
import { useEffect, useState } from 'react'
import { hentFirma, type Firmaoppsett } from '@/lib/kontor-lager'
import { Beskjed, initialer, Kort, Merke, Sidehode, stk } from '@/ui/kit'

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
 * Alt er lesing. Innmeldingskoder og endring av innstillinger er neste steg.
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
  const [data, setData] = useState<Firmaoppsett | null>(null)
  const [feil, setFeil] = useState<string | null>(null)

  useEffect(() => {
    hentFirma().then(setData).catch(e => setFeil(e instanceof Error ? e.message : String(e)))
  }, [])

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
                Ingen profiler ennå. En ansatt får profil første gang hun logger inn i appen.
              </p>
            ) : (
              <table className="linjer">
                <thead>
                  <tr>
                    <th>Navn</th>
                    <th style={{ width: 170 }}>Rolle</th>
                    <th style={{ width: 150 }}>Telefon</th>
                    <th style={{ width: 130 }}>Kontoret</th>
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
                          <span style={{ fontWeight: 500 }}>{a.full_name}</span>
                        </span>
                      </td>
                      <td className="dempet">{rollenavn(a.role)}</td>
                      <td className="dempet valgbar">{a.phone ?? ''}</td>
                      {/* Rollen styrer også om personen slipper inn her. Det er
                          verdt å vise, så ingen leter etter en innlogging som
                          aldri kommer til å virke. */}
                      <td>
                        {a.role === 'montor' || a.role === 'laerling'
                          ? <span className="dempet-mer">Kun app</span>
                          : <Merke stil="noytral">Har tilgang</Merke>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Kort>

          <Kort tittel="Bake-noder" merkelapp="Maskiner som kan kjøre GPU-bake">
            {!data ? (
              <p className="kort-hjelp">Henter …</p>
            ) : data.noder.length === 0 ? (
              <p className="kort-hjelp">
                Ingen noder meldt inn. Kontor-PC-en melder seg inn med en engangskode fra appen, og
                blir da firmaets egen bakekapasitet. Innmelding herfra er ikke bygget ennå.
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
                  </tr>
                </thead>
                <tbody>
                  {data.noder.map(n => (
                    <tr key={n.id}>
                      <td style={{ fontWeight: 500 }}>{n.name}</td>
                      <td className="dempet">{n.gpu_name ?? '–'}</td>
                      <td className="h dempet">{n.vram_mb ? `${Math.round(n.vram_mb / 1024)} GB` : '–'}</td>
                      <td>
                        <Merke stil={n.status === 'online' ? 'ny' : n.status === 'paused' ? 'varsel' : 'noytral'}>
                          {n.status === 'online' ? 'Oppe' : n.status === 'paused' ? 'Pauset' : 'Nede'}
                        </Merke>
                      </td>
                      <td className="dempet-mer">
                        {n.last_seen_at ? DATO.format(new Date(n.last_seen_at)) : 'aldri'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
              Endre innstillinger, lage innmeldingskode for en bake-node, og importere fra
              SpeedyCraft. Alt tre hører på denne maskinen fordi det er her den gamle databasen
              ligger.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
