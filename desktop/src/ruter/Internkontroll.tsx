import { erForfalt, fullstendighet, IK_GRUPPENAVN, IK_SKJELETT, nesteGjennomgang } from '@delt/ik/skjelett'
import { kan } from '@delt/kontor-tilgang'
import { CircleCheck, CircleDashed, FileText, Pencil, Plus, TriangleAlert, Trash2, Unlink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import {
  bekreftLest,
  hentAuditFor,
  hentLesinger,
  hentPunkter,
  hentRevisjoner,
  hentRutiner,
  hentRutinerevisjoner,
  hentSkjemakoblinger,
  hentSkjemamaler,
  knyttSkjema,
  kvitterGjennomgang,
  lagreEndring,
  lagreRutineendring,
  loesnaSkjema,
  opprettRutine,
  opprettSkjelett,
  slettRutine,
  vedta,
  vedtaRutine,
  type Endring,
  type IkPunkt,
  type IkRutine,
  type Lesing,
  type Rutineendring,
  type Skjemakobling,
  type Skjemamal,
} from '@/lib/ik-lager'
import { hentFirma } from '@/lib/kontor-lager'
import { Historikk } from '@/ui/Historikk'
import { antall, Beskjed, Felt, Knapp, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Internkontroll.
 *
 * Dette er faglig ansvarligs flate. Han bygger firmaets IK-system punkt for
 * punkt, og systemet holder seg selv i live på tre måter:
 *
 * - **Gjennomgangsfristen.** Hvert punkt har et intervall og en dato for sist
 *   gjennomgang. Går fristen ut, sier punktet fra selv. Uten dette blir et
 *   IK-system en perm i hylla, som er nøyaktig det forskriften vil hindre.
 * - **Revisjonene.** Hver endring arkiveres med hele teksten og et påkrevd
 *   endringsnotat. Skal man dokumentere hva rutinen SA den dagen noe skjedde,
 *   holder det ikke å vite hva den sier nå.
 * - **Endringsloggen.** Databasetriggeren `audit_row` fører hvem som gjorde hva.
 *   Loggen skrives av basen, ikke av appen.
 *
 * Fullstendigheten måles bare mot de fem punktene forskriften krever skriftlig.
 * Et firma med fjorten fine kapitler og ingen avvikshåndtering har ikke et
 * internkontrollsystem, og en prosent som sa 93 % ville skjult det.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

function dato(v: string | Date | null | undefined): string {
  if (!v) return '–'
  return DATO.format(typeof v === 'string' ? new Date(v) : v)
}

const GRUPPE_FOR: Record<string, string> = Object.fromEntries(
  IK_SKJELETT.map(p => [p.nummer, IK_GRUPPENAVN[p.gruppe]]),
)
const HINT_FOR: Record<string, string> = Object.fromEntries(IK_SKJELETT.map(p => [p.nummer, p.hint]))

export function Internkontroll() {
  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'ik.skriv')

  const [punkter, setPunkter] = useState<IkPunkt[]>([])
  const [rutiner, setRutiner] = useState<Map<string, IkRutine[]>>(new Map())
  const [koblinger, setKoblinger] = useState<Map<string, Skjemakobling[]>>(new Map())
  const [lesinger, setLesinger] = useState<Map<string, Lesing[]>>(new Map())
  const [maler, setMaler] = useState<Skjemamal[]>([])
  const [ansatte, setAnsatte] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [valgt, setValgt] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const [jobber, setJobber] = useState(false)

  const last = useCallback(async () => {
    setLaster(true)
    try {
      const [p, r, k, l, m, a] = await Promise.all([
        hentPunkter(),
        hentRutiner(),
        hentSkjemakoblinger(),
        hentLesinger(),
        hentSkjemamaler(),
        hentFirma(),
      ])
      setPunkter(p)
      setRutiner(r)
      setKoblinger(k)
      setLesinger(l)
      setMaler(m)
      setAnsatte(a.ansatte)
      setFeil(null)
      setValgt(v => (v && p.some((x: IkPunkt) => x.id === v) ? v : (p[0]?.id ?? null)))
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setLaster(false)
    }
  }, [])

  useEffect(() => { void last() }, [last])

  const naa = useMemo(() => new Date(), [])

  /**
   * Har kapittelet minst én rutine med tekst?
   *
   * En rutine uten innhold er en overskrift noen har opprettet og ikke skrevet
   * ferdig. Den skal telle som «påbegynt», ikke som «på plass» — ellers ville
   * fullstendigheten kunne fylles opp med tomme titler.
   */
  const harRutine = useCallback(
    (id: string) => (rutiner.get(id) ?? []).some(r => r.innhold?.trim()),
    [rutiner],
  )

  const status = useMemo(
    () => fullstendighet(punkter.map(p => ({
      nummer: p.nummer,
      harRutine: harRutine(p.id),
      status: p.status,
      maaVaereSkriftlig: p.maaVaereSkriftlig,
    }))),
    [punkter, harRutine],
  )
  const forfalte = punkter.filter(p => erForfalt(p.sist_gjennomgatt, p.gjennomgang_intervall_mnd, naa))
  const medInnhold = punkter.filter(p => harRutine(p.id)).length

  // De lovpålagte først og for seg. Resten følger skjelettets egne grupper, og
  // punkter firmaet har lagt til selv havner sist under «Egne punkter».
  const grupper = useMemo(() => {
    const ut: { navn: string; punkter: IkPunkt[] }[] = []
    const legg = (navn: string, p: IkPunkt) => {
      const siste = ut[ut.length - 1]
      if (siste && siste.navn === navn) siste.punkter.push(p)
      else ut.push({ navn, punkter: [p] })
    }
    for (const p of punkter) {
      legg(p.maaVaereSkriftlig ? 'Lovpålagt skriftlig' : (GRUPPE_FOR[p.nummer] ?? 'Egne punkter'), p)
    }
    return ut
  }, [punkter])
  const aktiv = punkter.find(p => p.id === valgt) ?? null

  async function start() {
    if (!profil) return
    setJobber(true)
    try {
      await opprettSkjelett(profil.id)
      await last()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(false)
    }
  }

  if (!laster && punkter.length === 0) {
    return (
      <>
        <Sidehode tittel="Internkontroll" under="Firmaets IK-system" />
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
        <Kort tittel="Ingen internkontroll opprettet ennå">
          <p className="kort-hjelp">
            Ampex kan sette opp et skjelett med {antall(IK_SKJELETT.length)} punkter: de fem
            internkontrollforskriften krever skriftlig, de tre som er bindende uten krav om
            skriftlighet, fem elektrofaglige om kvalifikasjoner, sluttkontroll, samsvarserklæring,
            overlevering og instrumenter, og ett om oppbevaring.
          </p>
          <p className="kort-hjelp" style={{ marginTop: 14 }}>
            Punktene kommer med formål og hjemmel, men <strong>uten innhold</strong>. Rutinene må
            firmaet skrive selv — et IK-system skrevet av leverandøren er nettopp den døde permen
            forskriften skal hindre. Hjemmelshenvisningene er et utgangspunkt, og faglig ansvarlig
            må kontrollere dem mot gjeldende forskrift.
          </p>
          <div style={{ marginTop: 20 }}>
            <Knapp stil="merke" onClick={start} disabled={!kanSkrive || jobber}>
              {jobber ? 'Oppretter …' : 'Opprett skjelettet'}
            </Knapp>
          </div>
          {!kanSkrive ? (
            <p className="felt-hjelp" style={{ marginTop: 12 }}>
              Krever eier, administrator eller installatør.
            </p>
          ) : null}
        </Kort>
      </>
    )
  }

  return (
    <>
      <Sidehode
        tittel="Internkontroll"
        under={`${status.pa_plass} av ${status.kreves} skriftlige krav vedtatt · ${medInnhold} av ${punkter.length} punkter har rutine${forfalte.length > 0 ? ` · ${stk(forfalte.length, 'forfalt', 'forfalte')}` : ''}`}
      />

      {/* To tall, ikke ett. «0 / 5» alene fikk folk til å tro at fem var alt
          firmaet trengte. Det ene tallet svarer på om forskriftens
          skriftlighetskrav er dekket; det andre på hvor langt hele systemet er
          kommet. Setningen under sier hvilket som er hvilket. */}

      <Kort tett>
        <p className="kort-hjelp" style={{ maxWidth: 'none' }}>
          <strong>De fem</strong> er internkontrollforskriften § 5 andre ledd nr. 4–8, som tredje ledd
          krever skriftlig: mål, organisasjon, risikovurdering, avvikshåndtering og systematisk
          gjennomgang. Det er punkt 1–5 i lista.{' '}
          <span className="dempet-mer">
            De øvrige er ikke valgfrie. Punkt 6–8 er nr. 1–3 i samme paragraf og like bindende, de har
            bare ikke kravet om skriftlighet. Punkt 9–13 følger av FEK og FEL, der flere har egne
            dokumentasjonskrav — faglig ansvarlig må vurdere hvilke.
          </span>
        </p>
      </Kort>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="arbeidsflate">
        <div className="delt">
          <div className="liste">
            <div className="liste-verktoy">
              <div className="dempet-mer" style={{ fontSize: 12 }}>
                {laster ? 'Henter …' : stk(punkter.length, 'punkt', 'punkter')}
              </div>
            </div>
            {/* Gruppert, ikke én lang rull. Fjorten punkter uten inndeling er
                fjorten linjer man må lese for å finne den ene man skal til.
                Overskriftene sier også HVORFOR punktet finnes. */}
            <div className="liste-kropp">
              {grupper.map(g => (
                <div key={g.navn}>
                  <div className="liste-gruppe">{g.navn}</div>
                  {g.punkter.map(p => {
                    const forfalt = erForfalt(p.sist_gjennomgatt, p.gjennomgang_intervall_mnd, naa)
                    return (
                      <button
                        key={p.id}
                        className="ordrerad"
                        aria-selected={p.id === valgt}
                        onClick={() => setValgt(p.id)}
                      >
                        <div className="ordrerad-topp">
                          <span className="ordrerad-nr">{p.nummer}</span>
                          <span className="ordrerad-tittel">{p.tittel}</span>
                        </div>
                        <div className="ordrerad-bunn">
                          {p.status === 'vedtatt'
                            ? <CircleCheck size={13} strokeWidth={2} style={{ color: 'var(--gronn)', flex: 'none' }} />
                            : <CircleDashed size={13} strokeWidth={2} style={{ color: 'var(--blekk-3)', flex: 'none' }} />}
                          {/* Antallet rutiner står her og ikke bare «skrevet»:
                              et kapittel med fire rutiner og ett med én er to
                              forskjellige ting for den som skal gjennomgå dem. */}
                          <span className="ordrerad-kunde">
                            {(() => {
                              const n = (rutiner.get(p.id) ?? []).filter(r => r.innhold?.trim()).length
                              if (n === 0) return 'Ingen rutine'
                              const antallTekst = stk(n, 'rutine', 'rutiner')
                              return p.status === 'vedtatt'
                                ? `Vedtatt · ${antallTekst}`
                                : `${antallTekst}, ikke vedtatt`
                            })()}
                          </span>
                          {forfalt ? (
                            <TriangleAlert size={13} strokeWidth={2} style={{ color: 'var(--gul)', flex: 'none' }} />
                          ) : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="detalj">
            {!aktiv ? (
              <div className="tomt-mykt"><p>Velg et punkt</p></div>
            ) : (
              <Punkt
                key={aktiv.id}
                punkt={aktiv}
                rutiner={rutiner.get(aktiv.id) ?? []}
                skjemaer={koblinger.get(aktiv.id) ?? []}
                lesinger={lesinger.get(aktiv.id) ?? []}
                maler={maler}
                ansatte={ansatte}
                kanSkrive={kanSkrive}
                naa={naa}
                etterEndring={last}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Én rutine under et kapittel.
 *
 * Egen komponent og ikke en rad i punktet, fordi hver rutine er sitt eget lille
 * dokument: den har sin egen tekst, sin egen versjon og sitt eget vedtak, og
 * den redigeres uten at de andre rutinene under samme kapittel røres.
 *
 * Redigeringen følger samme regel som kapittelet: LESER eller SKRIVER, aldri
 * begge. Et felt man kan skrive i uten å ha bedt om det, er et felt man endrer
 * noe i ved uhell — og her er «noe» en rutine folk har kvittert for at de har
 * lest.
 */
function Rutine({
  rutine,
  punkt,
  kanSkrive,
  etterEndring,
}: {
  rutine: IkRutine
  punkt: IkPunkt
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { profil } = useAuth()
  const [apen, setApen] = useState(false)
  const [redigerer, setRedigerer] = useState(false)
  const [utkast, setUtkast] = useState<Rutineendring>({
    tittel: rutine.tittel,
    innhold: rutine.innhold,
    ansvarlig: rutine.ansvarlig,
  })
  const [notat, setNotat] = useState('')
  const [jobber, setJobber] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const seAudit = kan(profil?.role, 'logg.les')

  // Stabile referanser: uten dem henter <Historikk> på nytt ved hver render.
  const hentRev = useCallback(() => hentRutinerevisjoner(rutine.id), [rutine.id])
  const hentAud = useCallback(() => hentAuditFor('ik_rutiner', rutine.id), [rutine.id])

  const endret =
    utkast.tittel !== rutine.tittel ||
    (utkast.innhold ?? '') !== (rutine.innhold ?? '')

  function start() {
    setUtkast({ tittel: rutine.tittel, innhold: rutine.innhold, ansvarlig: rutine.ansvarlig })
    setRedigerer(true)
    setApen(true)
  }

  async function kjor(navn: string, arbeid: () => Promise<void>) {
    setJobber(navn)
    setFeil(null)
    try {
      await arbeid()
      await etterEndring()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(null)
    }
  }

  return (
    <div className={redigerer ? 'rutine rutine-redigerer' : 'rutine'}>
      <div className="rutine-hode">
        <button
          type="button"
          className="rutine-navn"
          aria-expanded={apen}
          onClick={() => setApen(a => !a)}
        >
          {rutine.status === 'vedtatt'
            ? <CircleCheck size={14} strokeWidth={2} style={{ color: 'var(--gronn)', flex: 'none' }} />
            : <CircleDashed size={14} strokeWidth={2} style={{ color: 'var(--blekk-3)', flex: 'none' }} />}
          <span>{rutine.tittel}</span>
        </button>
        <Merke stil={rutine.innhold?.trim() ? 'noytral' : 'varsel'}>
          {rutine.innhold?.trim() ? `v${rutine.gjeldende_versjon}` : 'Tom'}
        </Merke>
        {kanSkrive && !redigerer ? (
          <Knapp stil="stille" onClick={start}>
            <Pencil size={14} strokeWidth={1.9} />
            {rutine.innhold?.trim() ? 'Rediger' : 'Skriv'}
          </Knapp>
        ) : null}
      </div>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {!apen ? null : !redigerer ? (
        <>
          {rutine.innhold?.trim() ? (
            <div className="dokument valgbar">{rutine.innhold}</div>
          ) : (
            <div className="dokument-tom"><p>Ingen tekst skrevet ennå.</p></div>
          )}

          {kanSkrive ? (
            <div className="rad" style={{ marginTop: 12 }}>
              {rutine.status !== 'vedtatt' ? (
                <Knapp
                  stil="primar"
                  disabled={!rutine.innhold?.trim() || jobber != null}
                  onClick={() => kjor('vedta', () => vedtaRutine(rutine.id, profil?.id ?? ''))}
                >
                  {jobber === 'vedta' ? 'Vedtar …' : 'Vedta rutinen'}
                </Knapp>
              ) : null}
              {/* Soft delete, regel 5 — og her er den ikke bare en regel: en
                  rutine som gjaldt da noe skjedde skal kunne dokumenteres i
                  ettertid, også etter at firmaet sluttet å bruke den. */}
              <Knapp
                stil="naken"
                disabled={jobber != null}
                onClick={() => kjor('slett', () => slettRutine(rutine.id))}
              >
                <Trash2 size={14} strokeWidth={1.9} />
                {jobber === 'slett' ? 'Tar ut …' : 'Ta ut av bruk'}
              </Knapp>
            </div>
          ) : null}

          <div className="seksjon" style={{ marginTop: 16 }}>
            <div className="seksjon-tittel">Historikk</div>
            <Historikk
              hentRevisjoner={hentRev}
              hentAudit={hentAud}
              seAudit={seAudit}
              tom="Rutinen står slik den ble opprettet."
            />
          </div>
        </>
      ) : (
        <div className="stabel" style={{ gap: 14, marginTop: 12 }}>
          <div className="seksjon-hode">
            <div className="seksjon-tittel">Redigerer rutinen</div>
            <Merke stil="endret">Blir versjon {rutine.gjeldende_versjon + 1}</Merke>
          </div>
          <Felt
            firkant
            etikett="Tittel"
            value={utkast.tittel}
            onChange={e => setUtkast(u => ({ ...u, tittel: e.target.value }))}
          />
          <label className="felt felt-firkant">
            <span className="felt-etikett">Rutinen</span>
            <textarea
              className="felt-inn skrivefelt"
              value={utkast.innhold ?? ''}
              placeholder="Skriv rutinen her …"
              autoFocus
              onChange={e => setUtkast(u => ({ ...u, innhold: e.target.value || null }))}
            />
          </label>
          <Felt
            firkant
            etikett="Hva ble endret, og hvorfor?"
            value={notat}
            placeholder="Presisert at måling skal loggføres"
            hjelp="Påkrevd. Blir stående i historikken."
            onChange={e => setNotat(e.target.value)}
          />
          <div className="rad">
            <Knapp
              stil="merke"
              disabled={!endret || !notat.trim() || jobber != null}
              onClick={() => kjor('lagre', async () => {
                await lagreRutineendring(rutine, punkt, utkast, notat, {
                  id: profil?.id ?? '',
                  navn: profil?.full_name ?? '',
                })
                setNotat('')
                setRedigerer(false)
              })}
            >
              {jobber === 'lagre' ? 'Lagrer …' : `Lagre som versjon ${rutine.gjeldende_versjon + 1}`}
            </Knapp>
            <Knapp stil="naken" disabled={jobber != null} onClick={() => { setNotat(''); setRedigerer(false) }}>
              Avbryt
            </Knapp>
            {!endret ? <span className="felt-hjelp">Ingenting er endret ennå.</span> : null}
            {endret && !notat.trim() ? <span className="felt-hjelp">Skriv hva som ble endret.</span> : null}
          </div>
        </div>
      )}
    </div>
  )
}

function Punkt({
  punkt,
  rutiner,
  skjemaer,
  lesinger,
  maler,
  ansatte,
  kanSkrive,
  naa,
  etterEndring,
}: {
  punkt: IkPunkt
  rutiner: IkRutine[]
  skjemaer: Skjemakobling[]
  lesinger: Lesing[]
  maler: Skjemamal[]
  ansatte: { id: string; full_name: string; role: string }[]
  kanSkrive: boolean
  naa: Date
  etterEndring: () => Promise<void>
}) {
  const { profil } = useAuth()
  const [utkast, setUtkast] = useState<Endring>({
    tittel: punkt.tittel,
    hjemmel: punkt.hjemmel,
    formal: punkt.formal,
    innhold: punkt.innhold,
    gjennomgang_intervall_mnd: punkt.gjennomgang_intervall_mnd,
    ansvarlig: punkt.ansvarlig,
  })
  const [notat, setNotat] = useState('')
  const [redigerer, setRedigerer] = useState(false)
  /** Tittelen på rutinen som er i ferd med å opprettes. `null` = skjemaet er lukket. */
  const [nyRutine, setNyRutine] = useState<string | null>(null)
  const [jobber, setJobber] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const seAudit = kan(profil?.role, 'logg.les')

  function start() {
    setUtkast({
      tittel: punkt.tittel,
      hjemmel: punkt.hjemmel,
      formal: punkt.formal,
      innhold: punkt.innhold,
      gjennomgang_intervall_mnd: punkt.gjennomgang_intervall_mnd,
      ansvarlig: punkt.ansvarlig,
    })
    setRedigerer(true)
  }

  /** Forkaster utkastet. Ingenting er skrevet, saa det er ingenting aa angre. */
  function avbryt() {
    setNotat('')
    setRedigerer(false)
  }

  // Stabile referanser: uten dem henter <Historikk> på nytt ved hver render.
  const hentRev = useCallback(() => hentRevisjoner(punkt.id), [punkt.id])
  const hentAud = useCallback(() => hentAuditFor('ik_punkter', punkt.id), [punkt.id])

  const endret =
    utkast.tittel !== punkt.tittel ||
    (utkast.hjemmel ?? '') !== (punkt.hjemmel ?? '') ||
    (utkast.formal ?? '') !== (punkt.formal ?? '') ||
    utkast.gjennomgang_intervall_mnd !== punkt.gjennomgang_intervall_mnd

  // Montør og lærling leser rutinene i appen, men de er DE som skal kjenne dem.
  // Alle med profil er derfor med i lista; det er ikke en kontorliste.
  const relevante = ansatte
  const harLest = lesinger.filter(l => l.versjon === punkt.gjeldende_versjon)
  const jegHarLest = harLest.find(l => l.user_id === profil?.id)
  const knyttede = new Set(skjemaer.map(s => s.template_id))
  const ledige = maler.filter(m => !knyttede.has(m.id))

  // Et kapittel kan vedtas når minst én rutine under det har tekst. En tom
  // tittel er ikke en rutine.
  const harTekst = rutiner.some(r => r.innhold?.trim())

  const forfalt = erForfalt(punkt.sist_gjennomgatt, punkt.gjennomgang_intervall_mnd, naa)
  const neste = nesteGjennomgang(punkt.sist_gjennomgatt, punkt.gjennomgang_intervall_mnd)

  async function kjor(navn: string, arbeid: () => Promise<void>) {
    setJobber(navn)
    setFeil(null)
    try {
      await arbeid()
      await etterEndring()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(null)
    }
  }

  return (
    <>
      <div className="hero">
        <div className="hero-topp">
          <span className="hero-nr">Punkt {punkt.nummer}</span>
          {punkt.status === 'vedtatt'
            ? <Merke stil="ny">Vedtatt {dato(punkt.vedtatt_at)}</Merke>
            : <Merke stil="noytral">Utkast</Merke>}
          {punkt.maaVaereSkriftlig ? <Merke stil="endret">Lovpålagt skriftlig</Merke> : null}
          {forfalt ? <Merke stil="varsel">Til gjennomgang</Merke> : null}
        </div>
        <h1 className="hero-tittel valgbar">{punkt.tittel}</h1>
        <div className="hero-linje">
          <span className="valgbar">{punkt.hjemmel || 'Ingen hjemmel oppgitt'}</span>
          <span>Versjon {punkt.gjeldende_versjon}</span>
          <span>
            {punkt.sist_gjennomgatt
              ? `Gjennomgått ${dato(punkt.sist_gjennomgatt)}, neste ${dato(neste)}`
              : 'Aldri gjennomgått'}
          </span>
        </div>
      </div>

      <div className="detalj-kropp">
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

        <div className="to-spalter">
          <div className="stabel">
            {/* LESER eller SKRIVER — aldri tvil om hvilken av delene.
                I lesemodus er rutinen tekst på en flate, ikke et skrivefelt som
                ser tomt ut fordi ingen har skrevet noe. I skrivemodus er hele
                kortet merket med kobber og sier hvilken versjon utkastet blir.
                Et felt man kan skrive i uten å ha bedt om det, er et felt man
                endrer noe i ved uhell. */}
            {!redigerer ? (
              <>
                <div className="seksjon">
                  <div className="seksjon-hode">
                    <div className="seksjon-tittel">Formål</div>
                    <Merke stil="noytral">Kapittel · v{punkt.gjeldende_versjon}</Merke>
                    {kanSkrive ? (
                      <Knapp stil="stille" onClick={start}>
                        <Pencil size={15} strokeWidth={1.9} />
                        Rediger kapittelet
                      </Knapp>
                    ) : null}
                  </div>
                  <p className="kort-hjelp valgbar">{punkt.formal || 'Ikke beskrevet.'}</p>
                </div>

                {/* Rutinene. Punktet er kapittelet — forskriftens § 5 er
                    skrevet generelt — og under det kan det ligge så mange
                    rutiner som arbeidet krever. «Kartlegging av farer» er
                    rutinen for tavle, for høyden, for AUS og for graving, og
                    presset ned i ett tekstfelt blir de fire til et veggteppe
                    ingen leser. */}
                <div className="seksjon">
                  <div className="seksjon-hode">
                    <div className="seksjon-tittel">Rutiner</div>
                    <Merke stil="noytral">{stk(rutiner.length, 'rutine', 'rutiner')}</Merke>
                    {kanSkrive ? (
                      <Knapp stil="stille" onClick={() => setNyRutine('')}>
                        <Plus size={15} strokeWidth={1.9} />
                        Ny rutine
                      </Knapp>
                    ) : null}
                  </div>

                  {nyRutine !== null ? (
                    <div className="seksjon seksjon-redigerer" style={{ marginBottom: 14 }}>
                      <Felt
                        firkant
                        autoFocus
                        etikett="Hva heter rutinen?"
                        value={nyRutine}
                        placeholder="Arbeid i tavle"
                        hjelp="Bare tittelen nå. Selve teksten skrives i neste steg, med endringsnotat."
                        onChange={e => setNyRutine(e.target.value)}
                      />
                      <div className="rad" style={{ marginTop: 12 }}>
                        <Knapp
                          stil="merke"
                          disabled={!nyRutine.trim() || jobber != null}
                          onClick={() => kjor('ny-rutine', async () => {
                            await opprettRutine(punkt.id, nyRutine, profil?.id ?? '')
                            setNyRutine(null)
                          })}
                        >
                          {jobber === 'ny-rutine' ? 'Oppretter …' : 'Opprett rutinen'}
                        </Knapp>
                        <Knapp stil="naken" disabled={jobber != null} onClick={() => setNyRutine(null)}>
                          Avbryt
                        </Knapp>
                      </div>
                    </div>
                  ) : null}

                  {rutiner.length === 0 ? (
                    <div className="dokument-tom">
                      <p>Ingen rutiner skrevet ennå.</p>
                      {HINT_FOR[punkt.nummer] ? (
                        <p className="felt-hjelp" style={{ maxWidth: '58ch' }}>{HINT_FOR[punkt.nummer]}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="stabel" style={{ gap: 14 }}>
                      {rutiner.map(r => (
                        <Rutine
                          key={r.id}
                          rutine={r}
                          punkt={punkt}
                          kanSkrive={kanSkrive}
                          etterEndring={etterEndring}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="seksjon seksjon-redigerer">
                <div className="seksjon-hode">
                  <div className="seksjon-tittel">Redigerer kapittel {punkt.nummer}</div>
                  <Merke stil="endret">Blir versjon {punkt.gjeldende_versjon + 1}</Merke>
                </div>

                <div className="stabel" style={{ gap: 16 }}>
                  <Felt
                    firkant
                    etikett="Tittel"
                    value={utkast.tittel}
                    onChange={e => setUtkast(u => ({ ...u, tittel: e.target.value }))}
                  />
                  <Felt
                    firkant
                    etikett="Hjemmel"
                    value={utkast.hjemmel ?? ''}
                    placeholder="Slå opp paragrafen i gjeldende forskrift"
                    hjelp="Fritekst. Forskrifter endres, og en låst kodeliste blir feil ved neste revisjon."
                    onChange={e => setUtkast(u => ({ ...u, hjemmel: e.target.value || null }))}
                  />
                  <label className="felt felt-firkant">
                    <span className="felt-etikett">Formål</span>
                    <textarea
                      className="felt-inn skrivefelt skrivefelt-lav"
                      value={utkast.formal ?? ''}
                      onChange={e => setUtkast(u => ({ ...u, formal: e.target.value || null }))}
                    />
                    <span className="felt-hjelp">Hva punktet skal sikre. Endres sjelden.</span>
                  </label>
                  <Felt
                    firkant
                    etikett="Hva ble endret, og hvorfor?"
                    value={notat}
                    placeholder="Presisert at måling skal loggføres"
                    hjelp="Påkrevd. Blir stående i historikken."
                    onChange={e => setNotat(e.target.value)}
                  />
                  <div className="rad">
                    <Knapp
                      stil="merke"
                      disabled={!endret || !notat.trim() || jobber != null}
                      onClick={() => kjor('lagre', async () => {
                        await lagreEndring(punkt, utkast, notat, {
                          id: profil?.id ?? '',
                          navn: profil?.full_name ?? '',
                        })
                        setNotat('')
                        setRedigerer(false)
                      })}
                    >
                      {jobber === 'lagre' ? 'Lagrer …' : `Lagre som versjon ${punkt.gjeldende_versjon + 1}`}
                    </Knapp>
                    <Knapp stil="naken" onClick={avbryt} disabled={jobber != null}>
                      Avbryt
                    </Knapp>
                    {!endret ? <span className="felt-hjelp">Ingenting er endret ennå.</span> : null}
                    {endret && !notat.trim() ? <span className="felt-hjelp">Skriv hva som ble endret.</span> : null}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="stabel">
            <div className="seksjon">
              <div className="seksjon-tittel">Gjennomgang</div>
              <div className="stabel" style={{ gap: 14 }}>
                <div>
                  <div className="fakta-navn">Sist gjennomgått</div>
                  <div className="fakta-verdi">{punkt.sist_gjennomgatt ? dato(punkt.sist_gjennomgatt) : 'Aldri'}</div>
                </div>
                <div>
                  <div className="fakta-navn">Neste frist</div>
                  <div className="fakta-verdi" style={forfalt ? { color: 'var(--gul)' } : undefined}>
                    {neste ? dato(neste) : 'Ingen frist ennå'}
                  </div>
                </div>
                <div>
                  <div className="fakta-navn">Intervall</div>
                  <div className="fakta-verdi">{punkt.gjennomgang_intervall_mnd} måneder</div>
                </div>
              </div>

              {kanSkrive ? (
                <div className="stabel" style={{ marginTop: 18, gap: 10 }}>
                  {punkt.status !== 'vedtatt' ? (
                    <Knapp
                      stil="primar"
                      disabled={!harTekst || redigerer || jobber != null}
                      onClick={() => kjor('vedta', () => vedta(punkt.id, profil?.id ?? ''))}
                    >
                      {jobber === 'vedta' ? 'Vedtar …' : 'Vedta punktet'}
                    </Knapp>
                  ) : (
                    <Knapp
                      stil="stille"
                      disabled={jobber != null}
                      onClick={() => kjor('kvitter', () => kvitterGjennomgang(punkt.id))}
                    >
                      {jobber === 'kvitter' ? 'Registrerer …' : 'Gjennomgått i dag'}
                    </Knapp>
                  )}
                  {punkt.status !== 'vedtatt' && !harTekst ? (
                    <span className="felt-hjelp">Skriv minst én rutine først.</span>
                  ) : null}
                  {punkt.status !== 'vedtatt' && redigerer ? (
                    <span className="felt-hjelp">Lagre eller avbryt redigeringen først.</span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="seksjon">
              <div className="seksjon-tittel">Skjemaer</div>
              {skjemaer.length === 0 ? (
                <p className="dempet-mer">Ingen skjemaer knyttet til punktet.</p>
              ) : (
                <div className="stabel" style={{ gap: 10 }}>
                  {skjemaer.map(s => (
                    <div key={s.id} className="rad">
                      <FileText size={15} strokeWidth={1.8} className="dempet" />
                      <span className="strekk">{s.tittel}</span>
                      <span className="teller">v{s.versjon}</span>
                      {kanSkrive ? (
                        <button
                          className="knapp knapp-naken"
                          title="Fjern koblingen"
                          onClick={() => kjor('loesna', () => loesnaSkjema(s.id))}
                        >
                          <Unlink size={14} strokeWidth={1.9} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {/* Knyttes herfra, ikke bare fra Skjemaer-flaten. En rutine om
                  sluttkontroll som ikke peker på sluttkontrollskjemaet er en
                  rutine uten verktøy, og det oppdager man mens man skriver
                  rutinen — ikke når man senere er innom en annen flate. */}
              {kanSkrive && ledige.length > 0 ? (
                <select
                  className="velger"
                  style={{ width: '100%', marginTop: 12 }}
                  value=""
                  onChange={e => {
                    const id = e.target.value
                    if (id) void kjor('knytt', () => knyttSkjema(punkt.id, id))
                  }}
                >
                  <option value="">Knytt et skjema …</option>
                  {ledige.map(m => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
              ) : null}
              {kanSkrive && ledige.length === 0 && maler.length > 0 ? (
                <p className="felt-hjelp" style={{ marginTop: 12 }}>
                  Alle firmaets maler er allerede knyttet til dette punktet.
                </p>
              ) : null}
            </div>

            {/* Lesebekreftelse. § 5 andre ledd nr. 2 krever at folk kjenner
                rutinene «herunder informasjon om endringer» — og det er
                endringsdelen som er vanskelig å dokumentere. */}
            <div className="seksjon">
              <div className="seksjon-hode">
                <div className="seksjon-tittel">Lest av</div>
                <span className="dempet-mer" style={{ fontSize: 12 }}>
                  {antall(harLest.length)} av {antall(relevante.length)}
                </span>
              </div>

              {punkt.status !== 'vedtatt' ? (
                <p className="dempet-mer">Punktet er ikke vedtatt ennå.</p>
              ) : (
                <>
                  <div className="stabel" style={{ gap: 8 }}>
                    {relevante.map(a => {
                      const lest = lesinger.find((l: Lesing) => l.user_id === a.id && l.versjon === punkt.gjeldende_versjon)
                      const eldre = !lest && lesinger.some(l => l.user_id === a.id)
                      return (
                        <div key={a.id} className="rad">
                          {lest
                            ? <CircleCheck size={15} strokeWidth={2} style={{ color: 'var(--gronn)', flex: 'none' }} />
                            : <CircleDashed size={15} strokeWidth={2} style={{ color: 'var(--blekk-4)', flex: 'none' }} />}
                          <span className="strekk">{a.full_name}</span>
                          {lest ? (
                            <span className="dempet-mer" style={{ fontSize: 12 }}>{dato(lest.lest_at)}</span>
                          ) : eldre ? (
                            <span style={{ color: 'var(--gul)', fontSize: 12 }}>eldre versjon</span>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>

                  {jegHarLest ? (
                    <p className="felt-hjelp" style={{ marginTop: 14 }}>
                      Du bekreftet versjon {punkt.gjeldende_versjon} den {dato(jegHarLest.lest_at)}.
                    </p>
                  ) : (
                    <div style={{ marginTop: 14 }}>
                      <Knapp
                        stil="stille"
                        disabled={jobber != null}
                        onClick={() => kjor('lest', () =>
                          bekreftLest(punkt.id, punkt.gjeldende_versjon, profil?.full_name ?? ''))}
                      >
                        <CircleCheck size={15} strokeWidth={1.9} />
                        {jobber === 'lest' ? 'Bekrefter …' : 'Jeg har lest denne'}
                      </Knapp>
                      <p className="felt-hjelp" style={{ marginTop: 8 }}>
                        Gjelder versjon {punkt.gjeldende_versjon}. Endres rutinen, spør den om ny
                        bekreftelse.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Historikken står ÅPEN, ikke bak et trykk. Poenget med at et
                IK-system er levende er at man ser at det lever. */}
            <div className="seksjon">
              <div className="seksjon-tittel">Historikk</div>
              <Historikk
                hentRevisjoner={hentRev}
                hentAudit={hentAud}
                seAudit={seAudit}
                tom="Punktet står slik det ble opprettet."
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
