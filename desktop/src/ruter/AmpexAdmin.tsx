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

/** «i dag 14:02», «i går», «3 d siden», «12. okt.» — sist aktiv skal leses på et blikk. */
function siden(iso: string | null | undefined): string {
  if (!iso) return 'Aldri'
  const t = new Date(iso), naa = new Date()
  const min = Math.round((naa.getTime() - t.getTime()) / 60000)
  if (min < 2) return 'Nå'
  if (min < 60) return `${min} min siden`
  const dager = Math.floor((new Date(naa.toDateString()).getTime() - new Date(t.toDateString()).getTime()) / 86400000)
  if (dager === 0) return `I dag ${t.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`
  if (dager === 1) return 'I går'
  if (dager < 14) return `${dager} d siden`
  return DATO.format(t)
}

/** iPhone18,2 → iPhone 17 Pro Max. Bare de vi faktisk har sett; resten vises rått. */
const MODELLER: Record<string, string> = {
  'iPhone18,1': 'iPhone 17 Pro', 'iPhone18,2': 'iPhone 17 Pro Max', 'iPhone18,3': 'iPhone 17',
  'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max', 'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus',
  'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max', 'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus',
  'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max', 'iPhone14,7': 'iPhone 14', 'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
}

/** Hele dager siden, eller null. */
function dagerSiden(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.floor((new Date(new Date().toDateString()).getTime() - new Date(new Date(iso).toDateString()).getTime()) / 86400000)
}

type Helse = { stil: 'ok' | 'varsel' | 'feil'; tekst: string; trenger: boolean }

/**
 * Ett svar per firma på «bruker de det?» (DeepSeek-forslaget 08.11).
 *
 * Fargen er prikken og bare den: grønn = i bruk, gul = stille, rød = noe er
 * galt som vi må fikse. Et firma som er i bruk får ingen merkelapp — det er
 * normen, og normen skal være stille.
 */
function helse(f: AmpexFirma): Helse {
  if (f.deleted_at) return { stil: 'feil', tekst: 'Slettet', trenger: false }
  const apne = (f.tilbakemeldinger_apne ?? 0) > 0
  if ((f.eiere ?? f.aktive) === 0) return { stil: 'feil', tekst: 'Mangler eier', trenger: true }
  const d = dagerSiden(f.sist_aktiv)
  if (d === null) return { stil: 'varsel', tekst: 'Aldri brukt', trenger: true }
  if (d >= 14) return { stil: 'varsel', tekst: `Stille i ${d} dager`, trenger: true }
  return { stil: 'ok', tekst: d === 0 ? 'Aktiv i dag' : d === 1 ? 'Aktiv i går' : `Aktiv for ${d} dager siden`, trenger: apne }
}

const PRIKK: Record<Helse['stil'], string> = { ok: 'var(--gronn)', varsel: 'var(--gul)', feil: 'var(--rod)' }

function Prikk({ stil }: { stil: Helse['stil'] }) {
  return <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: PRIKK[stil], marginRight: 8, verticalAlign: 1 }} />
}

