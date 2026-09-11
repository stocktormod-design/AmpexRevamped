import { rollenavn } from '@delt/kontor-tilgang'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth'
import {
  byttFirma,
  hentFirmaer,
  hentFolk,
  opprettFirma,
  sendPaaNytt,
  type AmpexFirma,
  type AmpexPerson,
} from '@/lib/brukere'
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

/**
 * Hva knappen ved siden av personen kommer til å sende.
 *
 * Speiler Edge Functionen, som speiler GoTrue: `/invite` avviser en bruker som
 * har bekreftet e-posten sin, fordi en invitasjon er måten en konto blir til.
 * Har hun alt laget seg en, er det veien INN i den hun mangler.
 *
 * Skjermen gjetter altså ikke — den viser den samme regelen serveren handler
 * etter, så teksten på knappen og e-posten som kommer fram er samme sak.
 */
function harKonto(p: AmpexPerson): boolean {
  return p.bekreftet_at !== null
}

export function AmpexAdmin() {
  const { profil } = useAuth()
  const [firmaer, setFirmaer] = useState<AmpexFirma[] | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [bytter, setBytter] = useState<string | null>(null)

  /**
   * Ett firma om gangen er utvidet.
   *
   * Ikke et sett: to åpne lister med folk under hver sin firmarad gjør tabellen
   * til noe man må lete i. Den som purrer holder på med ett firma.
   */
  const [vist, setVist] = useState<string | null>(null)
  const [folk, setFolk] = useState<AmpexPerson[] | null>(null)
  const [folkfeil, setFolkfeil] = useState<string | null>(null)
  const [sender, setSender] = useState<string | null>(null)
  const [sendt, setSendt] = useState<string | null>(null)

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

  /**
   * Bytt hvilket firma DU står i, og last siden på nytt.
   *
   * Oppfriskning og ikke en pen tilstandsoppdatering, med vilje: alt som
   * allerede er hentet — ordrer, varer, internkontroll, ansatte — tilhører det
   * gamle firmaet. Å friske opp tolv spørringer i riktig rekkefølge er en
   * feilkilde; å laste på nytt er én linje som ikke kan ta feil.
   */
  async function bytt(f: AmpexFirma) {
    setBytter(f.id)
    setFeil(null)
    try {
      await byttFirma(f.id)
      window.location.assign(window.location.pathname)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
      setBytter(null)
    }
  }

  /** Slå opp folkene i ett firma, eller lukk lista igjen. */
  async function vis(f: AmpexFirma) {
    setSendt(null)
    setFolkfeil(null)
    if (vist === f.id) { setVist(null); setFolk(null); return }
    setVist(f.id)
    setFolk(null)
    try {
      setFolk(await hentFolk(f.id))
    } catch (e) {
      setFolk([])
      setFolkfeil(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * Send lenken en gang til.
   *
   * Hvilken av de to det blir avgjøres på serveren, ikke her — se
   * `sendPaaNytt()`. Kvitteringen sier hva som FAKTISK gikk ut, og ikke hva
   * knappen het da den ble trykket: står skjermen på en liste som er et minutt
   * gammel, kan personen ha tatt imot invitasjonen i mellomtiden.
   *
   * Lista hentes på nytt etterpå, så `invitert_at` og statusmerket stemmer med
   * det som nettopp skjedde.
   */
  async function purr(person: AmpexPerson, firmaId: string) {
    setSender(person.id)
    setSendt(null)
    setFolkfeil(null)
    try {
      const ut = await sendPaaNytt(person.id)
      setSendt(
        ut.slag === 'invitasjon'
          ? `Ny invitasjon sendt til ${ut.epost}.`
          : `Passordlenke sendt til ${ut.epost} — kontoen fantes fra før.`,
      )
      setFolk(await hentFolk(firmaId))
    } catch (e) {
      setFolkfeil(e instanceof Error ? e.message : String(e))
    }
    setSender(null)
  }

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
                  <th style={{ width: 210 }} />
                </tr>
              </thead>
              <tbody>
                {firmaer.map(f => (
                  <Fragment key={f.id}>
                  <tr>
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
                    {/* Du står i ett av dem. Resten kan du bytte til — og da
                        ser du nøyaktig det kunden ser, ikke en anelse om det. */}
                    <td className="h">
                      <div className="rad" style={{ justifyContent: 'flex-end' }}>
                        {f.ansatte === 0 ? null : (
                          <Knapp type="button" onClick={() => void vis(f)}>
                            {vist === f.id ? 'Skjul folk' : 'Folk'}
                          </Knapp>
                        )}
                        {profil?.company_id === f.id ? (
                          <span className="dempet-mer">Du er her</span>
                        ) : f.deleted_at ? null : (
                          <Knapp type="button" disabled={bytter !== null} onClick={() => void bytt(f)}>
                            {bytter === f.id ? 'Bytter …' : 'Bytt til'}
                          </Knapp>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Folkene i firmaet, med den ene knappen som purrer.
                      Under firmaraden og ikke på en egen skjerm: spørsmålet
                      «har eieren kommet inn?» er det samme spørsmålet som
                      «Uten eier»-merket til venstre nettopp stilte. */}
                  {vist === f.id ? (
                    <tr className="folk-rad">
                      <td colSpan={6}>
                        {folkfeil ? <Beskjed stil="feil">{folkfeil}</Beskjed> : null}
                        {sendt ? <Beskjed stil="ok">{sendt}</Beskjed> : null}
                        {!folk ? (
                          <p className="kort-hjelp">Henter …</p>
                        ) : folk.length === 0 ? (
                          <p className="kort-hjelp">Ingen folk i firmaet.</p>
                        ) : (
                          <table className="linjer">
                            <tbody>
                              {folk.map(person => (
                                <tr key={person.id}>
                                  <td style={{ fontWeight: 500 }}>
                                    {person.full_name || '—'}
                                  </td>
                                  <td className="dempet valgbar">{person.epost}</td>
                                  <td className="dempet" style={{ width: 140 }}>
                                    {rollenavn(person.role)}
                                  </td>
                                  <td style={{ width: 150 }}>
                                    {person.deleted_at
                                      ? <Merke stil="feil">Trukket</Merke>
                                      : !harKonto(person)
                                        ? <Merke stil="varsel">Ikke tatt imot</Merke>
                                        : person.sist_innlogget_at
                                          ? <Merke stil="noytral">Har tilgang</Merke>
                                          : <Merke stil="ny">Konto laget</Merke>}
                                  </td>
                                  <td className="dempet h" style={{ width: 150 }}>
                                    {person.invitert_at
                                      ? `Invitert ${DATO.format(new Date(person.invitert_at))}`
                                      : null}
                                  </td>
                                  <td className="h" style={{ width: 210 }}>
                                    {person.deleted_at ? null : (
                                      <Knapp
                                        type="button"
                                        disabled={sender !== null}
                                        onClick={() => void purr(person, f.id)}
                                      >
                                        {sender === person.id
                                          ? 'Sender …'
                                          : harKonto(person)
                                            ? 'Send passordlenke'
                                            : 'Inviter på nytt'}
                                      </Knapp>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
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
                    lagre halvveis.
                    
                    Rollen er ALLTID `owner`, og det er ikke en forenkling.
                    `kan_skrive_ik()` slipper inn owner, admin og installatør,
                    så en installatør ville fått internkontrollen — men han kan
                    ikke invitere noen (`bruker.inviter` er kun eier og admin).
                    Et firma som starter med en installatør alene er et firma
                    som aldri kan vokse uten at vi går inn i basen igjen. */}
                <div className="inviter-felt">
                  <Felt
                    etikett="Eierens navn"
                    firkant
                    hjelp="I et enmannsforetak er dette installatøren selv."
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
