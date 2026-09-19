import { erForfalt, fullstendighet, IK_GRUPPENAVN, IK_SKJELETT, nesteGjennomgang } from '@delt/ik/skjelett'
import { kan } from '@delt/kontor-tilgang'
import { ChevronLeft, ChevronRight, CircleCheck, FileText, Pencil, Plus, Trash2, TriangleAlert, Unlink } from 'lucide-react'
import {
  ALVORLIGHET, ALVORLIGHET_NAVN, endreAvvik, gjenapneAvvik, hentAvvik, lukkAvvik, meldAvvik, slettAvvik,
  type Alvorlighet, type Avvik,
} from '@/lib/avvik-lager'
import {
  dagerTil, gyldighet, hentKompetanse, KOMPETANSE_NAVN, KOMPETANSE_TYPER, nyKompetanse, plussMaaneder, slettKompetanse,
  type Gyldighet, type Kompetanse, type KompetanseType,
} from '@/lib/kompetanse-lager'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import {
  endre as endreIk2, hentPunkterMedRutiner, nyRutine as opprettIk2Rutine,
  nyttPunkt as opprettIk2Punkt, slett as slettIk2,
  hentTagger, nyTag as opprettIk2Tag, endreTagnavn as endreIk2Tag, slettTag as slettIk2Tag, settRutineTagger,
  type Ik2Punkt, type Ik2Rutine, type Ik2Tag,
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
 * Tre grep for lesing og oppretting (18. september):
 *   - Stien over sida viser leddene OVER; sida selv er overskriften. Ingen
 *     gjentakelse, og telefonen slipper to linjer med samme navn.
 *   - Kapittellista sier tilstanden i ord («Vedtatt», «Utkast», «Ikke
 *     startet», «Til gjennomgang») og teller punkter og rutiner. Søket står
 *     i lista det søker i, ikke øverst som om det var det viktigste.
 *   - Kapittelsida har innholdet til venstre (formål, punkter) og statusen
 *     til høyre (vedtak, gjennomgang, skjemaer, lest av, historikk). Ny
 *     rutine er ÉN side der ingenting lagres før du trykker Lagre, og
 *     rutinesida har forrige/neste så et punkt kan leses i ett strekk.
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
const FORSLAG_FOR: Record<string, string[]> = Object.fromEntries(IK_SKJELETT.map(p => [p.nummer, p.forslag]))

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
  const [avvik, setAvvik] = useState<Avvik[]>([])
  const [kompetanse, setKompetanse] = useState<Kompetanse[]>([])
  const [tagger, setTagger] = useState<Ik2Tag[]>([])
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const [jobber, setJobber] = useState(false)

  const last = useCallback(async () => {
    setLaster(true)
    try {
      const [p, r, k, l, m, a, av, ko, tg] = await Promise.all([
        hentPunkter(),
        hentPunkterMedRutiner(),
        hentSkjemakoblinger(),
        hentLesinger(),
        hentSkjemamaler(),
        hentFirma(),
        hentAvvik(),
        hentKompetanse(),
        hentTagger(),
      ])
      setKapitler(p)
      setPunkter(r)
      setKoblinger(k)
      setLesinger(l)
      setMaler(m)
      setAnsatte(a.ansatte)
      setAvvik(av)
      setKompetanse(ko)
      setTagger(tg)
      setFeil(null)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setLaster(false)
    }
  }, [])

  useEffect(() => { void last() }, [last])

  const naa = useMemo(() => new Date(), [])

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
  /** `#/ik2/<kapittel>/<punkt>/ny`: skjemaet for en rutine som ikke finnes ennå. */
  const nyRutine = punkt !== null && sti[2] === 'ny' && kanSkrive
  const paaAvvik = sti[0] === 'avvik'
  const paaOpplaering = sti[0] === 'opplaering'
  const paaTagger = sti[0] === 'tagger'
  const valgtAvvik = paaAvvik ? avvik.find(a => a.id === sti[1]) ?? null : null
  const valgtAnsatt = paaOpplaering ? ansatte.find(a => a.id === sti[1]) ?? null : null

  const felles = { kanSkrive, etterEndring: last }
  const fse = fseOppsummering(ansatte, kompetanse, naa)
  const apneAvvik = avvik.filter(a => a.status === 'apent')

  return (
    <>
      <Sidehode tittel="Internkontroll v2" under="Firmaets IK-system" />
      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="arbeidsflate">
        <div className="ik2-side">
          <div className={(kapittel && !punkt) || (paaOpplaering && !valgtAnsatt) ? 'ik2-innhold ik2-innhold-bred' : 'ik2-innhold'}>
            {laster && kapitler.length === 0 ? (
              <div className="tomt-mykt"><p>Henter …</p></div>
            ) : paaTagger ? (
              <TaggerSide tagger={tagger} punkter={punkter} {...felles} />
            ) : valgtAvvik ? (
              <AvvikDetalj key={valgtAvvik.id} avvik={valgtAvvik} ansatte={ansatte} {...felles} />
            ) : paaAvvik ? (
              <AvvikSide avvik={avvik} ansatte={ansatte} naa={naa} {...felles} />
            ) : valgtAnsatt ? (
              <AnsattSide key={valgtAnsatt.id} ansatt={valgtAnsatt} kompetanse={kompetanse.filter(k => k.user_id === valgtAnsatt.id)} naa={naa} {...felles} />
            ) : paaOpplaering ? (
              <OpplaeringSide ansatte={ansatte} kompetanse={kompetanse} naa={naa} />
            ) : rutine && punkt && kapittel ? (
              <RutineSide key={rutine.id} kapittel={kapittel} punkt={punkt} rutine={rutine} tagger={tagger} {...felles} />
            ) : nyRutine && punkt && kapittel ? (
              <NyRutineSide key={`ny-${punkt.id}`} kapittel={kapittel} punkt={punkt} tagger={tagger} etterEndring={last} />
            ) : punkt && kapittel ? (
              <PunktSide key={punkt.id} kapittel={kapittel} punkt={punkt} {...felles} />
            ) : kapittel ? (
              <KapittelSide
                key={kapittel.id}
                kapittel={kapittel}
                punkter={punkter.get(kapittel.id) ?? []}
                skjemaer={koblinger.get(kapittel.id) ?? []}
                lesinger={lesinger.get(kapittel.id) ?? []}
                maler={maler}
                ansatte={ansatte}
                apneAvvik={apneAvvik.length}
                fse={fse}
                naa={naa}
                {...felles}
              />
            ) : (
              <KapitlerSide kapitler={kapitler} punkter={punkter} avvik={apneAvvik} fse={fse} ansatte={ansatte} kompetanse={kompetanse} naa={naa} tagger={tagger} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Byggeklosser ─────────────────────────────────────────────────────── */

/**
 * Stien over sida: leddene OVER der du er, hvert av dem trykkbart, og pila
 * lengst til venstre som er ett hakk opp. Sida selv står som overskrift rett
 * under stien og gjentas ikke i den — på telefonen ble det to linjer med samme
 * navn. Uten stien svarer ikke sida på «hvor er jeg», og det var det første
 * Tormod spurte om.
 */
function Sti({ ledd }: { ledd: { navn: string; til: string[] }[] }) {
  const forrige = ledd[ledd.length - 1]
  return (
    <nav className="ik2-sti">
      {forrige ? (
        <button className="ik2-sti-tilbake" title={`Tilbake til ${forrige.navn}`} onClick={() => gaa(...forrige.til)}>
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
      ) : null}
      {ledd.map((l, i) => (
        <span key={i} className="ik2-sti-ledd-boks">
          <button className="ik2-sti-ledd" onClick={() => gaa(...l.til)}>{l.navn}</button>
          {i < ledd.length - 1 ? <span className="ik2-sti-skille">›</span> : null}
        </span>
      ))}
    </nav>
  )
}

/**
 * Tilstanden til høyre i en rad, i ORD: «Vedtatt», «Utkast», «Til
 * gjennomgang». En hake og en stiplet ring betyr noe for den som laget dem,
 * ikke for den som åpner flata første gang.
 */
function Tilstand({ stil = 'stille', ikon, children }: {
  stil?: 'ok' | 'varsel' | 'stille' | 'dempet'
  ikon?: React.ReactNode
  children: React.ReactNode
}) {
  return <span className={`ik2-tilstand ik2-tilstand-${stil}`}>{ikon}{children}</span>
}

/** Første linja av en tekst, kuttet — nok til å se hva rutinen handler om. */
function utdrag(tekst: string, maks = 120): string {
  const linje = tekst.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  const rein = linje.replace(/\s+/g, ' ')
  return rein.length > maks ? `${rein.slice(0, maks - 1).trimEnd()}…` : rein
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
  /** Sant når arbeidet OG omlastingen gikk — da kan kalleren navigere videre. */
  async function kjor(arbeid: () => Promise<void>): Promise<boolean> {
    setJobber(true)
    setFeil(null)
    try {
      await arbeid()
      await etterEndring()
      return true
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setJobber(false)
    }
  }
  return { jobber, feil, kjor }
}

/* ── Side 1: kapitlene ────────────────────────────────────────────────── */

/** «x av y har gyldig FSE» — det DLE spør om først. */
type FseOppsummering = { gyldige: number; totalt: number; utgaar: number; utgatt: number; mangler: number }

function fseOppsummering(ansatte: Ansatt[], kompetanse: Kompetanse[], naa: Date): FseOppsummering {
  const ut: FseOppsummering = { gyldige: 0, totalt: ansatte.length, utgaar: 0, utgatt: 0, mangler: 0 }
  for (const a of ansatte) {
    const g = gyldighet(kompetanse, a.id, 'fse', naa).status
    if (g === 'gyldig') ut.gyldige++
    else if (g === 'utgaar') { ut.gyldige++; ut.utgaar++ }
    else if (g === 'utgatt') ut.utgatt++
    else ut.mangler++
  }
  return ut
}

function KapitlerSide({ kapitler, punkter, avvik, fse, ansatte, kompetanse, naa, tagger }: {
  kapitler: IkPunkt[]
  punkter: Map<string, Ik2Punkt[]>
  avvik: Avvik[]
  fse: FseOppsummering
  ansatte: Ansatt[]
  kompetanse: Kompetanse[]
  naa: Date
  tagger: Ik2Tag[]
}) {
  const [sok, setSok] = useState('')
  const [valgteTagger, setValgteTagger] = useState<Set<string>>(new Set())

  const status = useMemo(() => fullstendighet(kapitler.map(k => ({
    nummer: k.nummer,
    harRutine: (punkter.get(k.id) ?? []).some(p => p.rutiner.some(r => r.innhold?.trim())),
    status: k.status,
    maaVaereSkriftlig: k.maaVaereSkriftlig,
  }))), [kapitler, punkter])

  // Registeret med antall rutiner bak hver tagg, mest brukt først. Alle
  // taggene vises — også de ingen rutine har fått ennå.
  const tagvalg = useMemo(() => {
    const telling = new Map<string, number>()
    for (const liste of punkter.values()) {
      for (const p of liste) for (const r of p.rutiner) for (const t of r.tagger) telling.set(t.id, (telling.get(t.id) ?? 0) + 1)
    }
    return tagger
      .map(t => ({ ...t, n: telling.get(t.id) ?? 0 }))
      .sort((a, b) => b.n - a.n || a.navn.localeCompare(b.navn, 'nb'))
  }, [punkter, tagger])

  // Søket svarer med en FLAT liste over rutiner, hver med stien sin. Alle
  // søkeordene må finnes i tittel, tekst eller tagg; taggen må stemme.
  const ord = sok.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const soker = ord.length > 0 || valgteTagger.size > 0
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
          // Flere tagger snevrer inn: rutinen må ha ALLE de valgte.
          if (valgteTagger.size > 0 && ![...valgteTagger].every(id => rutine.tagger.some(t => t.id === id))) continue
          if (ord.length > 0 && !har(`${kapittel.tittel} ${punkt.tittel} ${rutine.tittel} ${rutine.innhold ?? ''} ${rutine.tagger.map(t => t.navn).join(' ')}`)) continue
          ut.push({ kapittel, punkt, rutine })
        }
      }
    }
    return ut
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soker, sok, valgteTagger, kapitler, punkter])

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

  // «Å gjøre» er HMS-kalenderen i den formen som er til å bruke: bare det som
  // er forfalt eller forfaller snart, som rader man kan trykke på. Er lista
  // tom, finnes den ikke — en tom kalender er ikke informasjon.
  const gjore = useMemo(() => {
    const ut: { id: string; tekst: string; mer: string; grad: 'na' | 'snart'; til: string[] }[] = []
    for (const k of kapitler) {
      const neste = nesteGjennomgang(k.sist_gjennomgatt, k.gjennomgang_intervall_mnd)
      if (!neste) continue
      const dager = Math.round((neste.getTime() - naa.getTime()) / 86_400_000)
      if (dager < 0) ut.push({ id: k.id, tekst: `${k.nummer} ${k.tittel}`, mer: `Skulle vært gjennomgått ${dato(neste)}`, grad: 'na', til: [k.id] })
      else if (dager <= 30) ut.push({ id: k.id, tekst: `${k.nummer} ${k.tittel}`, mer: `Gjennomgås innen ${dato(neste)}`, grad: 'snart', til: [k.id] })
    }
    for (const a of ansatte) {
      for (const type of ['fse', 'forstehjelp'] as const) {
        const g = gyldighet(kompetanse, a.id, type, naa)
        if (g.status === 'utgatt') ut.push({ id: `${a.id}-${type}`, tekst: `${a.full_name}: ${KOMPETANSE_NAVN[type]} er utgått`, mer: g.rad?.gyldig_til ? `Gikk ut ${dato(g.rad.gyldig_til)}` : '', grad: 'na', til: ['opplaering', a.id] })
        else if (g.status === 'utgaar') ut.push({ id: `${a.id}-${type}`, tekst: `${a.full_name}: ${KOMPETANSE_NAVN[type]} går ut`, mer: g.rad?.gyldig_til ? `Innen ${dato(g.rad.gyldig_til)}` : '', grad: 'snart', til: ['opplaering', a.id] })
      }
    }
    const kritiske = avvik.filter(a => a.alvorlighet === 'kritisk' || a.alvorlighet === 'hoy')
    for (const a of kritiske) {
      ut.push({ id: a.id, tekst: a.tittel, mer: `${ALVORLIGHET_NAVN[a.alvorlighet]} avvik${a.frist_at ? ` · frist ${dato(a.frist_at)}` : ''}`, grad: a.alvorlighet === 'kritisk' ? 'na' : 'snart', til: ['avvik', a.id] })
    }
    return ut.sort((a, b) => (a.grad === b.grad ? 0 : a.grad === 'na' ? -1 : 1))
  }, [kapitler, ansatte, kompetanse, avvik, naa])

  /** Ett ord om hvor kapittelet står. Ordet, ikke bare et ikon. */
  function tilstand(k: IkPunkt, egne: Ik2Punkt[]) {
    if (erForfalt(k.sist_gjennomgatt, k.gjennomgang_intervall_mnd, naa)) {
      return <Tilstand stil="varsel" ikon={<TriangleAlert size={14} strokeWidth={2} />}>Til gjennomgang</Tilstand>
    }
    if (k.status === 'vedtatt') return <Tilstand stil="ok" ikon={<CircleCheck size={14} strokeWidth={2} />}>Vedtatt</Tilstand>
    if (k.status === 'utgatt') return <Tilstand stil="varsel">Utgått</Tilstand>
    const skrevet = egne.some(p => p.rutiner.some(r => r.innhold?.trim()))
    if (skrevet) return <Tilstand>Utkast</Tilstand>
    return <Tilstand stil="dempet">Ikke startet</Tilstand>
  }

  return (
    <>
      {gjore.length > 0 ? (
        <section className="ik2-avsnitt ik2-gjore">
          <div className="ik2-avsnitt-hode">
            <span className="ik2-etikett">Å gjøre</span>
            <span className="ik2-rad-mer">{stk(gjore.length, 'ting', 'ting')}</span>
          </div>
          {gjore.map(g => (
            <Rad
              key={g.id}
              tittel={g.tekst}
              mer={g.mer}
              hoyre={<span className={`ik2-prikk ik2-prikk-${g.grad}`} aria-hidden />}
              onClick={() => gaa(...g.til)}
            />
          ))}
        </section>
      ) : null}

      {/* De to registrene som ikke er kapitler, men som DLE ber om å se
          først. Egen inngang, som hos alle andre systemer. */}
      <section className="ik2-avsnitt">
        <div className="ik2-avsnitt-hode"><span className="ik2-etikett">Registre</span></div>
        <Rad
          tittel="Avvik"
          mer={avvik.length === 0 ? 'Ingen åpne' : `${stk(avvik.length, 'åpent', 'åpne')}`}
          hoyre={avvik.some(a => a.alvorlighet === 'kritisk') ? <span className="ik2-prikk ik2-prikk-na" aria-hidden /> : null}
          onClick={() => gaa('avvik')}
        />
        <Rad
          tittel="Opplæring"
          mer={fse.totalt === 0 ? 'Ingen ansatte' : `${fse.gyldige} av ${fse.totalt} har gyldig FSE`}
          hoyre={fse.utgatt + fse.mangler > 0 ? <span className="ik2-prikk ik2-prikk-na" aria-hidden /> : fse.utgaar > 0 ? <span className="ik2-prikk ik2-prikk-snart" aria-hidden /> : null}
          onClick={() => gaa('opplaering')}
        />
        <Rad
          tittel="Tagger"
          mer={tagger.length === 0 ? 'Ingen ennå' : stk(tagger.length, 'tagg', 'tagger')}
          onClick={() => gaa('tagger')}
        />
      </section>

      {/* Håndboka. Hodet sier hvor langt den er kommet; søket står her fordi
          det søker i den, ikke øverst på sida som om det var det viktigste. */}
      <section className="ik2-avsnitt">
        <div className="ik2-avsnitt-hode ik2-avsnitt-hode-sok">
          <span className="ik2-etikett">Kapitler</span>
          <span className="ik2-rad-mer">
            {status.pa_plass} av {status.kreves} lovpålagte vedtatt
            {forfalte > 0 ? ` · ${stk(forfalte, 'kapittel', 'kapitler')} til gjennomgang` : ''}
          </span>
          <div className="ik2-sokfelt">
            <Felt placeholder="Søk i rutiner …" value={sok} onChange={e => setSok(e.target.value)} />
          </div>
        </div>
        {tagvalg.length > 0 ? (
          <div className="filter ik2-tagger">
            {tagvalg.map(t => (
              <button
                key={t.id}
                className="filter-knapp"
                aria-pressed={valgteTagger.has(t.id)}
                onClick={() => setValgteTagger(v => { const ny = new Set(v); if (ny.has(t.id)) ny.delete(t.id); else ny.add(t.id); return ny })}
              >
                {t.navn}
                <span className="filter-tall">{t.n}</span>
              </button>
            ))}
            {valgteTagger.size > 0 ? (
              <button className="filter-knapp" onClick={() => setValgteTagger(new Set())}>Nullstill</button>
            ) : null}
          </div>
        ) : null}

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
                hoyre={<Tagger tagger={rutine.tagger} />}
                onClick={() => gaa(kapittel.id, punkt.id, rutine.id)}
              />
            ))}
          </>
        ) : grupper.map(g => (
          <div key={g.navn}>
            <div className="ik2-liste-hode">{g.navn}</div>
            {g.kapitler.map(k => {
              const egne = punkter.get(k.id) ?? []
              const rutiner = egne.reduce((n, p) => n + p.rutiner.length, 0)
              return (
                <Rad
                  key={k.id}
                  nr={k.nummer}
                  tittel={k.tittel}
                  hoyre={(
                    <>
                      {egne.length > 0 ? (
                        <span className="ik2-rad-mer ik2-rad-telling">
                          {stk(egne.length, 'punkt', 'punkter')}{rutiner > 0 ? ` · ${stk(rutiner, 'rutine', 'rutiner')}` : ''}
                        </span>
                      ) : null}
                      {tilstand(k, egne)}
                    </>
                  )}
                  onClick={() => gaa(k.id)}
                />
              )
            })}
          </div>
        ))}
      </section>
    </>
  )
}