/** En lenkeknapp i helselinja: tallet ER filteret. */
function Filterlenke({ paa, onClick, children }: { paa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', color: 'inherit',
        textDecoration: paa ? 'none' : 'underline', textUnderlineOffset: 3, fontWeight: paa ? 600 : 'inherit' }}>
      {children}
    </button>
  )
}

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
  const [filter, setFilter] = useState<'alle' | 'oppmerksomhet' | 'tilbakemeldinger'>('alle')
  const [meny, setMeny] = useState<string | null>(null)

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

  // En feil ved henting skal ikke se ut som en tom kundeliste: siste data blir
  // stående, og feilen står over med en «Prøv igjen».
  const last = useCallback(() => {
    setFeil(null)
    hentFirmaer()
      .then(f => setFirmaer(f))
      .catch(e => { setFirmaer(f => f ?? []); setFeil(e instanceof Error ? e.message : String(e)) })
  }, [])

  useEffect(() => { last() }, [last])

  // ⋯-menyen lukkes av et klikk hvor som helst ellers.
  useEffect(() => {
    if (!meny) return
    const lukk = () => setMeny(null)
    window.addEventListener('click', lukk)
    return () => window.removeEventListener('click', lukk)
  }, [meny])

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
      setKvittering(`${laget.navn} er opprettet. Invitasjon sendt til ${laget.eier_epost}.`)
      setNavn(''); setOrgNr(''); setEierEpost(''); setEierNavn(''); setApen(false)
      last()
    } catch (e) {
      setSkjemafeil(e instanceof Error ? e.message : String(e))
    }
    setJobber(false)
  }

  const levende = (firmaer ?? []).filter(f => !f.deleted_at)
  const her = (firmaer ?? []).find(f => f.id === profil?.company_id)
  const trenger = levende.filter(f => helse(f).trenger)
  const stille = levende.filter(f => { const d = dagerSiden(f.sist_aktiv); return d === null || d >= 14 })
  const apneTilb = levende.reduce((n, f) => n + (f.tilbakemeldinger_apne ?? 0), 0)
  const viste = (firmaer ?? []).filter(f =>
    filter === 'oppmerksomhet' ? helse(f).trenger
      : filter === 'tilbakemeldinger' ? (f.tilbakemeldinger_apne ?? 0) > 0
        : true)

  /**
   * Se Ampex slik kunden ser det: bytt hvilket firma DU står i, og last siden
   * på nytt.
   *
   * Oppfriskning og ikke en pen tilstandsoppdatering, med vilje: alt som
   * allerede er hentet — ordrer, varer, internkontroll, ansatte — tilhører det
   * gamle firmaet. Å friske opp tolv spørringer i riktig rekkefølge er en
   * feilkilde; å laste på nytt er én linje som ikke kan ta feil.
   *
   * Bekreftelsen navngir firmaet: alt du gjør etterpå føres på DEM.
   */
  async function bytt(f: AmpexFirma) {
    if (!window.confirm(`Se Ampex som ${f.name}?\n\nAlt du gjør etterpå føres på ${f.name} til du bytter tilbake her.`)) return
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
   * Send lenken en gang til. Ett klikk, ingen bekreftelse: det er den vanligste
   * hjelpen, og kvitteringen navngir adressen.
   *
   * Hvilken av de to det blir avgjøres på serveren, ikke her — se
   * `sendPaaNytt()`. Kvitteringen sier hva som FAKTISK gikk ut, og ikke hva
   * knappen het da den ble trykket.
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
          : `Lenke for nytt passord sendt til ${ut.epost}. Kontoen fantes fra før.`,
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
        handling={<Knapp stil="merke" onClick={() => { setApen(true); setKvittering(null) }}>Nytt firma</Knapp>}
      />

      <div className="stabel">
        {her ? (
          <p className="dempet" style={{ margin: 0 }}>Du står i <b>{her.name}</b>.</p>
        ) : null}

        {feil ? (
          <Beskjed stil="feil">
            Fikk ikke hentet firmaene ({feil}).{' '}
            <Knapp type="button" onClick={last}>Prøv igjen</Knapp>
          </Beskjed>
        ) : null}
        {kvittering ? <Beskjed stil="ok">{kvittering}</Beskjed> : null}

        {/* Nytt firma: øverst, der knappen er, og ikke under lista. */}
        {apen ? (
          <Kort tittel="Nytt firma">
            <form className="stabel" onSubmit={opprett}>
              <div className="inviter-felt">
                <Felt etikett="Firmanavn" firkant autoFocus value={navn} onChange={e => setNavn(e.target.value)} />
                <Felt etikett="Organisasjonsnummer (valgfritt)" firkant inputMode="numeric" value={orgNr} onChange={e => setOrgNr(e.target.value)} />
              </div>
              {/* Eieren opprettes i samme slengen, og rollen er ALLTID `owner`:
                  et firma uten eier er et firma ingen kan invitere noen inn i. */}
              <div className="inviter-felt">
                <Felt etikett="Eierens navn" firkant value={eierNavn} onChange={e => setEierNavn(e.target.value)} />
                <Felt etikett="Eierens e-post" type="email" inputMode="email" firkant value={eierEpost} onChange={e => setEierEpost(e.target.value)} />
              </div>
              {navn && eierEpost ? (
                <p className="dempet" style={{ margin: 0 }}>{navn} → invitasjon til {eierEpost.trim()}</p>
              ) : null}
              {skjemafeil ? <Beskjed stil="feil">{skjemafeil}</Beskjed> : null}
              <div className="rad">
                <Knapp stil="merke" type="submit" disabled={jobber || !navn || !eierNavn || !eierEpost}>
                  {jobber ? 'Oppretter …' : 'Opprett firma og inviter eier'}
                </Knapp>
                <Knapp type="button" onClick={() => { setApen(false); setSkjemafeil(null) }}>Avbryt</Knapp>
              </div>
            </form>
          </Kort>
        ) : null}

        {/* Helselinja: fire tall, og de to som krever noe av deg er filtre. */}
        {firmaer && levende.length > 0 ? (
          <p style={{ margin: 0, fontSize: 15 }}>
            <Filterlenke paa={filter === 'alle'} onClick={() => setFilter('alle')}>{stk(levende.length, 'firma', 'firmaer')}</Filterlenke>
            {' · '}{levende.filter(f => (dagerSiden(f.sist_aktiv) ?? 99) < 7).length} i bruk siste 7 dager
            {trenger.length ? <>{' · '}<Filterlenke paa={filter === 'oppmerksomhet'} onClick={() => setFilter('oppmerksomhet')}>{trenger.length} trenger deg</Filterlenke></> : null}
            {stille.length ? <span className="dempet">{' · '}{stille.length} stille i 14 dager</span> : null}
            {apneTilb ? <>{' · '}<Filterlenke paa={filter === 'tilbakemeldinger'} onClick={() => setFilter('tilbakemeldinger')}>{stk(apneTilb, 'åpen tilbakemelding', 'åpne tilbakemeldinger')}</Filterlenke></> : null}
          </p>
        ) : null}

        <Kort tittel="Firmaer">
          {!firmaer ? (
            <p className="kort-hjelp">Henter …</p>
          ) : firmaer.length === 0 && !feil ? (
            <div className="stabel">
              <p className="kort-hjelp">Ingen firmaer ennå. Opprett det første.</p>
              <div><Knapp stil="merke" onClick={() => setApen(true)}>Nytt firma</Knapp></div>
            </div>
          ) : viste.length === 0 ? (
            <p className="kort-hjelp">Ingenting her. <Filterlenke paa={false} onClick={() => setFilter('alle')}>Vis alle</Filterlenke></p>
          ) : (
            <table className="linjer">
              <thead>
                <tr>
                  <th>Firma</th>
                  <th style={{ width: 230 }}>Bruk</th>
                  <th style={{ width: 60 }}>AI</th>
                  <th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {viste.map(f => {
                  const h = helse(f)
                  return (
                  <Fragment key={f.id}>
                  {/* Hele raden åpner personene. Det er det du vil i ni av ti. */}
                  <tr onClick={() => void vis(f)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {f.name}
                        {profil?.company_id === f.id ? <span className="dempet-mer" style={{ fontWeight: 400 }}> · du er her</span> : null}
                      </div>
                      <div className="dempet-mer" style={{ fontSize: 12 }}>
                        {[
                          f.org_number ? orgnummer(f.org_number) : null,
                          f.prosjekter === undefined ? null : stk(f.prosjekter, 'prosjekt', 'prosjekter'),
                          f.tegninger === undefined ? null : stk(f.tegninger, 'tegning', 'tegninger'),
                          f.ordre === undefined ? null : stk(f.ordre, 'ordre', 'ordre'),
                          f.skann === undefined ? null : stk(f.skann, 'skann', 'skann'),
                          f.tilbakemeldinger_apne ? stk(f.tilbakemeldinger_apne, 'åpen tilbakemelding', 'åpne tilbakemeldinger') : null,
                        ].filter(Boolean).join(' · ') || `Opprettet ${DATO.format(new Date(f.created_at))}`}
                      </div>
                    </td>
                    <td>
                      <div><Prikk stil={h.stil} />{h.tekst}</div>
                      <div className="dempet-mer" style={{ fontSize: 12 }} title={`${f.aktive_30d ?? '–'} i bruk siste 30 dager`}>
                        {f.aktive_7d ?? '–'} av {stk(f.aktive, 'person', 'personer')} i bruk siste 7 d
                      </div>
                    </td>
                    <td className="dempet" title={f.stemme_min_30d ? `${f.stemme_min_30d} min stemme siste 30 d` : undefined}>
                      {f.ai_tier === 'av' ? 'Av' : f.ai_tier ? 'På' : '–'}
                    </td>
                    <td className="h" onClick={e => e.stopPropagation()}>
                      <div className="rad" style={{ justifyContent: 'flex-end', position: 'relative' }}>
                        <Knapp type="button" onClick={() => void vis(f)}>
                          {vist === f.id ? 'Skjul' : 'Personer'}
                        </Knapp>
                        {f.deleted_at || profil?.company_id === f.id ? null : (
                          <>
                            <Knapp type="button" aria-label={`Mer for ${f.name}`}
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setMeny(meny === f.id ? null : f.id) }}>
                              ⋯
                            </Knapp>
                            {meny === f.id ? (
                              <div className="kort" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 5, padding: 4, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                                <Knapp stil="naken" type="button" disabled={bytter !== null} onClick={() => void bytt(f)}>
                                  {bytter === f.id ? 'Bytter …' : 'Se som kunde'}
                                </Knapp>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {vist === f.id ? (
                    <tr className="folk-rad">
                      <td colSpan={4}>
                        {folkfeil ? <Beskjed stil="feil">{folkfeil}</Beskjed> : null}
                        {sendt ? <Beskjed stil="ok">{sendt}</Beskjed> : null}
                        {!folk ? (
                          <p className="kort-hjelp">Henter …</p>
                        ) : folk.length === 0 ? (
                          <p className="kort-hjelp">Ingen personer i dette firmaet ennå.</p>
                        ) : (
                          <table className="linjer">
                            <tbody>
                              {folk.map(person => {
                                // Merke bare når noe er galt. Den som har tilgang er normen.
                                const merke = person.deleted_at ? <Merke stil="feil">Trukket</Merke>
                                  : !harKonto(person) ? <Merke stil="varsel">Ikke tatt imot</Merke>
                                    : !person.sist_innlogget_at ? <Merke stil="varsel">Aldri logget inn</Merke>
                                      : null
                                const enhet = [
                                  person.modell ? (MODELLER[person.modell] ?? person.modell) : null,
                                  person.os,
                                  person.bygg ? `bygg ${person.bygg}` : person.app_versjon,
                                ].filter(Boolean).join(' · ')
                                return (
                                <tr key={person.id}>
                                  <td>
                                    <div style={{ fontWeight: 500 }}>{person.full_name || '—'} <span className="dempet" style={{ fontWeight: 400 }}>· {rollenavn(person.role)}</span></div>
                                    <div className="dempet valgbar" style={{ fontSize: 13 }}>{person.epost}</div>
                                  </td>
                                  <td style={{ fontSize: 13 }}>
                                    <div>{merke ?? <>Sist i bruk: {siden(person.sist_aktiv)}{person.skann ? ` · ${stk(person.skann, 'skann', 'skann')}` : ''}</>}</div>
                                    <div className="dempet-mer" style={{ fontSize: 12 }}>
                                      {enhet || (person.invitert_at && !harKonto(person) ? `Invitert ${DATO.format(new Date(person.invitert_at))}` : 'Ingen telefon rapportert')}
                                    </div>
                                  </td>
                                  <td className="h" style={{ width: 210 }}>
                                    {person.deleted_at ? null : (
                                      <Knapp type="button" disabled={sender !== null} onClick={() => void purr(person, f.id)}>
                                        {sender === person.id ? 'Sender …' : harKonto(person) ? 'Send nytt passord' : 'Send invitasjon igjen'}
                                      </Knapp>
                                    )}
                                  </td>
                                </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </Kort>
      </div>
    </>
  )
}
