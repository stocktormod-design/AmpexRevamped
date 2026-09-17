import { erForfalt, fullstendighet, IK_GRUPPENAVN, IK_SKJELETT, nesteGjennomgang } from '@delt/ik/skjelett'
import { kan } from '@delt/kontor-tilgang'
import { ChevronDown, ChevronRight, CircleCheck, CircleDashed, FileText, Pencil, Plus, TriangleAlert, Trash2, Unlink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import {
  endre as endreIk2, hentPunkterMedRutiner, nyRutine as opprettIk2Rutine,
  nyttPunkt as opprettIk2Punkt, slett as slettIk2, taggene,
  type Ik2Punkt, type Ik2Rutine,
} from '@/lib/ik2-lager'
import {
  bekreftLest,
  hentAuditFor,
  hentLesinger,
  hentPunkter,
  hentRevisjoner,
  hentSkjemakoblinger,
  hentSkjemamaler,
  knyttSkjema,
  kvitterGjennomgang,
  lagreEndring,
  loesnaSkjema,
  opprettSkjelett,
  vedta,
  type Endring,
  type IkPunkt,
  type Lesing,
  type Skjemakobling,
  type Skjemamal,
} from '@/lib/ik-lager'
import { hentFirma } from '@/lib/kontor-lager'
import { Delt, paaTelefon } from '@/ui/Delt'
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

export function InternkontrollV2() {
  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'ik.skriv')

  const [punkter, setPunkter] = useState<IkPunkt[]>([])
  /** Punktene v2 legger til, per kapittel. Rutinene henger under dem. */
  const [punkter2, setPunkter2] = useState<Map<string, Ik2Punkt[]>>(new Map())
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
        hentPunkterMedRutiner(),
        hentSkjemakoblinger(),
        hentLesinger(),
        hentSkjemamaler(),
        hentFirma(),
      ])
      setPunkter(p)
      setPunkter2(r)
      setKoblinger(k)
      setLesinger(l)
      setMaler(m)
      setAnsatte(a.ansatte)
      setFeil(null)
      // Se `paaTelefon()`: autovalg hører til spaltevisningen. På telefon er
      // detaljen hele flata, og skal ikke åpne seg av seg selv.
      setValgt(v => (v && p.some((x: IkPunkt) => x.id === v) ? v : (paaTelefon() ? null : (p[0]?.id ?? null))))
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
    (id: string) => (punkter2.get(id) ?? []).some(p => p.rutiner.some(r => r.innhold?.trim())),
    [punkter2],
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
        <Sidehode tittel="Internkontroll v2" under="Firmaets IK-system" />
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
        tittel="Internkontroll v2"
        under={`${status.pa_plass} av ${status.kreves} skriftlige krav vedtatt · ${medInnhold} av ${punkter.length} punkter har rutine${forfalte.length > 0 ? ` · ${stk(forfalte.length, 'forfalt', 'forfalte')}` : ''}`}
      />

      {/* Forklaringen av «de fem» sto som et eget kort over lista og ble lest
          hver gang for å ignoreres. Den står nå som én linje i listehodet;
          hele begrunnelsen ligger i tom-tilstanden over, der den leses én gang. */}

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="arbeidsflate">
        <Delt valgt={!!aktiv} tilbake={() => setValgt(null)}>
          <div className="liste">
            <div className="liste-verktoy">
              <div className="dempet-mer" style={{ fontSize: 12 }}>
                {laster ? 'Henter …' : `${stk(punkter.length, 'punkt', 'punkter')} · 1–5 skal være skriftlige (§ 5)`}
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
                          {/* Antallet punkter står her: et kapittel med fire
                              punkter og ett med ett er to forskjellige ting for
                              den som skal gjennomgå dem. */}
                          <span className="ordrerad-kunde">
                            {(() => {
                              const egne = punkter2.get(p.id) ?? []
                              if (egne.length === 0) return 'Ingen punkter'
                              const n = egne.reduce((sum, x) => sum + x.rutiner.length, 0)
                              return `${stk(egne.length, 'punkt', 'punkter')} · ${stk(n, 'rutine', 'rutiner')}`
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
                punkter={punkter2.get(aktiv.id) ?? []}
                tagger={taggene(punkter2)}
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
        </Delt>
      </div>
    </>
  )
}

/**
 * Et punkt under et kapittel — og rutinene som hører til det.
 *
 * Dette er hele forskjellen mellom v1 og v2. I v1 lå rutinene rett under
 * kapittelet, og «Kartlegging av farer» ble ett tekstfelt for fire helt
 * forskjellige jobber. Her er punktet mellomnivået: tavle, høyden, AUS og
 * graving hver for seg, med sine egne rutiner under.
 *
 * Rutinen har én tagg. Den er fritekst med forslag fra dem som alt er i bruk,
 * fordi firmaet kjenner sitt eget arbeid — og den er det som gjør at «HMS»
 * kan finnes igjen på tvers av kapitler.
 */
function Underpunkt({
  punkt,
  tagger,
  kanSkrive,
  etterEndring,
}: {
  punkt: Ik2Punkt
  tagger: string[]
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const [nyRutine, setNyRutine] = useState<{ tittel: string; tag: string } | null>(null)
  const [jobber, setJobber] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)

  async function kjor(arbeid: () => Promise<void>) {
    setJobber(true)
    setFeil(null)
    try {
      await arbeid()
      await etterEndring()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(false)
    }
  }

  return (
    <div className="seksjon">
      <div className="seksjon-hode">
        <div className="seksjon-tittel">{punkt.tittel}</div>
        <span className="blokk-tall">{stk(punkt.rutiner.length, 'rutine', 'rutiner')}</span>
        {kanSkrive ? (
          <>
            <Knapp stil="stille" disabled={jobber} onClick={() => setNyRutine({ tittel: '', tag: '' })}>
              <Plus size={15} strokeWidth={1.9} />
              Ny rutine
            </Knapp>
            <Knapp
              stil="naken"
              disabled={jobber}
              onClick={() => void kjor(() => slettIk2('punkt', punkt.id))}
            >
              <Trash2 size={14} strokeWidth={1.9} />
            </Knapp>
          </>
        ) : null}
      </div>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {nyRutine ? (
        <div className="seksjon seksjon-redigerer" style={{ marginBottom: 12 }}>
          <Felt
            firkant
            autoFocus
            etikett="Hva heter rutinen?"
            value={nyRutine.tittel}
            placeholder="Kontroll før spenningssetting"
            onChange={e => setNyRutine(v => (v ? { ...v, tittel: e.target.value } : v))}
          />
          <div style={{ maxWidth: 220, marginTop: 10 }}>
            <Felt
              firkant
              etikett="Tagg"
              list="ik2-tagger"
              value={nyRutine.tag}
              placeholder="HMS, AUS, tavle …"
              hjelp="Gjør rutinen søkbar på tvers av kapitlene."
              onChange={e => setNyRutine(v => (v ? { ...v, tag: e.target.value } : v))}
            />
          </div>
          <div className="rad" style={{ marginTop: 12 }}>
            <Knapp
              stil="merke"
              disabled={!nyRutine.tittel.trim() || jobber}
              onClick={() => void kjor(async () => {
                await opprettIk2Rutine(punkt.id, nyRutine.tittel, nyRutine.tag || null)
                setNyRutine(null)
              })}
            >
              {jobber ? 'Oppretter …' : 'Opprett rutinen'}
            </Knapp>
            <Knapp stil="naken" disabled={jobber} onClick={() => setNyRutine(null)}>Avbryt</Knapp>
          </div>
        </div>
      ) : null}

      {punkt.rutiner.length === 0 ? (
        <p className="kort-hjelp">Ingen rutiner ennå. Rutinene hører hjemme her, ikke på kapittelet.</p>
      ) : (
        <div className="stabel" style={{ gap: 10 }}>
          {punkt.rutiner.map(r => (
            <Ik2RutineRad
              key={r.id}
              rutine={r}
              tagger={tagger}
              kanSkrive={kanSkrive}
              etterEndring={etterEndring}
            />
          ))}
        </div>
      )}

      <datalist id="ik2-tagger">
        {tagger.map(t => <option key={t} value={t} />)}
      </datalist>
    </div>
  )
}

/** Én rutine: tittel, tagg og teksten. Lagres når feltet forlates. */
function Ik2RutineRad({
  rutine,
  tagger,
  kanSkrive,
  etterEndring,
}: {
  rutine: Ik2Rutine
  tagger: string[]
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const [apen, setApen] = useState(!rutine.innhold)
  const [innhold, setInnhold] = useState(rutine.innhold ?? '')
  useEffect(() => { setInnhold(rutine.innhold ?? '') }, [rutine.innhold])

  async function lagre(patch: Record<string, string | null>) {
    await endreIk2('ik2_rutiner', rutine.id, patch)
    await etterEndring()
  }

  return (
    <div className="ik2-rutine">
      <div className="ik2-rad">
        <button className="ik2-pil" onClick={() => setApen(v => !v)} title={apen ? 'Lukk' : 'Åpne'}>
          {apen ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
        </button>
        <span style={{ flex: 1, fontWeight: 500 }}>{rutine.tittel}</span>
        {rutine.tag ? <span className="ik2-tag">{rutine.tag}</span> : null}
        {kanSkrive ? (
          <button className="ikonknapp" title="Slett rutinen"
            onClick={() => void slettIk2('rutine', rutine.id).then(etterEndring)}>
            <Trash2 size={13} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {apen ? (
        <div className="ik2-innhold">
          {kanSkrive ? (
            <textarea
              className="felt-inn skrivefelt skrivefelt-lav"
              rows={6}
              value={innhold}
              placeholder="Hvordan arbeidet gjøres. Hvem gjør hva, i hvilken rekkefølge, og hvordan vet man at det er gjort?"
              onChange={e => setInnhold(e.target.value)}
              onBlur={() => {
                if (innhold !== (rutine.innhold ?? '')) void lagre({ innhold: innhold.trim() || null })
              }}
            />
          ) : (
            <p className="kort-hjelp valgbar">{rutine.innhold || 'Ikke skrevet ennå.'}</p>
          )}

          {kanSkrive ? (
            <div style={{ maxWidth: 220, marginTop: 8 }}>
              <Felt
                firkant
                etikett="Tagg"
                list="ik2-tagger"
                defaultValue={rutine.tag ?? ''}
                placeholder="HMS, AUS, tavle …"
                onBlur={e => {
                  const v = e.target.value.trim() || null
                  if (v !== rutine.tag) void lagre({ tag: v })
                }}
              />
              <datalist id="ik2-tagger">
                {tagger.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Punkt({
  punkt,
  punkter,
  tagger,
  skjemaer,
  lesinger,
  maler,
  ansatte,
  kanSkrive,
  naa,
  etterEndring,
}: {
  punkt: IkPunkt
  punkter: Ik2Punkt[]
  tagger: string[]
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
  /** Tittelen på punktet som er i ferd med å opprettes. `null` = skjemaet er lukket. */
  const [nyttPunkt, setNyttPunkt] = useState<string | null>(null)
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
  const harTekst = punkter.some(p => p.rutiner.some(r => r.innhold?.trim()))

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
        </div>
      </div>

      <div className="detalj-kropp">
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

        <div className="to-spalter">
          <div className="blokker">
            {/* LESER eller SKRIVER — aldri tvil om hvilken av delene.
                I lesemodus er rutinen tekst på en flate, ikke et skrivefelt som
                ser tomt ut fordi ingen har skrevet noe. I skrivemodus er hele
                kortet merket med kobber og sier hvilken versjon utkastet blir.
                Et felt man kan skrive i uten å ha bedt om det, er et felt man
                endrer noe i ved uhell. */}
            {!redigerer ? (
              <>
                <div className="blokk">
                  <div className="blokk-hode">
                    <div className="blokk-tittel">Formål</div>
                    {/* Tomt punkt sier OPPRETT, ikke «rediger». Ampex skriver
                        ikke formålet for firmaet — se lib/ik/skjelett.ts — og
                        da skal knappen be om det som mangler, ikke tilby å
                        endre noe som ikke finnes. */}
                    {kanSkrive ? (
                      <Knapp stil={punkt.formal ? 'stille' : 'merke'} onClick={start}>
                        {punkt.formal
                          ? <><Pencil size={15} strokeWidth={1.9} />Rediger kapittelet</>
                          : <><Plus size={15} strokeWidth={1.9} />Opprett formål</>}
                      </Knapp>
                    ) : null}
                  </div>
                  <p className="kort-hjelp valgbar">
                    {punkt.formal || (kanSkrive
                      ? 'Ikke skrevet ennå. Skriv hva dette punktet skal sikre hos dere.'
                      : 'Ikke skrevet ennå.')}
                  </p>
                </div>

                {/* Punktene. Kapittelet er forskriftens — § 5 er skrevet
                    generelt — og under det legger firmaet sine egne punkter.
                    «Kartlegging av farer» er ikke én ting: det er tavle,
                    høyden, AUS og graving, og hver av dem har sine rutiner.
                    Rutinen henger derfor ALLTID på et punkt, aldri rett på
                    kapittelet. Det er hele forskjellen fra v1. */}
                <div className="blokk">
                  <div className="blokk-hode">
                    <div className="blokk-tittel">Punkter</div>
                    <span className="blokk-tall">{stk(punkter.length, 'punkt', 'punkter')}</span>
                    {kanSkrive ? (
                      <Knapp stil="stille" onClick={() => setNyttPunkt('')}>
                        <Plus size={15} strokeWidth={1.9} />
                        Lag punkt
                      </Knapp>
                    ) : null}
                  </div>

                  {nyttPunkt !== null ? (
                    <div className="seksjon seksjon-redigerer" style={{ marginBottom: 14 }}>
                      <Felt
                        firkant
                        autoFocus
                        etikett="Hva heter punktet?"
                        value={nyttPunkt}
                        placeholder="Arbeid i tavle"
                        hjelp="Rutinene legges under punktet etterpå."
                        onChange={e => setNyttPunkt(e.target.value)}
                      />
                      <div className="rad" style={{ marginTop: 12 }}>
                        <Knapp
                          stil="merke"
                          disabled={!nyttPunkt.trim() || jobber != null}
                          onClick={() => kjor('nytt-punkt', async () => {
                            await opprettIk2Punkt(punkt.id, nyttPunkt)
                            setNyttPunkt(null)
                          })}
                        >
                          {jobber === 'nytt-punkt' ? 'Oppretter …' : 'Opprett punktet'}
                        </Knapp>
                        <Knapp stil="naken" disabled={jobber != null} onClick={() => setNyttPunkt(null)}>
                          Avbryt
                        </Knapp>
                      </div>
                    </div>
                  ) : null}

                  {punkter.length === 0 ? (
                    <div className="dokument-tom">
                      <p>Ingen punkter ennå.</p>
                      {HINT_FOR[punkt.nummer] ? (
                        <p className="felt-hjelp" style={{ maxWidth: '58ch' }}>{HINT_FOR[punkt.nummer]}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="stabel" style={{ gap: 14 }}>
                      {punkter.map(u => (
                        <Underpunkt
                          key={u.id}
                          punkt={u}
                          tagger={tagger}
                          kanSkrive={kanSkrive}
                          etterEndring={etterEndring}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="seksjon seksjon-redigerer" style={{ marginTop: 4 }}>
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

          <div className="blokker">
            <div className="blokk">
              <div className="blokk-hode"><div className="blokk-tittel">Gjennomgang</div></div>
              <div className="fakta">
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

            <div className="blokk">
              <div className="blokk-hode"><div className="blokk-tittel">Skjemaer</div></div>
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
            <div className="blokk">
              <div className="blokk-hode">
                <div className="blokk-tittel">Lest av</div>
                <span className="blokk-tall">{antall(harLest.length)} av {antall(relevante.length)}</span>
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
            <div className="blokk">
              <div className="blokk-hode"><div className="blokk-tittel">Historikk</div></div>
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
