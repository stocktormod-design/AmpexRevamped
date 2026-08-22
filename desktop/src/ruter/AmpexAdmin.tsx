import { useCallback, useEffect, useState } from 'react'
import { hentFirmaer, opprettFirma, type AmpexFirma } from '@/lib/brukere'
import { Beskjed, Felt, Knapp, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Ampex-flata.
 *
 * Den ene skjermen i kontorappen som IKKE tilhører et firma. Her opprettes
 * kundene, og lista er lista over alle sammen.
 *
 * ── Hvorfor firmaer ikke er selvbetjening ─────────────────────────────────
 *
 * Et firma er en tenancy. Alt i basen er isolert per `company_id`, og den som
 * oppretter et firma blir eier av det med én gang. En registreringsside på
 * ampex.no ville betydd at hvem som helst kan lage seg en tenancy hos oss, og
 * at «hvem er kunde» blir noe man må telle rader for å svare på.
 *
 * ── Hvorfor flata ikke er hemmelig, men usynlig ───────────────────────────
 *
 * Ruta finnes bare i menyen for den som står i `ampex_admins`, men det er
 * ikke sikkerheten — den som kjenner `#/ampex` kommer hit uansett. Sikkerheten
 * er at Edge Functionen svarer «Ukjent handling» til alle andre. Skjermen viser
 * da tomme lister og en feilmelding, som er nøyaktig så mye den skal røpe.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

/** Bare til visning. Den ekte kontrollen ligger i Edge Functionen. */
function orgnummer(n: string | null): string {
  if (!n) return '–'
  return /^\d{9}$/.test(n) ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n
}

export function AmpexAdmin() {
  const [firmaer, setFirmaer] = useState<AmpexFirma[] | null>(null)
  const [feil, setFeil] = useState<string | null>(null)

  const [apen, setApen] = useState(false)
  const [navn, setNavn] = useState('')
  const [orgNr, setOrgNr] = useState('')
  const [eierEpost, setEierEpost] = useState('')
  const [eierNavn, setEierNavn] = useState('')
  const [jobber, setJobber] = useState(false)
  const [skjemafeil, setSkjemafeil] = useState<string | null>(null)
  const [kvittering, setKvittering] = useState<string | null>(null)

  const last = useCallback(() => {
    hentFirmaer()
      .then(f => { setFirmaer(f); setFeil(null) })
      .catch(e => { setFirmaer([]); setFeil(e instanceof Error ? e.message : String(e)) })
  }, [])

  useEffect(() => { last() }, [last])

  async function opprett(ev: React.FormEvent) {
    ev.preventDefault()
    setJobber(true)
    setSkjemafeil(null)
    try {
      const laget = await opprettFirma({
        navn,
        org_nummer: orgNr,
        eier_epost: eierEpost,
        eier_navn: eierNavn,
      })
      setKvittering(
        `${laget.navn} er opprettet. Invitasjonen gikk til ${laget.eier_epost} — eieren velger sitt eget passord og legger inn resten av folkene selv.`,
      )
      setNavn(''); setOrgNr(''); setEierEpost(''); setEierNavn(''); setApen(false)
      last()
    } catch (e) {
      setSkjemafeil(e instanceof Error ? e.message : String(e))
    }
    setJobber(false)
  }

  const aktive = (firmaer ?? []).filter(f => !f.deleted_at)

  return (
    <>
      <Sidehode
        tittel="Ampex"
        under="Kundene. Denne flata tilhører ingen av dem."
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="stabel">
        <Kort
          tittel="Firmaer"
          merkelapp={firmaer ? stk(aktive.length, 'firma', 'firmaer') : undefined}
        >
          {!firmaer ? (
            <p className="kort-hjelp">Henter …</p>
          ) : firmaer.length === 0 ? (
            <p className="kort-hjelp">Ingen firmaer ennå.</p>
          ) : (
            <table className="linjer">
              <thead>
                <tr>
                  <th>Firma</th>
                  <th style={{ width: 160 }}>Org.nr</th>
                  <th className="h" style={{ width: 100 }}>Ansatte</th>
                  <th style={{ width: 140 }}>Opprettet</th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {firmaer.map(f => (
                  <tr key={f.id}>
                    <td style={{ fontWeight: 500 }}>{f.name}</td>
                    <td className="dempet valgbar h">{orgnummer(f.org_number)}</td>
                    <td className="h dempet">{f.aktive}</td>
                    <td className="dempet h">{DATO.format(new Date(f.created_at))}</td>
                    <td>
                      {f.deleted_at
                        ? <Merke stil="feil">Slettet</Merke>
                        : f.aktive === 0
                          ? <Merke stil="varsel">Uten eier</Merke>
                          : <Merke stil="noytral">Aktivt</Merke>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="inviter-boks">
            {!apen ? (
              <div className="stabel">
                {kvittering ? <Beskjed stil="ok">{kvittering}</Beskjed> : null}
                {/* Egen blokk rundt knappen: `.stabel` strekker barna sine, og
                    en «Nytt firma»-knapp i full kortbredde leser som flatens
                    hovedhandling. Det er den ikke — lista over den er det. */}
                <div>
                  <Knapp stil="merke" onClick={() => { setApen(true); setKvittering(null) }}>
                    Nytt firma
                  </Knapp>
                </div>
              </div>
            ) : (
              <form className="stabel" onSubmit={opprett}>
                <div className="inviter-felt">
                  <Felt
                    etikett="Firmanavn"
                    firkant
                    autoFocus
                    value={navn}
                    onChange={e => setNavn(e.target.value)}
                  />
                  <Felt
                    etikett="Organisasjonsnummer"
                    firkant
                    inputMode="numeric"
                    hjelp="Ni siffer. Kontrollsifferet sjekkes."
                    value={orgNr}
                    onChange={e => setOrgNr(e.target.value)}
                  />
                </div>
                {/* Eieren opprettes i samme slengen. Et firma uten eier er et
                    firma ingen kommer inn i, og da er det ingenting verdt å
                    lagre halvveis. */}
                <div className="inviter-felt">
                  <Felt
                    etikett="Eierens navn"
                    firkant
                    value={eierNavn}
                    onChange={e => setEierNavn(e.target.value)}
                  />
                  <Felt
                    etikett="Eierens e-post"
                    type="email"
                    inputMode="email"
                    firkant
                    hjelp="Får invitasjonen og velger sitt eget passord."
                    value={eierEpost}
                    onChange={e => setEierEpost(e.target.value)}
                  />
                </div>
                {skjemafeil ? <Beskjed stil="feil">{skjemafeil}</Beskjed> : null}
                <div className="rad">
                  <Knapp
                    stil="merke"
                    type="submit"
                    disabled={jobber || !navn || !eierNavn || !eierEpost}
                  >
                    {jobber ? 'Oppretter …' : 'Opprett firma og inviter eier'}
                  </Knapp>
                  <Knapp type="button" onClick={() => { setApen(false); setSkjemafeil(null) }}>
                    Avbryt
                  </Knapp>
                </div>
              </form>
            )}
          </div>
        </Kort>
      </div>
    </>
  )
}