/* ── Side 2: ett kapittel ─────────────────────────────────────────────── */

function KapittelSide({ kapittel, punkter, skjemaer, lesinger, maler, ansatte, apneAvvik, fse, naa, kanSkrive, etterEndring }: {
  kapittel: IkPunkt
  punkter: Ik2Punkt[]
  skjemaer: Skjemakobling[]
  lesinger: Lesing[]
  maler: Skjemamal[]
  ansatte: Ansatt[]
  apneAvvik: number
  fse: FseOppsummering
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

  // Forslagene som ikke alt er brukt. Titler, aldri tekst — se skjelettet.
  const brukte = new Set(punkter.map(p => p.tittel.trim().toLowerCase()))
  const forslag = (FORSLAG_FOR[kapittel.nummer] ?? []).filter(t => !brukte.has(t.toLowerCase()))
  const [forslagJobber, setForslagJobber] = useState<string | null>(null)

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
      <Sti ledd={[{ navn: 'Kapitler', til: [] }]} />

      <header className="ik2-hode">
        <h2 className="ik2-tittel valgbar"><span className="ik2-tittel-nr">{kapittel.nummer}</span>{kapittel.tittel}</h2>
        <p className="ik2-underlinje">
          {kapittel.maaVaereSkriftlig ? <Merke stil="endret">Lovpålagt skriftlig</Merke> : null}
          <span className="valgbar">{kapittel.hjemmel || 'Ingen hjemmel oppgitt'}</span>
        </p>
      </header>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {/* To spalter med hver sin jobb: til venstre det kapittelet SIER
          (formålet og punktene), til høyre hvor det STÅR (vedtak, gjennomgang,
          skjemaer, lest av, historikk). Forrige oppsett hadde formålet alene
          til venstre og alt annet stablet til høyre, så innholdet lå delt på
          to spalter med det administrative innimellom. Under 1100 px står
          innholdet først og statusen etter. */}
      <div className="ik2-kapittel">
      <div className="ik2-kapittel-innhold">
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

      <section className="ik2-avsnitt">
        <div className="ik2-avsnitt-hode">
          <span className="ik2-etikett">Punkter</span>
          {punkter.length > 0 ? <span className="ik2-rad-mer">{stk(punkter.length, 'punkt', 'punkter')}</span> : null}
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
              void (async () => {
                let id: string | null = null
                const ok = await kjor(async () => { id = await opprettIk2Punkt(kapittel.id, nyttPunkt) })
                if (ok && id) { setNyttPunkt(null); gaa(kapittel.id, id) }
              })()
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
        ) : punkter.map(p => {
          const uskrevne = p.rutiner.filter(r => !r.innhold?.trim()).length
          return (
            <Rad
              key={p.id}
              tittel={p.tittel}
              mer={p.rutiner.length === 0 ? 'Ingen rutiner' : `${stk(p.rutiner.length, 'rutine', 'rutiner')}${uskrevne > 0 ? ` · ${uskrevne} ikke skrevet` : ''}`}
              onClick={() => gaa(kapittel.id, p.id)}
            />
          )
        })}

        {/* Forslag: ett trykk lager punktet, uten tekst. Det er ikke NIKs
            ferdige perm — det er overskriftene, så firmaet slipper å stirre
            på et tomt kapittel. Rutinene under skriver de selv. */}
        {kanSkrive && forslag.length > 0 ? (
          <div className="ik2-forslag">
            <span className="ik2-forslag-etikett">{punkter.length === 0 ? 'Vanlige punkter her — trykk for å legge til' : 'Flere vanlige punkter'}</span>
            <div className="filter">
              {forslag.map(t => (
                <button
                  key={t}
                  className="filter-knapp ik2-forslag-knapp"
                  disabled={forslagJobber !== null}
                  onClick={() => {
                    setForslagJobber(t)
                    void kjor(() => opprettIk2Punkt(kapittel.id, t).then(() => undefined)).finally(() => setForslagJobber(null))
                  }}
                >
                  <Plus size={13} strokeWidth={2.2} />
                  {forslagJobber === t ? 'Lager …' : t}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Kapittel 4 og 7 har et register bak seg. Rutinen sier hvordan;
          registeret sier hva som faktisk står. */}
      {kapittel.nummer === '4' ? (
        <section className="ik2-avsnitt">
          <Rad tittel="Avvik" under="Det som er meldt, og hva som ble gjort" mer={apneAvvik === 0 ? 'Ingen åpne' : stk(apneAvvik, 'åpent', 'åpne')} onClick={() => gaa('avvik')} />
        </section>
      ) : null}
      {kapittel.nummer === '7' ? (
        <section className="ik2-avsnitt">
          <Rad tittel="Opplæringsregister" under="Hvem har hvilke kurs, og når de går ut" mer={fse.totalt === 0 ? '' : `${fse.gyldige} av ${fse.totalt} har gyldig FSE`} onClick={() => gaa('opplaering')} />
        </section>
      ) : null}
      </div>

      <aside className="ik2-kapittel-status">
        {/* Hvor kapittelet står, i tre linjer og én knapp. */}
        <div className="ik2-status">
          {kapittel.status === 'vedtatt' ? (
            <>
              <div className="ik2-status-hode">
                <CircleCheck size={16} strokeWidth={2} style={{ color: 'var(--gronn)' }} />
                Vedtatt
              </div>
              <p>{dato(kapittel.vedtatt_at)} · versjon {kapittel.gjeldende_versjon}</p>
              <p style={forfalt ? { color: 'var(--gul)' } : undefined}>
                {forfalt ? 'Skulle vært gjennomgått' : 'Gjennomgås'} innen {neste ? dato(neste) : '–'}.
              </p>
              {kanSkrive ? (
                <Knapp stil={forfalt ? 'primar' : 'stille'} disabled={jobber}
                  onClick={() => void kjor(() => kvitterGjennomgang(kapittel.id))}>
                  {jobber ? 'Registrerer …' : 'Gjennomgått i dag'}
                </Knapp>
              ) : null}
            </>
          ) : (
            <>
              <div className="ik2-status-hode">Utkast</div>
              <p>{harTekst ? 'Kan vedtas.' : 'Skriv minst én rutine før kapittelet kan vedtas.'}</p>
              {kanSkrive ? (
                <Knapp stil="primar" disabled={!harTekst || redigerer || jobber}
                  onClick={() => void kjor(() => vedta(kapittel.id, profil?.id ?? ''))}>
                  {jobber ? 'Vedtar …' : 'Vedta kapittelet'}
                </Knapp>
              ) : null}
            </>
          )}
        </div>

        {/* Resten er viktig, men ikke det man kom for. Hver for seg, lukket
            til man ber om det, med tallet i lukket tilstand. */}
        <details className="ik2-mer">
          <summary>Skjemaer<span className="ik2-rad-mer">{skjemaer.length === 0 ? 'Ingen' : antall(skjemaer.length)}</span></summary>
          <div className="ik2-avsnitt">
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
        </details>

        <details className="ik2-mer">
          <summary>
            Lest av
            <span className="ik2-rad-mer">
              {kapittel.status === 'vedtatt' ? `${antall(harLest.length)} av ${antall(ansatte.length)}` : 'Ikke vedtatt'}
            </span>
          </summary>
          <div className="ik2-avsnitt">
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
        </details>

        <details className="ik2-mer">
          <summary>Historikk<span className="ik2-rad-mer">versjon {kapittel.gjeldende_versjon}</span></summary>
          <div className="ik2-avsnitt">
            <Historikk hentRevisjoner={hentRev} hentAudit={hentAud} seAudit={seAudit}
              tom="Kapittelet står slik det ble opprettet." />
          </div>
        </details>
      </aside>
      </div>
    </>
  )
}

/* ── Side 3: ett punkt ────────────────────────────────────────────────── */

function PunktSide({ kapittel, punkt, kanSkrive, etterEndring }: {
  kapittel: IkPunkt
  punkt: Ik2Punkt
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [nyttNavn, setNyttNavn] = useState<string | null>(null)
  const uskrevne = punkt.rutiner.filter(r => !r.innhold?.trim()).length

  return (
    <>
      <Sti ledd={[
        { navn: 'Kapitler', til: [] },
        { navn: `${kapittel.nummer} ${kapittel.tittel}`, til: [kapittel.id] },
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
        <p className="ik2-underlinje">
          {punkt.rutiner.length === 0
            ? 'Ingen rutiner ennå.'
            : `${stk(punkt.rutiner.length, 'rutine', 'rutiner')}${uskrevne > 0 ? ` · ${uskrevne} ikke skrevet` : ''}`}
        </p>
      </header>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <section className="ik2-avsnitt">
        <div className="ik2-avsnitt-hode">
          <span className="ik2-etikett">Rutiner</span>
          {kanSkrive ? (
            <button className="ik2-lenke" onClick={() => gaa(kapittel.id, punkt.id, 'ny')}><Plus size={14} strokeWidth={2} />Ny rutine</button>
          ) : null}
        </div>

        {punkt.rutiner.length === 0 ? (
          <div className="ik2-tom">
            <p>Ingen rutiner ennå.</p>
            {kanSkrive ? <p className="felt-hjelp">En rutine er én ting dere gjør, skrevet slik at en ny montør kan gjøre det likt.</p> : null}
          </div>
        ) : punkt.rutiner.map(r => (
          // Første linja av teksten under tittelen, så man ser hva rutinen
          // handler om uten å åpne den. Har den ingen tekst, står det.
          <Rad
            key={r.id}
            tittel={r.tittel}
            under={r.innhold?.trim() ? utdrag(r.innhold) : 'Ikke skrevet ennå'}
            hoyre={<Tagger tagger={r.tagger} />}
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

type RutineUtkast = { tittel: string; tagIds: string[]; innhold: string }

/** Skjemaet for en rutine: tittel, tagg og teksten. Brukes både ny og endret. */
function RutineSkjema({ utkast, setUtkast, jobber, kanLagre, lagreTekst, lagrerTekst, onLagre, onAvbryt, tagger, onNyTag }: {
  utkast: RutineUtkast
  setUtkast: (f: (u: RutineUtkast) => RutineUtkast) => void
  jobber: boolean
  tagger: Ik2Tag[]
  onNyTag: (navn: string) => Promise<string>
  kanLagre: boolean
  lagreTekst: string
  lagrerTekst: string
  onLagre: () => void
  onAvbryt: () => void
}) {
  return (
    <form
      className="seksjon seksjon-redigerer"
      onSubmit={ev => { ev.preventDefault(); if (kanLagre && !jobber) onLagre() }}
    >
      <div className="stabel" style={{ gap: 14 }}>
        <div className="rad" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Felt firkant autoFocus={!utkast.tittel} etikett="Hva heter rutinen?" value={utkast.tittel}
              placeholder="Kontroll før spenningssetting"
              onChange={e => setUtkast(u => ({ ...u, tittel: e.target.value }))} />
          </div>
        </div>
        <div className="felt felt-firkant">
          <span className="felt-etikett">Tagger</span>
          <Tagvelger tagger={tagger} valgt={utkast.tagIds} jobber={jobber} onNyTag={onNyTag}
            onEndre={ids => setUtkast(u => ({ ...u, tagIds: ids }))} />
          <span className="felt-hjelp">Taggen lages én gang og brukes på alle rutinene den gjelder. Filteret på kapittellista er de samme taggene.</span>
        </div>
        <label className="felt felt-firkant">
          <span className="felt-etikett">Slik gjøres det</span>
          <textarea className="felt-inn skrivefelt" rows={12} autoFocus={!!utkast.tittel} value={utkast.innhold}
            placeholder="Hvem gjør hva, i hvilken rekkefølge, og hvordan vet man at det er gjort?"
            onChange={e => setUtkast(u => ({ ...u, innhold: e.target.value }))} />
        </label>
        <div className="rad">
          <Knapp stil="merke" type="submit" disabled={!kanLagre || jobber}>
            {jobber ? lagrerTekst : lagreTekst}
          </Knapp>
          <Knapp stil="naken" type="button" disabled={jobber} onClick={onAvbryt}>Avbryt</Knapp>
        </div>
      </div>
    </form>
  )
}

/**
 * Ny rutine er én side, ikke to. Før måtte man døpe rutinen i et lite skjema,
 * så ble den opprettet tom, så åpnet den seg for skriving — og den som ombestemte
 * seg underveis satt igjen med en rutine som het «Ikke skrevet». Nå står tittel,
 * tagg og tekst på samme side, og ingenting lagres før du trykker Lagre.
 */
function NyRutineSide({ kapittel, punkt, tagger, etterEndring }: {
  kapittel: IkPunkt
  punkt: Ik2Punkt
  tagger: Ik2Tag[]
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [utkast, setUtkast] = useState<RutineUtkast>({ tittel: '', tagIds: [], innhold: '' })

  return (
    <>
      <Sti ledd={[
        { navn: 'Kapitler', til: [] },
        { navn: `${kapittel.nummer} ${kapittel.tittel}`, til: [kapittel.id] },
        { navn: punkt.tittel, til: [kapittel.id, punkt.id] },
      ]} />

      <header className="ik2-hode">
        <h2 className="ik2-tittel">Ny rutine</h2>
        <p className="ik2-underlinje">Under «{punkt.tittel}». Ingenting lagres før du trykker Lagre.</p>
      </header>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <RutineSkjema
        utkast={utkast}
        setUtkast={setUtkast}
        jobber={jobber}
        kanLagre={!!utkast.tittel.trim()}
        lagreTekst="Lagre rutinen"
        lagrerTekst="Lagrer …"
        tagger={tagger}
        onNyTag={async navn => { const id = await opprettIk2Tag(navn); await etterEndring(); return id }}
        onLagre={() => void (async () => {
          let id: string | null = null
          const ok = await kjor(async () => {
            id = await opprettIk2Rutine(punkt.id, utkast.tittel, utkast.tagIds, utkast.innhold.trim() || null)
          })
          if (ok && id) gaa(kapittel.id, punkt.id, id)
        })()}
        onAvbryt={() => gaa(kapittel.id, punkt.id)}
      />
    </>
  )
}

function RutineSide({ kapittel, punkt, rutine, tagger, kanSkrive, etterEndring }: {
  kapittel: IkPunkt
  punkt: Ik2Punkt
  rutine: Ik2Rutine
  tagger: Ik2Tag[]
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [redigerer, setRedigerer] = useState(false)
  const [utkast, setUtkast] = useState<RutineUtkast>({ tittel: rutine.tittel, tagIds: rutine.tagger.map(t => t.id), innhold: rutine.innhold ?? '' })

  function start() {
    setUtkast({ tittel: rutine.tittel, tagIds: rutine.tagger.map(t => t.id), innhold: rutine.innhold ?? '' })
    setRedigerer(true)
  }

  const endret =
    utkast.tittel.trim() !== rutine.tittel ||
    !sammeSett(utkast.tagIds, rutine.tagger.map(t => t.id)) ||
    (utkast.innhold.trim() || null) !== rutine.innhold

  // Forrige og neste rutine under samme punkt, så man kan lese seg gjennom
  // punktet uten å gå opp og ned for hver.
  const i = punkt.rutiner.findIndex(r => r.id === rutine.id)
  const forrige = i > 0 ? punkt.rutiner[i - 1] : null
  const neste = i >= 0 && i < punkt.rutiner.length - 1 ? punkt.rutiner[i + 1] : null

  return (
    <>
      <Sti ledd={[
        { navn: 'Kapitler', til: [] },
        { navn: `${kapittel.nummer} ${kapittel.tittel}`, til: [kapittel.id] },
        { navn: punkt.tittel, til: [kapittel.id, punkt.id] },
      ]} />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {redigerer ? (
        <>
          <header className="ik2-hode">
            <h2 className="ik2-tittel">Rediger rutinen</h2>
          </header>
          <RutineSkjema
            utkast={utkast}
            setUtkast={setUtkast}
            jobber={jobber}
            kanLagre={endret && !!utkast.tittel.trim()}
            lagreTekst="Lagre"
            lagrerTekst="Lagrer …"
            tagger={tagger}
            onNyTag={async navn => { const id = await opprettIk2Tag(navn); await etterEndring(); return id }}
            onLagre={() => void kjor(async () => {
              await endreIk2('ik2_rutiner', rutine.id, {
                tittel: utkast.tittel.trim(),
                innhold: utkast.innhold.trim() || null,
              })
              await settRutineTagger(rutine.id, utkast.tagIds)
              setRedigerer(false)
            })}
            onAvbryt={() => setRedigerer(false)}
          />
        </>
      ) : (
        <>
          <header className="ik2-hode">
            <h2 className="ik2-tittel valgbar">{rutine.tittel}</h2>
            <p className="ik2-underlinje">
              <Tagger tagger={rutine.tagger} />
              <span>{i >= 0 ? `Rutine ${i + 1} av ${punkt.rutiner.length}` : ''}</span>
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

          {forrige || neste ? (
            <nav className="ik2-bla">
              {forrige ? (
                <button className="ik2-bla-knapp" onClick={() => gaa(kapittel.id, punkt.id, forrige.id)}>
                  <span className="ik2-bla-etikett"><ChevronLeft size={13} strokeWidth={2} />Forrige</span>
                  <span className="ik2-bla-tittel">{forrige.tittel}</span>
                </button>
              ) : <span />}
              {neste ? (
                <button className="ik2-bla-knapp ik2-bla-neste" onClick={() => gaa(kapittel.id, punkt.id, neste.id)}>
                  <span className="ik2-bla-etikett">Neste<ChevronRight size={13} strokeWidth={2} /></span>
                  <span className="ik2-bla-tittel">{neste.tittel}</span>
                </button>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}

/* ── Avvik ────────────────────────────────────────────────────────────── */

function Alvor({ grad }: { grad: Alvorlighet }) {
  return <span className={`ik2-alvor ik2-alvor-${grad}`}>{ALVORLIGHET_NAVN[grad]}</span>
}

function navnPaa(ansatte: Ansatt[], id: string | null): string {
  return ansatte.find(a => a.id === id)?.full_name ?? 'Ukjent'
}

const IDAG = () => new Date().toISOString().slice(0, 10)

/**
 * Avvikslista. Åpne først, det farligste øverst; lukkede bak ett trykk.
 * «Meld avvik» er ett skjema med tittel og alvorlighet — resten er valgfritt,
 * for det som teller er at det blir meldt.
 */
function AvvikSide({ avvik, ansatte, naa, kanSkrive, etterEndring }: {
  avvik: Avvik[]
  ansatte: Ansatt[]
  naa: Date
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [ny, setNy] = useState<{ tittel: string; alvorlighet: Alvorlighet; sted: string; frist: string; beskrivelse: string } | null>(null)
  const apne = avvik.filter(a => a.status === 'apent')
  const lukkede = avvik.filter(a => a.status === 'lukket')

  function fristTekst(a: Avvik): string {
    if (!a.frist_at) return `Meldt ${dato(a.funnet_at)}`
    const d = dagerTil(a.frist_at.slice(0, 10), naa)
    if (d < 0) return `Frist passert ${dato(a.frist_at)}`
    if (d === 0) return 'Frist i dag'
    return `Frist ${dato(a.frist_at)}`
  }

  return (
    <>
      <Sti ledd={[{ navn: 'Kapitler', til: [] }]} />
      <header className="ik2-hode">
        <h2 className="ik2-tittel">Avvik</h2>
        <p className="ik2-underlinje">
          {apne.length === 0 ? 'Ingen åpne avvik.' : `${stk(apne.length, 'åpent avvik', 'åpne avvik')}.`}
          {' '}Meldes her eller fra appen, lukkes med et tiltak.
        </p>
      </header>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <section className="ik2-avsnitt">
        <div className="ik2-avsnitt-hode">
          <span className="ik2-etikett">Åpne</span>
          {kanSkrive && !ny ? (
            <button className="ik2-lenke" onClick={() => setNy({ tittel: '', alvorlighet: 'middels', sted: '', frist: '', beskrivelse: '' })}>
              <Plus size={14} strokeWidth={2} />Meld avvik
            </button>
          ) : null}
        </div>

        {ny ? (
          <form
            className="seksjon seksjon-redigerer"
            onSubmit={ev => {
              ev.preventDefault()
              if (!ny.tittel.trim() || jobber) return
              void kjor(async () => {
                const id = await meldAvvik({ tittel: ny.tittel, alvorlighet: ny.alvorlighet, sted: ny.sted, frist: ny.frist ? `${ny.frist}T12:00:00Z` : null, beskrivelse: ny.beskrivelse })
                setNy(null)
                gaa('avvik', id)
              })
            }}
          >
            <div className="stabel" style={{ gap: 14 }}>
              <Felt firkant autoFocus etikett="Hva er galt?" value={ny.tittel} placeholder="Manglende jordfeilbryter på kurs 12"
                onChange={e => setNy(v => (v ? { ...v, tittel: e.target.value } : v))} />
              <div className="rad" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
                <label className="felt felt-firkant" style={{ width: 160 }}>
                  <span className="felt-etikett">Alvorlighet</span>
                  <select className="velger" value={ny.alvorlighet} onChange={e => setNy(v => (v ? { ...v, alvorlighet: e.target.value as Alvorlighet } : v))}>
                    {ALVORLIGHET.map(a => <option key={a.verdi} value={a.verdi}>{a.navn}</option>)}
                  </select>
                </label>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Felt firkant etikett="Hvor" value={ny.sted} placeholder="Ordre, adresse eller rom"
                    onChange={e => setNy(v => (v ? { ...v, sted: e.target.value } : v))} />
                </div>
                <div style={{ width: 170 }}>
                  <Felt firkant etikett="Frist" type="date" value={ny.frist}
                    onChange={e => setNy(v => (v ? { ...v, frist: e.target.value } : v))} />
                </div>
              </div>
              <label className="felt felt-firkant">
                <span className="felt-etikett">Beskrivelse</span>
                <textarea className="felt-inn skrivefelt skrivefelt-lav" rows={4} value={ny.beskrivelse}
                  placeholder="Hva ble funnet, og hvordan."
                  onChange={e => setNy(v => (v ? { ...v, beskrivelse: e.target.value } : v))} />
              </label>
              <div className="rad">
                <Knapp stil="merke" type="submit" disabled={!ny.tittel.trim() || jobber}>{jobber ? 'Melder …' : 'Meld avviket'}</Knapp>
                <Knapp stil="naken" type="button" disabled={jobber} onClick={() => setNy(null)}>Avbryt</Knapp>
              </div>
            </div>
          </form>
        ) : null}

        {apne.length === 0 && !ny ? (
          <div className="ik2-tom"><p>Ingen åpne avvik. Det er bra — så lenge det er sant.</p></div>
        ) : apne.map(a => (
          <Rad
            key={a.id}
            tittel={a.tittel}
            under={[a.sted, fristTekst(a)].filter(Boolean).join(' · ')}
            hoyre={<Alvor grad={a.alvorlighet} />}
            onClick={() => gaa('avvik', a.id)}
          />
        ))}
      </section>

      {lukkede.length > 0 ? (
        <details className="ik2-mer">
          <summary>Lukkede<span className="ik2-rad-mer">{antall(lukkede.length)}</span></summary>
          <div className="ik2-avsnitt">
            {lukkede.map(a => (
              <Rad
                key={a.id}
                tittel={a.tittel}
                under={`Lukket ${dato(a.lukket_at)} av ${navnPaa(ansatte, a.lukket_av)}`}
                onClick={() => gaa('avvik', a.id)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  )
}

function AvvikDetalj({ avvik, ansatte, kanSkrive, etterEndring }: {
  avvik: Avvik
  ansatte: Ansatt[]
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [tiltak, setTiltak] = useState('')
  const [redigerer, setRedigerer] = useState(false)
  const [utkast, setUtkast] = useState({ tittel: avvik.tittel, alvorlighet: avvik.alvorlighet, sted: avvik.sted ?? '', beskrivelse: avvik.beskrivelse ?? '', frist: avvik.frist_at?.slice(0, 10) ?? '' })
  const apent = avvik.status === 'apent'

  return (
    <>
      <Sti ledd={[{ navn: 'Kapitler', til: [] }, { navn: 'Avvik', til: ['avvik'] }]} />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {redigerer ? (
        <>
        <header className="ik2-hode"><h2 className="ik2-tittel">Rediger avviket</h2></header>
        <div className="seksjon seksjon-redigerer">
          <div className="stabel" style={{ gap: 14 }}>
            <Felt firkant etikett="Hva er galt?" value={utkast.tittel} onChange={e => setUtkast(u => ({ ...u, tittel: e.target.value }))} />
            <div className="rad" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
              <label className="felt felt-firkant" style={{ width: 160 }}>
                <span className="felt-etikett">Alvorlighet</span>
                <select className="velger" value={utkast.alvorlighet} onChange={e => setUtkast(u => ({ ...u, alvorlighet: e.target.value as Alvorlighet }))}>
                  {ALVORLIGHET.map(a => <option key={a.verdi} value={a.verdi}>{a.navn}</option>)}
                </select>
              </label>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Felt firkant etikett="Hvor" value={utkast.sted} onChange={e => setUtkast(u => ({ ...u, sted: e.target.value }))} />
              </div>
              <div style={{ width: 170 }}>
                <Felt firkant etikett="Frist" type="date" value={utkast.frist} onChange={e => setUtkast(u => ({ ...u, frist: e.target.value }))} />
              </div>
            </div>
            <label className="felt felt-firkant">
              <span className="felt-etikett">Beskrivelse</span>
              <textarea className="felt-inn skrivefelt skrivefelt-lav" rows={5} value={utkast.beskrivelse} onChange={e => setUtkast(u => ({ ...u, beskrivelse: e.target.value }))} />
            </label>
            <div className="rad">
              <Knapp stil="merke" disabled={!utkast.tittel.trim() || jobber} onClick={() => void kjor(async () => {
                await endreAvvik(avvik.id, { tittel: utkast.tittel.trim(), alvorlighet: utkast.alvorlighet, sted: utkast.sted.trim() || null, beskrivelse: utkast.beskrivelse.trim() || null, frist_at: utkast.frist ? `${utkast.frist}T12:00:00Z` : null })
                setRedigerer(false)
              })}>{jobber ? 'Lagrer …' : 'Lagre'}</Knapp>
              <Knapp stil="naken" disabled={jobber} onClick={() => setRedigerer(false)}>Avbryt</Knapp>
            </div>
          </div>
        </div>
        </>
      ) : (
        <>
          <header className="ik2-hode">
            <h2 className="ik2-tittel valgbar">{avvik.tittel}</h2>
            <p className="ik2-underlinje">
              <Alvor grad={avvik.alvorlighet} />
              {apent ? <Merke stil="varsel">Åpent</Merke> : <Merke stil="ny">Lukket {dato(avvik.lukket_at)}</Merke>}
              <span>Meldt {dato(avvik.funnet_at)} av {navnPaa(ansatte, avvik.funnet_av)}</span>
              {avvik.sted ? <span>· {avvik.sted}</span> : null}
              {avvik.frist_at ? <span>· Frist {dato(avvik.frist_at)}</span> : null}
            </p>
          </header>

          {avvik.beskrivelse ? <p className="ik2-tekst valgbar">{avvik.beskrivelse}</p> : <p className="ik2-tom-tekst">Ingen beskrivelse.</p>}

          {avvik.tiltak ? (
            <section className="ik2-avsnitt" style={{ marginTop: 18 }}>
              <div className="ik2-avsnitt-hode"><span className="ik2-etikett">Tiltak</span></div>
              <p className="ik2-tekst valgbar">{avvik.tiltak}</p>
              {!apent ? <p className="felt-hjelp" style={{ marginTop: 6 }}>Lukket {dato(avvik.lukket_at)} av {navnPaa(ansatte, avvik.lukket_av)}.</p> : null}
            </section>
          ) : null}

          {kanSkrive && apent ? (
            <section className="ik2-avsnitt" style={{ marginTop: 18 }}>
              <div className="ik2-avsnitt-hode"><span className="ik2-etikett">Lukk avviket</span></div>
              <label className="felt felt-firkant">
                <span className="felt-etikett">Hva ble gjort?</span>
                <textarea className="felt-inn skrivefelt skrivefelt-lav" rows={4} value={tiltak}
                  placeholder="Jordfeilbryter montert og funksjonstestet 17.09."
                  onChange={e => setTiltak(e.target.value)} />
                <span className="felt-hjelp">Påkrevd. Et avvik uten tiltak er ikke lukket, det er glemt.</span>
              </label>
              <div className="rad" style={{ marginTop: 12 }}>
                <Knapp stil="primar" disabled={!tiltak.trim() || jobber} onClick={() => void kjor(() => lukkAvvik(avvik.id, tiltak))}>
                  {jobber ? 'Lukker …' : 'Lukk avviket'}
                </Knapp>
              </div>
            </section>
          ) : null}

          {kanSkrive ? (
            <div className="ik2-bunn">
              {apent ? (
                <Knapp stil="stille" onClick={() => { setUtkast({ tittel: avvik.tittel, alvorlighet: avvik.alvorlighet, sted: avvik.sted ?? '', beskrivelse: avvik.beskrivelse ?? '', frist: avvik.frist_at?.slice(0, 10) ?? '' }); setRedigerer(true) }}>
                  <Pencil size={14} strokeWidth={2} />Rediger
                </Knapp>
              ) : (
                <Knapp stil="stille" disabled={jobber} onClick={() => void kjor(() => gjenapneAvvik(avvik.id))}>Gjenåpne</Knapp>
              )}
              <Slett hva="Slett avviket" sporsmal="Slette avviket? Bruk lukking om det er rettet." jobber={jobber}
                slett={() => void kjor(async () => { await slettAvvik(avvik.id); gaa('avvik') })} />
            </div>
          ) : null}
        </>
      )}
    </>
  )
}

/* ── Opplæring ────────────────────────────────────────────────────────── */

function GyldigMerke({ g, naa }: { g: { status: Gyldighet; rad: Kompetanse | null }; naa: Date }) {
  const til = g.rad?.gyldig_til
  const tekst =
    g.status === 'mangler' ? 'Mangler'
    : g.status === 'utgatt' ? `Utgått ${til ? dato(til) : ''}`
    : g.status === 'utgaar' ? `Går ut om ${stk(dagerTil(til!, naa), 'dag', 'dager')}`
    : til ? `Til ${dato(til)}` : `Tatt ${g.rad ? dato(g.rad.dato) : ''}`
  return <span className={`ik2-gyldig ik2-gyldig-${g.status}`}>{tekst}</span>
}

/** Registeret som tabell: én rad per ansatt, FSE og førstehjelp som kolonner. */
function OpplaeringSide({ ansatte, kompetanse, naa }: {
  ansatte: Ansatt[]
  kompetanse: Kompetanse[]
  naa: Date
}) {
  const fse = fseOppsummering(ansatte, kompetanse, naa)
  const sortert = [...ansatte].sort((a, b) => a.full_name.localeCompare(b.full_name, 'nb'))
  return (
    <>
      <Sti ledd={[{ navn: 'Kapitler', til: [] }]} />
      <header className="ik2-hode">
        <h2 className="ik2-tittel">Opplæring</h2>
        <p className="ik2-underlinje">
          {fse.totalt === 0 ? 'Ingen ansatte registrert.' : `${fse.gyldige} av ${fse.totalt} har gyldig FSE.`}
          {' '}FSE og førstehjelp går ut etter ett år. Trykk på en person for å registrere kurs.
        </p>
      </header>

      {sortert.length === 0 ? (
        <div className="ik2-tom"><p>Ansatte legges til under Firma.</p></div>
      ) : (
        <div className="ik2-tabell" role="table">
          <div className="ik2-tabell-hode" role="row">
            <span>Navn</span><span>FSE</span><span>Førstehjelp</span><span>Annet</span><span />
          </div>
          {sortert.map(a => {
            const andre = kompetanse.filter(k => k.user_id === a.id && k.type !== 'fse' && k.type !== 'forstehjelp').length
            return (
              <button key={a.id} className="ik2-tabell-rad" role="row" onClick={() => gaa('opplaering', a.id)}>
                <span className="ik2-tabell-navn">{a.full_name}</span>
                <span><GyldigMerke g={gyldighet(kompetanse, a.id, 'fse', naa)} naa={naa} /></span>
                <span><GyldigMerke g={gyldighet(kompetanse, a.id, 'forstehjelp', naa)} naa={naa} /></span>
                <span className="ik2-rad-mer">{andre === 0 ? '–' : stk(andre, 'kurs', 'kurs')}</span>
                <ChevronRight size={16} strokeWidth={2} className="ik2-rad-pil" />
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

function AnsattSide({ ansatt, kompetanse, naa, kanSkrive, etterEndring }: {
  ansatt: Ansatt
  kompetanse: Kompetanse[]
  naa: Date
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [ny, setNy] = useState<{ type: KompetanseType; tittel: string; dato: string; gyldig_til: string; notat: string } | null>(null)

  function velgType(type: KompetanseType) {
    const def = KOMPETANSE_TYPER.find(t => t.verdi === type)!
    setNy(v => {
      if (!v) return v
      const dato = v.dato || IDAG()
      return { ...v, type, tittel: KOMPETANSE_TYPER.some(t => t.navn === v.tittel) || !v.tittel ? def.navn : v.tittel, gyldig_til: def.varighetMnd ? plussMaaneder(dato, def.varighetMnd) : '' }
    })
  }

  const sortert = [...kompetanse].sort((a, b) => b.dato.localeCompare(a.dato))

  return (
    <>
      <Sti ledd={[{ navn: 'Kapitler', til: [] }, { navn: 'Opplæring', til: ['opplaering'] }]} />
      <header className="ik2-hode">
        <h2 className="ik2-tittel">{ansatt.full_name}</h2>
        <p className="ik2-underlinje">
          <span>FSE: <GyldigMerke g={gyldighet(kompetanse, ansatt.id, 'fse', naa)} naa={naa} /></span>
          <span>Førstehjelp: <GyldigMerke g={gyldighet(kompetanse, ansatt.id, 'forstehjelp', naa)} naa={naa} /></span>
        </p>
      </header>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <section className="ik2-avsnitt">
        <div className="ik2-avsnitt-hode">
          <span className="ik2-etikett">Kurs og sertifikater</span>
          {kanSkrive && !ny ? (
            <button className="ik2-lenke" onClick={() => setNy({ type: 'fse', tittel: 'FSE', dato: IDAG(), gyldig_til: plussMaaneder(IDAG(), 12), notat: '' })}>
              <Plus size={14} strokeWidth={2} />Registrer kurs
            </button>
          ) : null}
        </div>

        {ny ? (
          <form
            className="seksjon seksjon-redigerer"
            onSubmit={ev => {
              ev.preventDefault()
              if (!ny.tittel.trim() || !ny.dato || jobber) return
              void kjor(async () => {
                await nyKompetanse({ user_id: ansatt.id, type: ny.type, tittel: ny.tittel, dato: ny.dato, gyldig_til: ny.gyldig_til || null, notat: ny.notat })
                setNy(null)
              })
            }}
          >
            <div className="stabel" style={{ gap: 14 }}>
              <div className="rad" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
                <label className="felt felt-firkant" style={{ width: 160 }}>
                  <span className="felt-etikett">Type</span>
                  <select className="velger" value={ny.type} onChange={e => velgType(e.target.value as KompetanseType)}>
                    {KOMPETANSE_TYPER.map(t => <option key={t.verdi} value={t.verdi}>{t.navn}</option>)}
                  </select>
                </label>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Felt firkant autoFocus etikett="Kurs" value={ny.tittel} placeholder="FSE med førstehjelp, Trainor"
                    onChange={e => setNy(v => (v ? { ...v, tittel: e.target.value } : v))} />
                </div>
              </div>
              <div className="rad" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ width: 170 }}>
                  <Felt firkant etikett="Dato" type="date" value={ny.dato}
                    onChange={e => {
                      const d = e.target.value
                      const def = KOMPETANSE_TYPER.find(t => t.verdi === ny.type)!
                      setNy(v => (v ? { ...v, dato: d, gyldig_til: def.varighetMnd && d ? plussMaaneder(d, def.varighetMnd) : v.gyldig_til } : v))
                    }} />
                </div>
                <div style={{ width: 170 }}>
                  <Felt firkant etikett="Gyldig til" type="date" value={ny.gyldig_til} hjelp="Tomt = går ikke ut"
                    onChange={e => setNy(v => (v ? { ...v, gyldig_til: e.target.value } : v))} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Felt firkant etikett="Notat" value={ny.notat} placeholder="Kursholder, kursbevis"
                    onChange={e => setNy(v => (v ? { ...v, notat: e.target.value } : v))} />
                </div>
              </div>
              <div className="rad">
                <Knapp stil="merke" type="submit" disabled={!ny.tittel.trim() || !ny.dato || jobber}>{jobber ? 'Lagrer …' : 'Registrer'}</Knapp>
                <Knapp stil="naken" type="button" disabled={jobber} onClick={() => setNy(null)}>Avbryt</Knapp>
              </div>
            </div>
          </form>
        ) : null}

        {sortert.length === 0 && !ny ? (
          <div className="ik2-tom"><p>Ingen kurs registrert.</p></div>
        ) : sortert.map(k => {
          const status = k.gyldig_til ? (dagerTil(k.gyldig_til, naa) < 0 ? 'utgatt' : dagerTil(k.gyldig_til, naa) <= 60 ? 'utgaar' : 'gyldig') : 'gyldig'
          return (
            <div key={k.id} className="ik2-rad ik2-rad-stille">
              <span className="ik2-rad-tekst">
                <span className="ik2-rad-tittel">{k.tittel}</span>
                <span className="ik2-rad-under">{KOMPETANSE_NAVN[k.type]} · {dato(k.dato)}{k.notat ? ` · ${k.notat}` : ''}</span>
              </span>
              <span className={`ik2-gyldig ik2-gyldig-${status}`}>{k.gyldig_til ? `${status === 'utgatt' ? 'Utgått' : 'Til'} ${dato(k.gyldig_til)}` : 'Går ikke ut'}</span>
              {kanSkrive ? (
                <Slett hva="" sporsmal="Slette?" jobber={jobber} slett={() => void kjor(() => slettKompetanse(k.id))} />
              ) : null}
            </div>
          )
        })}
      </section>
    </>
  )
}

/* ── Tagger ───────────────────────────────────────────────────────────── */

function sammeSett(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sb = new Set(b)
  return a.every(x => sb.has(x))
}

/** Taggene på en rutine, som små piller. Ingenting når det ikke er noen. */
function Tagger({ tagger }: { tagger: Ik2Tag[] }) {
  if (tagger.length === 0) return null
  return (
    <span className="ik2-tagliste">
      {tagger.map(t => <span key={t.id} className="ik2-tag">{t.navn}</span>)}
    </span>
  )
}

/**
 * Velg tagger fra registeret — trykk for å slå av og på — og lag en ny rett
 * her om den mangler. Den nye blir valgt med én gang.
 */
function Tagvelger({ tagger, valgt, onEndre, onNyTag, jobber }: {
  tagger: Ik2Tag[]
  valgt: string[]
  onEndre: (ids: string[]) => void
  onNyTag: (navn: string) => Promise<string>
  jobber: boolean
}) {
  const [ny, setNy] = useState('')
  const [lager, setLager] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)

  async function leggTil() {
    const navn = ny.trim()
    if (!navn || lager) return
    // Finnes den alt, velges den — ingen «finnes alt»-feil for en tagg man bare glemte å trykke på.
    const eksisterende = tagger.find(t => t.navn.toLowerCase() === navn.toLowerCase())
    if (eksisterende) {
      if (!valgt.includes(eksisterende.id)) onEndre([...valgt, eksisterende.id])
      setNy('')
      return
    }
    setLager(true)
    setFeil(null)
    try {
      const id = await onNyTag(navn)
      onEndre([...valgt, id])
      setNy('')
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setLager(false)
    }
  }

  return (
    <div className="ik2-tagvelger">
      <div className="filter">
        {tagger.map(t => (
          <button
            key={t.id}
            type="button"
            className="filter-knapp"
            aria-pressed={valgt.includes(t.id)}
            disabled={jobber}
            onClick={() => onEndre(valgt.includes(t.id) ? valgt.filter(x => x !== t.id) : [...valgt, t.id])}
          >
            {t.navn}
          </button>
        ))}
        <input
          className="celle-inn ik2-nytag"
          placeholder={tagger.length === 0 ? 'Ny tagg — f.eks. HMS' : 'Ny tagg …'}
          value={ny}
          disabled={jobber || lager}
          onChange={e => setNy(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void leggTil() } }}
        />
        {ny.trim() ? (
          <button type="button" className="knapp knapp-stille" style={{ height: 28, padding: '0 10px' }} disabled={lager} onClick={() => void leggTil()}>
            {lager ? 'Lager …' : 'Legg til'}
          </button>
        ) : null}
      </div>
      {feil ? <span className="felt-hjelp" style={{ color: 'var(--rod)' }}>{feil}</span> : null}
    </div>
  )
}

/** Registeret: lag, døp om, slett. Tallet sier hvor mange rutiner som mister taggen om du sletter den. */
function TaggerSide({ tagger, punkter, kanSkrive, etterEndring }: {
  tagger: Ik2Tag[]
  punkter: Map<string, Ik2Punkt[]>
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const { jobber, feil, kjor } = useKjor(etterEndring)
  const [ny, setNy] = useState('')

  const telling = useMemo(() => {
    const t = new Map<string, number>()
    for (const liste of punkter.values()) {
      for (const p of liste) for (const r of p.rutiner) for (const tag of r.tagger) t.set(tag.id, (t.get(tag.id) ?? 0) + 1)
    }
    return t
  }, [punkter])

  return (
    <>
      <Sti ledd={[{ navn: 'Kapitler', til: [] }]} />
      <header className="ik2-hode">
        <h2 className="ik2-tittel">Tagger</h2>
        <p className="ik2-underlinje">Lag taggen én gang, sett den på rutinene, filtrer på den. Døper du den om, følger alle rutinene med.</p>
      </header>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {kanSkrive ? (
        <form
          className="rad"
          style={{ gap: 8, marginBottom: 16 }}
          onSubmit={ev => {
            ev.preventDefault()
            const navn = ny.trim()
            if (!navn) return
            void kjor(async () => { await opprettIk2Tag(navn); setNy('') })
          }}
        >
          <div style={{ flex: 1, maxWidth: 320 }}>
            <Felt firkant placeholder="Ny tagg — f.eks. HMS, FSE, Måling" value={ny} onChange={e => setNy(e.target.value)} />
          </div>
          <Knapp stil="merke" type="submit" disabled={!ny.trim() || jobber}>{jobber ? 'Lagrer …' : 'Legg til'}</Knapp>
        </form>
      ) : null}

      <section className="ik2-avsnitt">
        {tagger.length === 0 ? (
          <div className="ik2-tom"><p>Ingen tagger ennå.</p></div>
        ) : tagger.map(t => (
          <div key={t.id} className="ik2-tagrad">
            <input
              className="celle-inn"
              key={`${t.id}-${t.navn}`}
              defaultValue={t.navn}
              disabled={!kanSkrive || jobber}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== t.navn) void kjor(() => endreIk2Tag(t.id, v)) }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
            <span className="ik2-rad-mer">{stk(telling.get(t.id) ?? 0, 'rutine', 'rutiner')}</span>
            {kanSkrive ? (
              <button
                className="ikonknapp"
                title="Slett taggen"
                disabled={jobber}
                onClick={() => {
                  const n = telling.get(t.id) ?? 0
                  if (window.confirm(n > 0 ? `Slette «${t.navn}»? Den tas av ${stk(n, 'rutine', 'rutiner')}.` : `Slette «${t.navn}»?`)) {
                    void kjor(() => slettIk2Tag(t.id))
                  }
                }}
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            ) : null}
          </div>
        ))}
      </section>
    </>
  )
}
