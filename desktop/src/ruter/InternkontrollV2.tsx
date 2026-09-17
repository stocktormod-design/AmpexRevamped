import { erForfalt, fullstendighet, IK_GRUPPENAVN, IK_SKJELETT, nesteGjennomgang } from '@delt/ik/skjelett'
import { kan } from '@delt/kontor-tilgang'
import { ChevronLeft, ChevronRight, CircleCheck, FileText, Pencil, Plus, Trash2, TriangleAlert, Unlink } from 'lucide-react'
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
import { Historikk } from '@/ui/Historikk'
import { antall, Beskjed, Felt, Knapp, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Internkontroll v2 — PRØVEFLATE ved siden av den som virker.
 *
 * Tre nivåer, og de heter det samme overalt:
 *
 *   Kapittel   de fjorten fra forskriften (`ik_punkter`, delt med v1)
 *     └ Punkt  firmaets egen inndeling: «Arbeid i tavle», «Arbeid i høyden»
 *         └ Rutine  teksten, med én tagg: «HMS», «AUS», «tavle»
 *
 * **Ett nivå om gangen.** Som Innstillinger på telefonen: lista over
 * kapitler, så ett kapittel med punktene sine, så ett punkt med rutinene
 * sine, så én rutine med teksten. Hver skjerm er én liste eller én tekst.
 * De to forrige forsøkene viste mer på én gang — liste pluss detalj, så hele
 * treet pluss et dokument — og begge var «for mye å se på». Oversikt er ikke
 * å se alt; det er å aldri lure på hvor man er og hva man kan gjøre her.
 *
 * Stien ligger i hash-en (`#/ik2/<kapittel>/<punkt>/<rutine>`), så
 * tilbake-knappen i nettleseren og på telefonen virker, og en lenke til en
 * rutine kan sendes. `App.tsx` ruter på det første leddet.
 *
 * Søket øverst på kapittellista går på tvers av alt og svarer med en flat
 * treffliste der hver rad sier hvor rutinen står.
 *
 * Rammeverket, vedtakene, gjennomgangen, skjemaene, lesebekreftelsene og
 * historikken er de samme som i v1 og leses fra de samme radene. v2 eier
 * bare nivået under (`ik2_`-tabellene) og kan slettes uten at
 * internkontrollen i drift merker det — se `src/lib/ik2-lager.ts`.
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

type Ansatt = { id: string; full_name: string; role: string }

/** Stien i hash-en: `#/ik2/<kapittel>/<punkt>/<rutine>`. */
function lesSti(): string[] {
  return window.location.hash.replace(/^#\//, '').split('/').filter(Boolean).slice(1)
}

function gaa(...sti: (string | null | undefined)[]) {
  window.location.hash = ['#/ik2', ...sti.filter(Boolean)].join('/')
}

function useSti(): string[] {
  const [sti, setSti] = useState(lesSti)
  useEffect(() => {
    const paa = () => setSti(lesSti())
    window.addEventListener('hashchange', paa)
    return () => window.removeEventListener('hashchange', paa)
  }, [])
  return sti
}

export function InternkontrollV2() {
  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'ik.skriv')
  const sti = useSti()

  const [kapitler, setKapitler] = useState<IkPunkt[]>([])
  const [punkter, setPunkter] = useState<Map<string, Ik2Punkt[]>>(new Map())
  const [koblinger, setKoblinger] = useState<Map<string, Skjemakobling[]>>(new Map())
  const [lesinger, setLesinger] = useState<Map<string, Lesing[]>>(new Map())
  const [maler, setMaler] = useState<Skjemamal[]>([])
  const [ansatte, setAnsatte] = useState<Ansatt[]>([])
  /** Rutinen som nettopp ble opprettet: åpner i skrivemodus, én gang. */
  const [nyligOpprettet, setNyligOpprettet] = useState<string | null>(null)
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
      setKapitler(p)
      setPunkter(r)
      setKoblinger(k)
      setLesinger(l)
      setMaler(m)
      setAnsatte(a.ansatte)
      setFeil(null)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setLaster(false)
    }
  }, [])

  useEffect(() => { void last() }, [last])

  const naa = useMemo(() => new Date(), [])
  const tagnavn = useMemo(() => taggene(punkter), [punkter])

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

  if (!laster && kapitler.length === 0) {
    return (
      <>
        <Sidehode tittel="Internkontroll v2" under="Firmaets IK-system" />
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
        <Kort tittel="Ingen internkontroll opprettet ennå">
          <p className="kort-hjelp">
            Ampex kan sette opp et skjelett med {antall(IK_SKJELETT.length)} kapitler: de fem
            internkontrollforskriften krever skriftlig, de tre som er bindende uten krav om
            skriftlighet, fem elektrofaglige om kvalifikasjoner, sluttkontroll, samsvarserklæring,
            overlevering og instrumenter, og ett om oppbevaring.
          </p>
          <p className="kort-hjelp" style={{ marginTop: 14 }}>
            Kapitlene kommer med hjemmel, men <strong>uten innhold</strong>. Punktene og rutinene
            må firmaet skrive selv — et IK-system skrevet av leverandøren er nettopp den døde
            permen forskriften skal hindre. Hjemmelshenvisningene er et utgangspunkt, og faglig
            ansvarlig må kontrollere dem mot gjeldende forskrift.
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

  // Stien kan peke på noe som er slettet eller aldri fantes. Da faller vi
  // til det nærmeste som finnes over — aldri til en tom side.
  const kapittel = kapitler.find(k => k.id === sti[0]) ?? null
  const punkt = kapittel ? (punkter.get(kapittel.id) ?? []).find(p => p.id === sti[1]) ?? null : null
  const rutine = punkt ? punkt.rutiner.find(r => r.id === sti[2]) ?? null : null

  const felles = { kanSkrive, etterEndring: last }

  return (
    <>
      <Sidehode tittel="Internkontroll v2" under="Firmaets IK-system" />
      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
      {/* Én forslagsliste for alle tagg-feltene på flata. */}
      <datalist id="ik2-tagger">
        {tagnavn.map(t => <option key={t} value={t} />)}
      </datalist>

      <div className="arbeidsflate">
        <div className="ik2-side">
          <div className={kapittel && !punkt ? 'ik2-innhold ik2-innhold-bred' : 'ik2-innhold'}>
            {laster && kapitler.length === 0 ? (
              <div className="tomt-mykt"><p>Henter …</p></div>
            ) : rutine && punkt && kapittel ? (
              <RutineSide
                key={rutine.id}
                kapittel={kapittel}
                punkt={punkt}
                rutine={rutine}
                startISkrivemodus={nyligOpprettet === rutine.id}
                {...felles}
              />
            ) : punkt && kapittel ? (
              <PunktSide
                key={punkt.id}
                kapittel={kapittel}
                punkt={punkt}
                opprettet={id => setNyligOpprettet(id)}
                {...felles}
              />
            ) : kapittel ? (
              <KapittelSide
                key={kapittel.id}
                kapittel={kapittel}
                punkter={punkter.get(kapittel.id) ?? []}
                skjemaer={koblinger.get(kapittel.id) ?? []}
                lesinger={lesinger.get(kapittel.id) ?? []}
                maler={maler}
                ansatte={ansatte}
                naa={naa}
                {...felles}
              />
            ) : (
              <KapitlerSide kapitler={kapitler} punkter={punkter} naa={naa} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Byggeklosser ─────────────────────────────────────────────────────── */

/**
 * Stien over sida: hele kjeden fra «Kapitler» og ned til der du er. Det du
 * står på er sort og ikke trykkbart; alt over er grått og går dit. Pila
 * lengst til venstre er ett hakk opp. Uten dette svarer ikke sida på «hvor
 * er jeg» — og det var det første Tormod spurte om.
 */
function Sti({ ledd }: { ledd: { navn: string; til?: string[] }[] }) {
  const over = ledd.slice(0, -1)
  const her = ledd[ledd.length - 1]
  const forrige = over[over.length - 1]
  return (
    <nav className="ik2-sti">
      {forrige ? (
        <button className="ik2-sti-tilbake" title={`Tilbake til ${forrige.navn}`} onClick={() => gaa(...(forrige.til ?? []))}>
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
      ) : null}
      {over.map((l, i) => (
        <span key={i} className="ik2-sti-ledd-boks">
          <button className="ik2-sti-ledd" onClick={() => gaa(...(l.til ?? []))}>{l.navn}</button>
          <span className="ik2-sti-skille">›</span>
        </span>
      ))}
      <span className="ik2-sti-her">{her?.navn}</span>
    </nav>
  )
}

/** En rad i en liste: tittel, litt til høyre, hele raden trykkbar. */
function Rad({ nr, tittel, mer, hoyre, under, onClick }: {
  nr?: string
  tittel: string
  mer?: string
  hoyre?: React.ReactNode
  under?: string
  onClick: () => void
}) {
  return (
    <button className="ik2-rad" onClick={onClick}>
      {nr ? <span className="ik2-rad-nr">{nr}</span> : null}
      <span className="ik2-rad-tekst">
        <span className="ik2-rad-tittel">{tittel}</span>
        {under ? <span className="ik2-rad-under">{under}</span> : null}
      </span>
      {mer ? <span className="ik2-rad-mer">{mer}</span> : null}
      {hoyre}
      <ChevronRight size={16} strokeWidth={2} className="ik2-rad-pil" />
    </button>
  )
}

/**
 * Sletting i to trykk, der knappen står. Ett trykk sletter ingenting; knappen
 * byttes ut med spørsmålet og to svar.
 */
function Slett({ hva, sporsmal, jobber, slett }: {
  hva: string
  sporsmal: string
  jobber: boolean
  slett: () => void
}) {
  const [spor, setSpor] = useState(false)
  if (spor) {
    return (
      <span className="ik2-bekreft">
        <span>{sporsmal}</span>
        <button className="ik2-bekreft-ja" disabled={jobber} onClick={() => { setSpor(false); slett() }}>Slett</button>
        <button className="ik2-bekreft-nei" disabled={jobber} onClick={() => setSpor(false)}>Avbryt</button>
      </span>
    )
  }
  return (
    <button className="ik2-slett" disabled={jobber} onClick={() => setSpor(true)}>
      <Trash2 size={13} strokeWidth={2} />
      {hva}
    </button>
  )
}

function useKjor(etterEndring: () => Promise<void>) {
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
  return { jobber, feil, kjor }
}

/* ── Side 1: kapitlene ────────────────────────────────────────────────── */

function KapitlerSide({ kapitler, punkter, naa }: {
  kapitler: IkPunkt[]
  punkter: Map<string, Ik2Punkt[]>
  naa: Date
}) {
  const [sok, setSok] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  const status = useMemo(() => fullstendighet(kapitler.map(k => ({
    nummer: k.nummer,
    harRutine: (punkter.get(k.id) ?? []).some(p => p.rutiner.some(r => r.innhold?.trim())),
    status: k.status,
    maaVaereSkriftlig: k.maaVaereSkriftlig,
  }))), [kapitler, punkter])

  // Taggene med antall rutiner bak seg, mest brukt først.
  const tagger = useMemo(() => {
    const telling = new Map<string, number>()
    for (const liste of punkter.values()) {
      for (const p of liste) for (const r of p.rutiner) {
        const t = r.tag?.trim()
        if (t) telling.set(t, (telling.get(t) ?? 0) + 1)
      }
    }
    return [...telling.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nb'))
      .map(([navn, n]) => ({ navn, n }))
  }, [punkter])

  // Søket svarer med en FLAT liste over rutiner, hver med stien sin. Alle
  // søkeordene må finnes i tittel, tekst eller tagg; taggen må stemme.
  const ord = sok.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const soker = ord.length > 0 || tag !== null
  const treff = useMemo(() => {
    if (!soker) return []
    const har = (tekst: string) => {
      const t = tekst.toLowerCase()
      return ord.every(o => t.includes(o))
    }
    const ut: { kapittel: IkPunkt; punkt: Ik2Punkt; rutine: Ik2Rutine }[] = []
    for (const kapittel of kapitler) {
      for (const punkt of punkter.get(kapittel.id) ?? []) {
        for (const rutine of punkt.rutiner) {
          if (tag && rutine.tag !== tag) continue
          if (ord.length > 0 && !har(`${kapittel.tittel} ${punkt.tittel} ${rutine.tittel} ${rutine.innhold ?? ''} ${rutine.tag ?? ''}`)) continue
          ut.push({ kapittel, punkt, rutine })
        }
      }
    }
    return ut
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soker, sok, tag, kapitler, punkter])

  // De lovpålagte først og for seg. Resten følger skjelettets egne grupper.
  const grupper = useMemo(() => {
    const ut: { navn: string; kapitler: IkPunkt[] }[] = []
    for (const k of kapitler) {
      const navn = k.maaVaereSkriftlig ? 'Lovpålagt skriftlig' : (GRUPPE_FOR[k.nummer] ?? 'Egne kapitler')
      const siste = ut[ut.length - 1]
      if (siste && siste.navn === navn) siste.kapitler.push(k)
      else ut.push({ navn, kapitler: [k] })
    }
    return ut
  }, [kapitler])

  const forfalte = kapitler.filter(k => erForfalt(k.sist_gjennomgatt, k.gjennomgang_intervall_mnd, naa)).length

  return (
    <>
      <div className="ik2-sok">
        <Felt
          placeholder="Søk i rutiner …"
          value={sok}
          onChange={e => setSok(e.target.value)}
        />
        {tagger.length > 0 ? (
          <div className="filter">
            {tagger.map(t => (
              <button
                key={t.navn}
                className="filter-knapp"
                aria-pressed={tag === t.navn}
                onClick={() => setTag(v => (v === t.navn ? null : t.navn))}
              >
                {t.navn}
                <span className="filter-tall">{t.n}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {soker ? (
        <>
          <div className="ik2-liste-hode">
            {treff.length === 0 ? 'Ingen treff' : stk(treff.length, 'treff', 'treff')}
          </div>
          {treff.map(({ kapittel, punkt, rutine }) => (
            <Rad
              key={rutine.id}
              tittel={rutine.tittel}
              under={`${kapittel.nummer} ${kapittel.tittel} › ${punkt.tittel}`}
              hoyre={rutine.tag ? <span className="ik2-tag">{rutine.tag}</span> : null}
              onClick={() => gaa(kapittel.id, punkt.id, rutine.id)}
            />
          ))}
        </>
      ) : (
        <>
          <p className="ik2-ingress">
            {status.pa_plass} av {status.kreves} lovpålagte kapitler vedtatt
            {forfalte > 0 ? ` · ${stk(forfalte, 'kapittel', 'kapitler')} til gjennomgang` : ''}
          </p>
          {grupper.map(g => (
            <div key={g.navn}>
              <div className="ik2-liste-hode">{g.navn}</div>
              {g.kapitler.map(k => {
                const egne = punkter.get(k.id) ?? []
                const forfalt = erForfalt(k.sist_gjennomgatt, k.gjennomgang_intervall_mnd, naa)
                return (
                  <Rad
                    key={k.id}
                    nr={k.nummer}
                    tittel={k.tittel}
                    mer={egne.length === 0 ? 'Tomt' : stk(egne.length, 'punkt', 'punkter')}
                    hoyre={forfalt
                      ? <TriangleAlert size={15} strokeWidth={2} style={{ color: 'var(--gul)', flex: 'none' }} />
                      : k.status === 'vedtatt'
                        ? <CircleCheck size={15} strokeWidth={2} style={{ color: 'var(--gronn)', flex: 'none' }} />
                        : <span className="ik2-rad-prikk" />}
                    onClick={() => gaa(k.id)}
                  />
                )
              })}
            </div>
          ))}
        </>
      )}
    </>
  )
}

/* ── Side 2: ett kapittel ─────────────────────────────────────────────── */

function KapittelSide({ kapittel, punkter, skjemaer, lesinger, maler, ansatte, naa, kanSkrive, etterEndring }: {
  kapittel: IkPunkt
  punkter: Ik2Punkt[]
  skjemaer: Skjemakobling[]
  lesinger: Lesing[]
  maler: Skjemamal[]
  ansatte: Ansatt[]
  naa: Date
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { profil } = useAuth()
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [redigerer, setRedigerer] = useState(false)
  const [nyttPunkt, setNyttPunkt] = useState<string | null>(null)
  const [utkast, setUtkast] = useState<Endring>({
    tittel: kapittel.tittel,
    hjemmel: kapittel.hjemmel,
    formal: kapittel.formal,
    innhold: kapittel.innhold,
    gjennomgang_intervall_mnd: kapittel.gjennomgang_intervall_mnd,
    ansvarlig: kapittel.ansvarlig,
  })
  const [notat, setNotat] = useState('')
  const seAudit = kan(profil?.role, 'logg.les')

  const hentRev = useCallback(() => hentRevisjoner(kapittel.id), [kapittel.id])
  const hentAud = useCallback(() => hentAuditFor('ik_punkter', kapittel.id), [kapittel.id])

  const endret =
    utkast.tittel !== kapittel.tittel ||
    (utkast.hjemmel ?? '') !== (kapittel.hjemmel ?? '') ||
    (utkast.formal ?? '') !== (kapittel.formal ?? '')

  const harTekst = punkter.some(p => p.rutiner.some(r => r.innhold?.trim()))
  const forfalt = erForfalt(kapittel.sist_gjennomgatt, kapittel.gjennomgang_intervall_mnd, naa)
  const neste = nesteGjennomgang(kapittel.sist_gjennomgatt, kapittel.gjennomgang_intervall_mnd)
  const harLest = lesinger.filter(l => l.versjon === kapittel.gjeldende_versjon)
  const jegHarLest = harLest.find(l => l.user_id === profil?.id)
  const knyttede = new Set(skjemaer.map(s => s.template_id))
  const ledige = maler.filter(m => !knyttede.has(m.id))

  function startRedigering() {
    setUtkast({
      tittel: kapittel.tittel,
      hjemmel: kapittel.hjemmel,
      formal: kapittel.formal,
      innhold: kapittel.innhold,
      gjennomgang_intervall_mnd: kapittel.gjennomgang_intervall_mnd,
      ansvarlig: kapittel.ansvarlig,
    })
    setNotat('')
    setRedigerer(true)
  }

  return (
    <>
      <Sti ledd={[{ navn: 'Kapitler', til: [] }, { navn: `${kapittel.nummer} ${kapittel.tittel}` }]} />

      <header className="ik2-hode">
        <h2 className="ik2-tittel valgbar">{kapittel.tittel}</h2>
        <p className="ik2-underlinje">
          {kapittel.maaVaereSkriftlig ? <Merke stil="endret">Lovpålagt skriftlig</Merke> : null}
          <span className="valgbar">{kapittel.hjemmel || 'Ingen hjemmel oppgitt'}</span>
        </p>
      </header>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {/* Bredden brukes: hovedformålet i hele sin lengde til venstre, punktene
          ved siden av til høyre, så begge står synlig samtidig. Å klippe
          teksten bak «Vis alt» var å gjemme det viktigste for å få plass til
          det nest viktigste, på en skjerm med plass til begge. */}
      <div className="ik2-kapittel">
      <div className="ik2-kapittel-venstre">
      {redigerer ? (
        <div className="seksjon seksjon-redigerer">
          <div className="seksjon-hode">
            <div className="seksjon-tittel">Redigerer kapittelet</div>
            <Merke stil="endret">Blir versjon {kapittel.gjeldende_versjon + 1}</Merke>
          </div>
          <div className="stabel" style={{ gap: 16 }}>
            <Felt firkant etikett="Tittel" value={utkast.tittel}
              onChange={e => setUtkast(u => ({ ...u, tittel: e.target.value }))} />
            <Felt firkant etikett="Hjemmel" value={utkast.hjemmel ?? ''}
              placeholder="Slå opp paragrafen i gjeldende forskrift"
              onChange={e => setUtkast(u => ({ ...u, hjemmel: e.target.value || null }))} />
            <label className="felt felt-firkant">
              <span className="felt-etikett">Hovedformål</span>
              <textarea className="felt-inn skrivefelt skrivefelt-lav" value={utkast.formal ?? ''}
                placeholder="Hva hele kapittelet skal sikre hos dere. Punktene under spisser det."
                onChange={e => setUtkast(u => ({ ...u, formal: e.target.value || null }))} />
            </label>
            <Felt firkant etikett="Hva ble endret, og hvorfor?" value={notat}
              placeholder="Presisert at måling skal loggføres"
              hjelp="Påkrevd. Blir stående i historikken."
              onChange={e => setNotat(e.target.value)} />
            <div className="rad">
              <Knapp stil="merke" disabled={!endret || !notat.trim() || jobber}
                onClick={() => void kjor(async () => {
                  await lagreEndring(kapittel, utkast, notat, { id: profil?.id ?? '', navn: profil?.full_name ?? '' })
                  setRedigerer(false)
                })}>
                {jobber ? 'Lagrer …' : 'Lagre'}
              </Knapp>
              <Knapp stil="naken" disabled={jobber} onClick={() => setRedigerer(false)}>Avbryt</Knapp>
            </div>
          </div>
        </div>
      ) : (
        <section className="ik2-avsnitt">
          <div className="ik2-avsnitt-hode">
            <span className="ik2-etikett">Hovedformål</span>
            {kanSkrive && kapittel.formal ? (
              <button className="ik2-lenke" onClick={startRedigering}><Pencil size={13} strokeWidth={2} />Rediger</button>
            ) : null}
          </div>
          {kapittel.formal ? (
            <p className="ik2-tekst valgbar">{kapittel.formal}</p>
          ) : kanSkrive ? (
            <Knapp stil="stille" onClick={startRedigering}><Plus size={15} strokeWidth={1.9} />Skriv hovedformålet</Knapp>
          ) : (
            <p className="ik2-tom-tekst">Ikke skrevet ennå.</p>
          )}
        </section>
      )}
      </div>

      <div className="ik2-kapittel-hoyre">
      <section className="ik2-avsnitt">
        <div className="ik2-avsnitt-hode">
          <span className="ik2-etikett">Punkter</span>
          {kanSkrive && nyttPunkt === null ? (
            <button className="ik2-lenke" onClick={() => setNyttPunkt('')}><Plus size={14} strokeWidth={2} />Nytt punkt</button>
          ) : null}
        </div>

        {nyttPunkt !== null ? (
          <form
            className="seksjon seksjon-redigerer"
            onSubmit={ev => {
              ev.preventDefault()
              if (!nyttPunkt.trim() || jobber) return
              void kjor(async () => {
                const id = await opprettIk2Punkt(kapittel.id, nyttPunkt)
                setNyttPunkt(null)
                gaa(kapittel.id, id)
              })
            }}
          >
            <Felt firkant autoFocus etikett="Hva heter punktet?" value={nyttPunkt}
              placeholder="Arbeid i tavle"
              hjelp="Én del av kapittelet. Rutinene legger du under punktet etterpå."
              onChange={e => setNyttPunkt(e.target.value)} />
            <div className="rad" style={{ marginTop: 12 }}>
              <Knapp stil="merke" type="submit" disabled={!nyttPunkt.trim() || jobber}>
                {jobber ? 'Oppretter …' : 'Opprett'}
              </Knapp>
              <Knapp stil="naken" type="button" disabled={jobber} onClick={() => setNyttPunkt(null)}>Avbryt</Knapp>
            </div>
          </form>
        ) : null}

        {punkter.length === 0 && nyttPunkt === null ? (
          <div className="ik2-tom">
            <p>Ingen punkter ennå. Del kapittelet opp i det dere faktisk gjør.</p>
            {HINT_FOR[kapittel.nummer] ? <p className="felt-hjelp">{HINT_FOR[kapittel.nummer]}</p> : null}
          </div>
        ) : punkter.map(p => (
          <Rad
            key={p.id}
            tittel={p.tittel}
            mer={p.rutiner.length === 0 ? 'Ingen rutiner' : stk(p.rutiner.length, 'rutine', 'rutiner')}
            onClick={() => gaa(kapittel.id, p.id)}
          />
        ))}
      </section>

      {/* Vedtaket. Én linje og én knapp. */}
      <section className="ik2-avsnitt ik2-vedtak">
        {kapittel.status === 'vedtatt' ? (
          <>
            <span className="ik2-vedtak-tekst">
              <CircleCheck size={15} strokeWidth={2} style={{ color: 'var(--gronn)' }} />
              Vedtatt {dato(kapittel.vedtatt_at)}, versjon {kapittel.gjeldende_versjon}.
              {' '}
              <span style={forfalt ? { color: 'var(--gul)' } : undefined}>
                {forfalt ? 'Skulle vært gjennomgått' : 'Gjennomgås'} innen {neste ? dato(neste) : '–'}.
              </span>
            </span>
            {kanSkrive ? (
              <Knapp stil={forfalt ? 'primar' : 'stille'} disabled={jobber}
                onClick={() => void kjor(() => kvitterGjennomgang(kapittel.id))}>
                {jobber ? 'Registrerer …' : 'Gjennomgått i dag'}
              </Knapp>
            ) : null}
          </>
        ) : (
          <>
            <span className="ik2-vedtak-tekst">
              Utkast. {harTekst ? 'Kan vedtas.' : 'Skriv minst én rutine før kapittelet kan vedtas.'}
            </span>
            {kanSkrive ? (
              <Knapp stil="primar" disabled={!harTekst || redigerer || jobber}
                onClick={() => void kjor(() => vedta(kapittel.id, profil?.id ?? ''))}>
                {jobber ? 'Vedtar …' : 'Vedta kapittelet'}
              </Knapp>
            ) : null}
          </>
        )}
      </section>

      {/* Resten er viktig, men ikke det man kom for. Lukket til man ber om det. */}
      <details className="ik2-mer">
        <summary>
          Skjemaer, lest av og historikk
          <span className="ik2-rad-mer">
            {stk(skjemaer.length, 'skjema', 'skjemaer')}
            {kapittel.status === 'vedtatt' ? ` · lest av ${antall(harLest.length)} av ${antall(ansatte.length)}` : ''}
          </span>
        </summary>

        <div className="ik2-avsnitt">
          <div className="ik2-avsnitt-hode"><span className="ik2-etikett">Skjemaer</span></div>
          {skjemaer.length === 0 ? <p className="ik2-tom-tekst">Ingen skjemaer knyttet til kapittelet.</p> : (
            <div className="stabel" style={{ gap: 8 }}>
              {skjemaer.map(s => (
                <div key={s.id} className="rad">
                  <FileText size={15} strokeWidth={1.8} className="dempet" />
                  <span className="strekk">{s.tittel}</span>
                  <span className="teller">v{s.versjon}</span>
                  {kanSkrive ? (
                    <button className="knapp knapp-naken" title="Fjern koblingen"
                      onClick={() => void kjor(() => loesnaSkjema(s.id))}>
                      <Unlink size={14} strokeWidth={1.9} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {kanSkrive && ledige.length > 0 ? (
            <select className="velger" style={{ marginTop: 12, maxWidth: 360 }} value=""
              onChange={e => { const id = e.target.value; if (id) void kjor(() => knyttSkjema(kapittel.id, id)) }}>
              <option value="">Knytt et skjema …</option>
              {ledige.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          ) : null}
        </div>

        <div className="ik2-avsnitt">
          <div className="ik2-avsnitt-hode"><span className="ik2-etikett">Lest av</span></div>
          {kapittel.status !== 'vedtatt' ? <p className="ik2-tom-tekst">Kapittelet er ikke vedtatt ennå.</p> : (
            <>
              <div className="stabel" style={{ gap: 8 }}>
                {ansatte.map(a => {
                  const lest = lesinger.find(l => l.user_id === a.id && l.versjon === kapittel.gjeldende_versjon)
                  const eldre = !lest && lesinger.some(l => l.user_id === a.id)
                  return (
                    <div key={a.id} className="rad">
                      {lest
                        ? <CircleCheck size={15} strokeWidth={2} style={{ color: 'var(--gronn)', flex: 'none' }} />
                        : <span className="ik2-rad-prikk" />}
                      <span className="strekk">{a.full_name}</span>
                      {lest ? <span className="dempet-mer" style={{ fontSize: 12 }}>{dato(lest.lest_at)}</span>
                        : eldre ? <span style={{ color: 'var(--gul)', fontSize: 12 }}>eldre versjon</span> : null}
                    </div>
                  )
                })}
              </div>
              {jegHarLest ? (
                <p className="felt-hjelp" style={{ marginTop: 12 }}>
                  Du bekreftet versjon {kapittel.gjeldende_versjon} den {dato(jegHarLest.lest_at)}.
                </p>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <Knapp stil="stille" disabled={jobber}
                    onClick={() => void kjor(() => bekreftLest(kapittel.id, kapittel.gjeldende_versjon, profil?.full_name ?? ''))}>
                    <CircleCheck size={15} strokeWidth={1.9} />
                    {jobber ? 'Bekrefter …' : 'Jeg har lest dette'}
                  </Knapp>
                </div>
              )}
            </>
          )}
        </div>

        <div className="ik2-avsnitt">
          <div className="ik2-avsnitt-hode"><span className="ik2-etikett">Historikk</span></div>
          <Historikk hentRevisjoner={hentRev} hentAudit={hentAud} seAudit={seAudit}
            tom="Kapittelet står slik det ble opprettet." />
        </div>
      </details>
      </div>
      </div>
    </>
  )
}

/* ── Side 3: ett punkt ────────────────────────────────────────────────── */

function PunktSide({ kapittel, punkt, opprettet, kanSkrive, etterEndring }: {
  kapittel: IkPunkt
  punkt: Ik2Punkt
  opprettet: (rutineId: string) => void
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [ny, setNy] = useState<{ tittel: string; tag: string } | null>(null)
  const [nyttNavn, setNyttNavn] = useState<string | null>(null)

  return (
    <>
      <Sti ledd={[
        { navn: 'Kapitler', til: [] },
        { navn: `${kapittel.nummer} ${kapittel.tittel}`, til: [kapittel.id] },
        { navn: punkt.tittel },
      ]} />

      <header className="ik2-hode">
        {nyttNavn !== null ? (
          <form className="rad" onSubmit={ev => {
            ev.preventDefault()
            if (!nyttNavn.trim() || jobber) return
            void kjor(async () => { await endreIk2('ik2_punkter', punkt.id, { tittel: nyttNavn.trim() }); setNyttNavn(null) })
          }}>
            <div style={{ flex: 1, maxWidth: 480 }}>
              <Felt firkant autoFocus value={nyttNavn} onChange={e => setNyttNavn(e.target.value)} />
            </div>
            <Knapp stil="merke" type="submit" disabled={!nyttNavn.trim() || jobber}>Lagre</Knapp>
            <Knapp stil="naken" type="button" onClick={() => setNyttNavn(null)}>Avbryt</Knapp>
          </form>
        ) : (
          <h2 className="ik2-tittel valgbar">
            {punkt.tittel}
            {kanSkrive ? (
              <button className="ik2-lenke" style={{ marginLeft: 12 }} title="Endre navnet" onClick={() => setNyttNavn(punkt.tittel)}>
                <Pencil size={13} strokeWidth={2} />
              </button>
            ) : null}
          </h2>
        )}
        <p className="ik2-underlinje">{kapittel.nummer} {kapittel.tittel}</p>
      </header>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <section className="ik2-avsnitt">
        <div className="ik2-avsnitt-hode">
          <span className="ik2-etikett">Rutiner</span>
          {kanSkrive && !ny ? (
            <button className="ik2-lenke" onClick={() => setNy({ tittel: '', tag: '' })}><Plus size={14} strokeWidth={2} />Ny rutine</button>
          ) : null}
        </div>

        {ny ? (
          <form
            className="seksjon seksjon-redigerer"
            onSubmit={ev => {
              ev.preventDefault()
              if (!ny.tittel.trim() || jobber) return
              void kjor(async () => {
                const id = await opprettIk2Rutine(punkt.id, ny.tittel, ny.tag || null)
                opprettet(id)
                setNy(null)
                gaa(kapittel.id, punkt.id, id)
              })
            }}
          >
            <div className="rad" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Felt firkant autoFocus etikett="Hva heter rutinen?" value={ny.tittel}
                  placeholder="Kontroll før spenningssetting"
                  onChange={e => setNy(v => (v ? { ...v, tittel: e.target.value } : v))} />
              </div>
              <div style={{ width: 170 }}>
                <Felt firkant etikett="Tagg" list="ik2-tagger" value={ny.tag} placeholder="HMS, AUS, tavle …"
                  onChange={e => setNy(v => (v ? { ...v, tag: e.target.value } : v))} />
              </div>
            </div>
            <div className="rad" style={{ marginTop: 12 }}>
              <Knapp stil="merke" type="submit" disabled={!ny.tittel.trim() || jobber}>
                {jobber ? 'Oppretter …' : 'Opprett og skriv'}
              </Knapp>
              <Knapp stil="naken" type="button" disabled={jobber} onClick={() => setNy(null)}>Avbryt</Knapp>
            </div>
          </form>
        ) : null}

        {punkt.rutiner.length === 0 && !ny ? (
          <div className="ik2-tom"><p>Ingen rutiner ennå.</p></div>
        ) : punkt.rutiner.map(r => (
          <Rad
            key={r.id}
            tittel={r.tittel}
            mer={r.innhold ? undefined : 'Ikke skrevet'}
            hoyre={r.tag ? <span className="ik2-tag">{r.tag}</span> : null}
            onClick={() => gaa(kapittel.id, punkt.id, r.id)}
          />
        ))}
      </section>

      {kanSkrive ? (
        <div className="ik2-bunn">
          <Slett
            hva="Slett punktet"
            sporsmal={punkt.rutiner.length > 0
              ? `Slette punktet og ${stk(punkt.rutiner.length, 'rutinen', 'rutinene')} under det?`
              : 'Slette punktet?'}
            jobber={jobber}
            slett={() => void kjor(async () => { await slettIk2('punkt', punkt.id); gaa(kapittel.id) })}
          />
        </div>
      ) : null}
    </>
  )
}

/* ── Side 4: én rutine ────────────────────────────────────────────────── */

function RutineSide({ kapittel, punkt, rutine, startISkrivemodus, kanSkrive, etterEndring }: {
  kapittel: IkPunkt
  punkt: Ik2Punkt
  rutine: Ik2Rutine
  startISkrivemodus: boolean
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [redigerer, setRedigerer] = useState(kanSkrive && startISkrivemodus)
  const [utkast, setUtkast] = useState({ tittel: rutine.tittel, tag: rutine.tag ?? '', innhold: rutine.innhold ?? '' })

  function start() {
    setUtkast({ tittel: rutine.tittel, tag: rutine.tag ?? '', innhold: rutine.innhold ?? '' })
    setRedigerer(true)
  }

  const endret =
    utkast.tittel.trim() !== rutine.tittel ||
    (utkast.tag.trim() || null) !== rutine.tag ||
    (utkast.innhold.trim() || null) !== rutine.innhold

  return (
    <>
      <Sti ledd={[
        { navn: 'Kapitler', til: [] },
        { navn: `${kapittel.nummer} ${kapittel.tittel}`, til: [kapittel.id] },
        { navn: punkt.tittel, til: [kapittel.id, punkt.id] },
        { navn: rutine.tittel },
      ]} />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {redigerer ? (
        <div className="seksjon seksjon-redigerer">
          <div className="stabel" style={{ gap: 14 }}>
            <div className="rad" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Felt firkant etikett="Rutine" value={utkast.tittel}
                  onChange={e => setUtkast(u => ({ ...u, tittel: e.target.value }))} />
              </div>
              <div style={{ width: 170 }}>
                <Felt firkant etikett="Tagg" list="ik2-tagger" value={utkast.tag} placeholder="HMS, AUS, tavle …"
                  onChange={e => setUtkast(u => ({ ...u, tag: e.target.value }))} />
              </div>
            </div>
            <label className="felt felt-firkant">
              <span className="felt-etikett">Slik gjøres det</span>
              <textarea className="felt-inn skrivefelt" rows={12} autoFocus value={utkast.innhold}
                placeholder="Hvem gjør hva, i hvilken rekkefølge, og hvordan vet man at det er gjort?"
                onChange={e => setUtkast(u => ({ ...u, innhold: e.target.value }))} />
            </label>
            <div className="rad">
              <Knapp stil="merke" disabled={!endret || !utkast.tittel.trim() || jobber}
                onClick={() => void kjor(async () => {
                  await endreIk2('ik2_rutiner', rutine.id, {
                    tittel: utkast.tittel.trim(),
                    tag: utkast.tag.trim() || null,
                    innhold: utkast.innhold.trim() || null,
                  })
                  setRedigerer(false)
                })}>
                {jobber ? 'Lagrer …' : 'Lagre'}
              </Knapp>
              <Knapp stil="naken" disabled={jobber} onClick={() => setRedigerer(false)}>Avbryt</Knapp>
            </div>
          </div>
        </div>
      ) : (
        <>
          <header className="ik2-hode">
            <h2 className="ik2-tittel valgbar">{rutine.tittel}</h2>
            <p className="ik2-underlinje">
              {rutine.tag ? <span className="ik2-tag">{rutine.tag}</span> : null}
              <span>{kapittel.nummer} {kapittel.tittel} › {punkt.tittel}</span>
            </p>
          </header>

          {rutine.innhold ? (
            <p className="ik2-tekst ik2-tekst-stor valgbar">{rutine.innhold}</p>
          ) : (
            <div className="ik2-tom"><p>Ikke skrevet ennå.</p></div>
          )}

          {kanSkrive ? (
            <div className="ik2-bunn">
              <Knapp stil={rutine.innhold ? 'stille' : 'merke'} onClick={start}>
                <Pencil size={14} strokeWidth={2} />
                {rutine.innhold ? 'Rediger' : 'Skriv rutinen'}
              </Knapp>
              <Slett hva="Slett rutinen" sporsmal="Slette rutinen?" jobber={jobber}
                slett={() => void kjor(async () => { await slettIk2('rutine', rutine.id); gaa(kapittel.id, punkt.id) })} />
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
