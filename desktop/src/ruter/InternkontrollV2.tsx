import { erForfalt, fullstendighet, IK_GRUPPENAVN, IK_SKJELETT, nesteGjennomgang } from '@delt/ik/skjelett'
import { kan } from '@delt/kontor-tilgang'
import { CircleCheck, CircleDashed, FileText, Pencil, Plus, TriangleAlert, Trash2, Unlink, X } from 'lucide-react'
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
 * Internkontroll v2 — PRØVEFLATE ved siden av den som virker.
 *
 * Tre nivåer, og de heter det samme overalt på flata:
 *
 *   Kapittel   de fjorten fra forskriften (`ik_punkter`, delt med v1)
 *     └ Punkt  firmaets egen inndeling: «Arbeid i tavle», «Arbeid i høyden»
 *         └ Rutine  teksten, med én tagg: «HMS», «AUS», «tavle»
 *
 * **Venstre er hele systemet som ett tre.** Kapitler, punkter og rutiner står
 * synlig under hverandre, ikke bare kapittelnavn med et tall bak. Det er
 * oversikten: faglig ansvarlig skal kunne se på ett blikk hva som finnes, hva
 * som mangler og hvor «AUS» står. Søket og tagg-chipsene skjærer treet ned
 * til treffene, med veien ned til hvert treff beholdt.
 *
 * **Høyre er kapittelet som ett dokument.** Formålet, så punktene som
 * overskrifter, så rutinene med teksten synlig — ingen piler å åpne. Én
 * statuslinje øverst sier om det er vedtatt, når det skal gjennomgås og hvem
 * som har lest det. Skjemaer, lesebekreftelse og historikk står nederst;
 * de er viktige, men de er ikke det man kom for å lese.
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

/**
 * Hva som traff filteret. `null` = ingen filter, alt vises.
 *
 * Rutinen treffer når taggen stemmer OG alle søkeordene finnes i tittel,
 * tekst eller tagg. Punktet treffer når en rutine under det traff, eller når
 * punktets egen tittel traff (da vises alle rutinene under det, fordi det er
 * punktet man lette etter). Kapittelet treffer når et punkt under det traff,
 * eller kapittelets tittel gjør det.
 */
type Treff = { rutiner: Set<string>; punkter: Set<string>; kapitler: Set<string> }

function finnTreff(
  kapitler: IkPunkt[],
  perKapittel: Map<string, Ik2Punkt[]>,
  sok: string,
  tag: string | null,
): Treff | null {
  const ord = sok.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (ord.length === 0 && !tag) return null
  const har = (tekst: string) => {
    const t = tekst.toLowerCase()
    return ord.every(o => t.includes(o))
  }
  const treff: Treff = { rutiner: new Set(), punkter: new Set(), kapitler: new Set() }
  for (const kap of kapitler) {
    let kapTreff = !tag && ord.length > 0 && har(`${kap.nummer} ${kap.tittel}`)
    for (const punkt of perKapittel.get(kap.id) ?? []) {
      const tittelTreff = !tag && ord.length > 0 && har(punkt.tittel)
      let punktTreff = tittelTreff
      for (const r of punkt.rutiner) {
        const tagOk = !tag || r.tag === tag
        const tekstOk = ord.length === 0 || har(`${r.tittel} ${r.innhold ?? ''} ${r.tag ?? ''}`)
        if (tagOk && (tekstOk || tittelTreff)) {
          treff.rutiner.add(r.id)
          punktTreff = true
        }
      }
      if (punktTreff) {
        treff.punkter.add(punkt.id)
        kapTreff = true
      }
    }
    if (kapTreff) treff.kapitler.add(kap.id)
  }
  return treff
}

/** Punktene og rutinene som skal vises for et kapittel, gitt filteret. */
type Utsnitt = { punkt: Ik2Punkt; rutiner: Ik2Rutine[] }[]

function utsnittFor(alle: Ik2Punkt[], treff: Treff | null): Utsnitt {
  if (!treff) return alle.map(punkt => ({ punkt, rutiner: punkt.rutiner }))
  const traff = alle.filter(p => treff.punkter.has(p.id))
  // Traff bare kapittelets tittel, er det kapittelet man lette etter: alt vises.
  if (traff.length === 0) return alle.map(punkt => ({ punkt, rutiner: punkt.rutiner }))
  return traff.map(punkt => ({ punkt, rutiner: punkt.rutiner.filter(r => treff.rutiner.has(r.id)) }))
}

export function InternkontrollV2() {
  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'ik.skriv')

  const [kapitler, setKapitler] = useState<IkPunkt[]>([])
  /** Punktene v2 legger til, per kapittel. Rutinene henger under dem. */
  const [punkter, setPunkter] = useState<Map<string, Ik2Punkt[]>>(new Map())
  const [koblinger, setKoblinger] = useState<Map<string, Skjemakobling[]>>(new Map())
  const [lesinger, setLesinger] = useState<Map<string, Lesing[]>>(new Map())
  const [maler, setMaler] = useState<Skjemamal[]>([])
  const [ansatte, setAnsatte] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [valgt, setValgt] = useState<string | null>(null)
  /** Punktet eller rutinen som ble klikket i treet: rulles fram og merkes i dokumentet. */
  const [fokus, setFokus] = useState<string | null>(null)
  const [sok, setSok] = useState('')
  const [tag, setTag] = useState<string | null>(null)
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
    (id: string) => (punkter.get(id) ?? []).some(p => p.rutiner.some(r => r.innhold?.trim())),
    [punkter],
  )

  const status = useMemo(
    () => fullstendighet(kapitler.map(p => ({
      nummer: p.nummer,
      harRutine: harRutine(p.id),
      status: p.status,
      maaVaereSkriftlig: p.maaVaereSkriftlig,
    }))),
    [kapitler, harRutine],
  )
  const forfalte = kapitler.filter(p => erForfalt(p.sist_gjennomgatt, p.gjennomgang_intervall_mnd, naa))
  const medInnhold = kapitler.filter(p => harRutine(p.id)).length

  // Taggene med antall rutiner bak seg — chipsene i lista. Sortert etter
  // bruk, så den taggen firmaet faktisk bruker mest står først.
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
  const tagnavn = useMemo(() => taggene(punkter), [punkter])

  const treff = useMemo(() => finnTreff(kapitler, punkter, sok, tag), [kapitler, punkter, sok, tag])

  // Filteret kan gjøre det valgte kapittelet usynlig i treet. Da hopper valget
  // til det første som er synlig — ellers står dokumentet og viser noe treet
  // ikke lenger peker på.
  useEffect(() => {
    if (!treff || paaTelefon()) return
    if (valgt && treff.kapitler.has(valgt)) return
    const forste = kapitler.find(k => treff.kapitler.has(k.id))
    setValgt(forste?.id ?? null)
  }, [treff, valgt, kapitler])

  // De lovpålagte først og for seg. Resten følger skjelettets egne grupper, og
  // kapitler firmaet har lagt til selv havner sist under «Egne kapitler».
  const grupper = useMemo(() => {
    const ut: { navn: string; kapitler: IkPunkt[] }[] = []
    const legg = (navn: string, p: IkPunkt) => {
      const siste = ut[ut.length - 1]
      if (siste && siste.navn === navn) siste.kapitler.push(p)
      else ut.push({ navn, kapitler: [p] })
    }
    for (const p of kapitler) {
      if (treff && !treff.kapitler.has(p.id)) continue
      legg(p.maaVaereSkriftlig ? 'Lovpålagt skriftlig' : (GRUPPE_FOR[p.nummer] ?? 'Egne kapitler'), p)
    }
    return ut
  }, [kapitler, treff])
  const aktiv = kapitler.find(p => p.id === valgt) ?? null

  function nullstill() {
    setSok('')
    setTag(null)
  }

  function gaaTil(kapittelId: string, id: string | null) {
    setValgt(kapittelId)
    setFokus(id)
  }

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

  const antallRutiner = [...punkter.values()].reduce((n, liste) => n + liste.reduce((m, p) => m + p.rutiner.length, 0), 0)

  return (
    <>
      <Sidehode
        tittel="Internkontroll v2"
        under={`${status.pa_plass} av ${status.kreves} skriftlige krav vedtatt · ${medInnhold} av ${kapitler.length} kapitler har rutiner${forfalte.length > 0 ? ` · ${stk(forfalte.length, 'forfalt', 'forfalte')}` : ''}`}
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {/* Én forslagsliste for alle tagg-feltene på flata. */}
      <datalist id="ik2-tagger">
        {tagnavn.map(t => <option key={t} value={t} />)}
      </datalist>

      <div className="arbeidsflate">
        <Delt valgt={!!aktiv} tilbake={() => setValgt(null)}>
          <div className="liste ik2-tre">
            <div className="liste-verktoy">
              <Felt
                placeholder="Søk i kapitler, punkter og rutiner …"
                value={sok}
                onChange={e => setSok(e.target.value)}
              />
              {/* Taggene er filteret. Én tagg om gangen — «HMS» på tvers av
                  kapitlene er spørsmålet, ikke «HMS eller tavle». */}
              {tagger.length > 0 ? (
                <div className="filter" style={{ marginTop: 10 }}>
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
              <div className="ik2-status">
                <span className="dempet-mer" style={{ fontSize: 12 }}>
                  {laster
                    ? 'Henter …'
                    : treff
                      ? `${stk(treff.rutiner.size, 'rutine', 'rutiner')} i ${stk(treff.kapitler.size, 'kapittel', 'kapitler')}`
                      : `${stk(kapitler.length, 'kapittel', 'kapitler')} · ${stk(antallRutiner, 'rutine', 'rutiner')}`}
                </span>
                {treff ? (
                  <button className="ik2-nullstill" onClick={nullstill}>
                    <X size={12} strokeWidth={2.2} />
                    Nullstill
                  </button>
                ) : null}
              </div>
            </div>

            {/* Hele treet, alltid. Kapittel, punktene under, rutinene under
                dem. Det er dette som er oversikten; dokumentet til høyre er
                nærbildet. */}
            <div className="liste-kropp">
              {treff && grupper.length === 0 && !laster ? (
                <div className="tomt-mykt">
                  <p>Ingen treff{tag ? ` på «${tag}»` : ''}{sok.trim() ? ` for «${sok.trim()}»` : ''}.</p>
                </div>
              ) : null}
              {grupper.map(g => (
                <div key={g.navn}>
                  <div className="liste-gruppe">{g.navn}</div>
                  {g.kapitler.map(k => {
                    const forfalt = erForfalt(k.sist_gjennomgatt, k.gjennomgang_intervall_mnd, naa)
                    const utsnitt = utsnittFor(punkter.get(k.id) ?? [], treff)
                    const erValgt = k.id === valgt
                    return (
                      <div key={k.id} className="ik2-tre-kapittel" aria-selected={erValgt}>
                        <button className="ik2-tre-kap" onClick={() => gaaTil(k.id, null)}>
                          <span className="ik2-tre-nr">{k.nummer}</span>
                          <span className="ik2-tre-tittel">{k.tittel}</span>
                          {forfalt ? <TriangleAlert size={13} strokeWidth={2} style={{ color: 'var(--gul)', flex: 'none' }} /> : null}
                          {k.status === 'vedtatt'
                            ? <CircleCheck size={13} strokeWidth={2} style={{ color: 'var(--gronn)', flex: 'none' }} />
                            : <CircleDashed size={13} strokeWidth={2} style={{ color: 'var(--blekk-4)', flex: 'none' }} />}
                        </button>
                        {utsnitt.length === 0 ? (
                          <div className="ik2-tre-tom">Ingen punkter ennå</div>
                        ) : utsnitt.map(({ punkt, rutiner }) => (
                          <div key={punkt.id}>
                            <button
                              className="ik2-tre-punkt"
                              aria-current={fokus === punkt.id && erValgt}
                              onClick={() => gaaTil(k.id, punkt.id)}
                            >
                              <span className="ik2-tre-tittel">{punkt.tittel}</span>
                              {rutiner.length === 0 ? <span className="ik2-tre-tall">ingen rutiner</span> : null}
                            </button>
                            {rutiner.map(r => (
                              <button
                                key={r.id}
                                className="ik2-tre-rutine"
                                aria-current={fokus === r.id && erValgt}
                                onClick={() => gaaTil(k.id, r.id)}
                              >
                                <span className="ik2-tre-tittel" style={!r.innhold ? { color: 'var(--blekk-3)' } : undefined}>
                                  {r.tittel}
                                </span>
                                {r.tag ? <span className="ik2-tag">{r.tag}</span> : null}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="detalj">
            {!aktiv ? (
              <div className="tomt-mykt"><p>Velg et kapittel</p></div>
            ) : (
              <Kapittel
                key={aktiv.id}
                kapittel={aktiv}
                punkter={punkter.get(aktiv.id) ?? []}
                treff={treff}
                filtertekst={tag ? `«${tag}»` : sok.trim() ? `«${sok.trim()}»` : null}
                nullstill={nullstill}
                velgTag={t => { setTag(v => (v === t ? null : t)) }}
                fokus={fokus}
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
 * Tittel som redigeres der den står. Ett klikk, ingen dialog, lagres når
 * feltet forlates eller på Enter. Tom tittel lagres aldri — da faller den
 * tilbake til det som sto.
 */
function Tittel({ verdi, lagre, laast, klasse }: {
  verdi: string
  lagre: (v: string) => void
  laast: boolean
  klasse: string
}) {
  const [utkast, setUtkast] = useState(verdi)
  useEffect(() => { setUtkast(verdi) }, [verdi])

  if (laast) return <span className={klasse}>{verdi || 'Uten navn'}</span>

  return (
    <input
      className={`ik2-tittel-inn ${klasse}`}
      value={utkast}
      title="Klikk for å endre navnet"
      onChange={e => setUtkast(e.target.value)}
      onBlur={() => {
        const rene = utkast.trim()
        if (rene && rene !== verdi) lagre(rene)
        else setUtkast(verdi)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setUtkast(verdi); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}

/**
 * Sletting i to trykk, der knappen står. Ett trykk på søppelkurven sletter
 * ingenting; den byttes ut med spørsmålet og to svar. Et punkt tar rutinene
 * under seg med i samme slengen, og det skal ikke skje ved et uhell.
 */
function Slett({ sporsmal, tittel, jobber, slett }: {
  sporsmal: string
  tittel: string
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
    <button className="ikonknapp ik2-slett" title={tittel} disabled={jobber} onClick={() => setSpor(true)}>
      <Trash2 size={13} strokeWidth={2} />
    </button>
  )
}

/**
 * Et punkt i dokumentet: overskrift, så rutinene med teksten synlig.
 *
 * Punktet er firmaets egen inndeling av kapittelet. Tavle, høyden, AUS og
 * graving hver for seg, med sine egne rutiner under. Under filter vises bare
 * rutinene som traff; resten telles så man ser at de finnes.
 */
function Punkt({
  punkt,
  synlige,
  velgTag,
  fokus,
  kanSkrive,
  etterEndring,
}: {
  punkt: Ik2Punkt
  /** Rutinene som skal vises. Er lik `punkt.rutiner` uten filter. */
  synlige: Ik2Rutine[]
  velgTag: (tag: string) => void
  fokus: string | null
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  const [nyRutine, setNyRutine] = useState<{ tittel: string; tag: string } | null>(null)
  /** Rutinen som nettopp ble opprettet her: åpner i skrivemodus, én gang. */
  const [nyligOpprettet, setNyligOpprettet] = useState<string | null>(null)
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

  const skjult = punkt.rutiner.length - synlige.length

  return (
    <section id={`ik2-${punkt.id}`} className="ik2-punkt" data-fokus={fokus === punkt.id || undefined}>
      <div className="ik2-punkt-hode">
        <Tittel
          klasse="ik2-punkt-tittel"
          verdi={punkt.tittel}
          laast={!kanSkrive}
          lagre={v => void kjor(() => endreIk2('ik2_punkter', punkt.id, { tittel: v }))}
        />
        <span className="blokk-tall">
          {skjult > 0
            ? `${synlige.length} av ${stk(punkt.rutiner.length, 'rutine', 'rutiner')}`
            : punkt.rutiner.length === 0 ? '' : stk(punkt.rutiner.length, 'rutine', 'rutiner')}
        </span>
        {kanSkrive ? (
          <>
            <Knapp stil="stille" disabled={jobber} onClick={() => setNyRutine({ tittel: '', tag: '' })}>
              <Plus size={15} strokeWidth={1.9} />
              Ny rutine
            </Knapp>
            <Slett
              tittel="Slett punktet"
              sporsmal={punkt.rutiner.length > 0
                ? `Slette punktet og ${stk(punkt.rutiner.length, 'rutinen', 'rutinene')} under det?`
                : 'Slette punktet?'}
              jobber={jobber}
              slett={() => void kjor(() => slettIk2('punkt', punkt.id))}
            />
          </>
        ) : null}
      </div>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {nyRutine ? (
        <form
          className="seksjon seksjon-redigerer ik2-ny"
          onSubmit={ev => {
            ev.preventDefault()
            if (!nyRutine.tittel.trim() || jobber) return
            void kjor(async () => {
              const id = await opprettIk2Rutine(punkt.id, nyRutine.tittel, nyRutine.tag || null)
              setNyligOpprettet(id)
              setNyRutine(null)
            })
          }}
        >
          <Felt
            firkant
            autoFocus
            etikett="Hva heter rutinen?"
            value={nyRutine.tittel}
            placeholder="Kontroll før spenningssetting"
            onChange={e => setNyRutine(v => (v ? { ...v, tittel: e.target.value } : v))}
          />
          <div style={{ width: 180 }}>
            <Felt
              firkant
              etikett="Tagg"
              list="ik2-tagger"
              value={nyRutine.tag}
              placeholder="HMS, AUS, tavle …"
              onChange={e => setNyRutine(v => (v ? { ...v, tag: e.target.value } : v))}
            />
          </div>
          <div className="rad">
            <Knapp stil="merke" type="submit" disabled={!nyRutine.tittel.trim() || jobber}>
              {jobber ? 'Oppretter …' : 'Opprett'}
            </Knapp>
            <Knapp stil="naken" type="button" disabled={jobber} onClick={() => setNyRutine(null)}>Avbryt</Knapp>
          </div>
          <span className="felt-hjelp" style={{ flexBasis: '100%' }}>
            Teksten skriver du etterpå. Taggen gjør rutinen søkbar på tvers av kapitlene.
          </span>
        </form>
      ) : null}

      {punkt.rutiner.length === 0 ? (
        nyRutine ? null : <p className="ik2-tom-tekst">Ingen rutiner ennå.</p>
      ) : (
        <>
          {synlige.map(r => (
            <Rutine
              key={r.id}
              rutine={r}
              fokusert={fokus === r.id}
              startISkrivemodus={nyligOpprettet === r.id}
              velgTag={velgTag}
              kanSkrive={kanSkrive}
              etterEndring={etterEndring}
            />
          ))}
          {skjult > 0 ? (
            <p className="felt-hjelp">{stk(skjult, 'rutine', 'rutiner')} til skjult av filteret.</p>
          ) : null}
        </>
      )}
    </section>
  )
}

/**
 * Én rutine i dokumentet. Teksten står synlig — det er den man kom for.
 * Redigering er et eget valg med Lagre/Avbryt: et felt man kan skrive i uten
 * å ha bedt om det, er et felt man endrer noe i ved uhell.
 */
function Rutine({
  rutine,
  fokusert,
  startISkrivemodus,
  velgTag,
  kanSkrive,
  etterEndring,
}: {
  rutine: Ik2Rutine
  /** Klikket på i treet: rulles fram og merkes. */
  fokusert: boolean
  /** Nettopp opprettet: det neste man skal gjøre er å skrive den. */
  startISkrivemodus: boolean
  velgTag: (tag: string) => void
  kanSkrive: boolean
  etterEndring: () => Promise<void>
}) {
  // Bare den som nettopp ble opprettet åpner av seg selv. Fem uskrevne
  // rutiner skal være fem linjer med «Ikke skrevet ennå», ikke fem skjemaer.
  const [redigerer, setRedigerer] = useState(kanSkrive && startISkrivemodus)
  const [utkast, setUtkast] = useState({ tittel: rutine.tittel, tag: rutine.tag ?? '', innhold: rutine.innhold ?? '' })
  const [jobber, setJobber] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)

  function start() {
    setUtkast({ tittel: rutine.tittel, tag: rutine.tag ?? '', innhold: rutine.innhold ?? '' })
    setRedigerer(true)
  }

  const endret =
    utkast.tittel.trim() !== rutine.tittel ||
    (utkast.tag.trim() || null) !== rutine.tag ||
    (utkast.innhold.trim() || null) !== rutine.innhold

  async function lagre() {
    if (!utkast.tittel.trim()) return
    setJobber(true)
    setFeil(null)
    try {
      await endreIk2('ik2_rutiner', rutine.id, {
        tittel: utkast.tittel.trim(),
        tag: utkast.tag.trim() || null,
        innhold: utkast.innhold.trim() || null,
      })
      await etterEndring()
      setRedigerer(false)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(false)
    }
  }

  if (redigerer) {
    return (
      <div id={`ik2-${rutine.id}`} className="seksjon seksjon-redigerer ik2-rutine-red">
        <div className="stabel" style={{ gap: 12 }}>
          <div className="rad" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Felt
                firkant
                etikett="Rutine"
                autoFocus={!rutine.innhold}
                value={utkast.tittel}
                onChange={e => setUtkast(u => ({ ...u, tittel: e.target.value }))}
              />
            </div>
            <div style={{ width: 180 }}>
              <Felt
                firkant
                etikett="Tagg"
                list="ik2-tagger"
                value={utkast.tag}
                placeholder="HMS, AUS, tavle …"
                onChange={e => setUtkast(u => ({ ...u, tag: e.target.value }))}
              />
            </div>
          </div>
          <label className="felt felt-firkant">
            <span className="felt-etikett">Slik gjøres det</span>
            <textarea
              className="felt-inn skrivefelt"
              rows={8}
              autoFocus={!!rutine.innhold}
              value={utkast.innhold}
              placeholder="Hvem gjør hva, i hvilken rekkefølge, og hvordan vet man at det er gjort?"
              onChange={e => setUtkast(u => ({ ...u, innhold: e.target.value }))}
            />
          </label>
          {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
          <div className="rad">
            <Knapp stil="merke" disabled={!endret || !utkast.tittel.trim() || jobber} onClick={() => void lagre()}>
              {jobber ? 'Lagrer …' : 'Lagre'}
            </Knapp>
            <Knapp stil="naken" disabled={jobber} onClick={() => setRedigerer(false)}>Avbryt</Knapp>
            {kanSkrive ? (
              <span style={{ marginLeft: 'auto' }}>
                <Slett
                  tittel="Slett rutinen"
                  sporsmal="Slette rutinen?"
                  jobber={jobber}
                  slett={() => void slettIk2('rutine', rutine.id).then(etterEndring)}
                />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <article id={`ik2-${rutine.id}`} className="ik2-rutine" data-fokus={fokusert || undefined}>
      <div className="ik2-rutine-hode">
        <span className="ik2-rutine-tittel valgbar">{rutine.tittel}</span>
        {rutine.tag ? (
          <button className="ik2-tag" title={`Vis alt merket «${rutine.tag}»`} onClick={() => velgTag(rutine.tag!)}>
            {rutine.tag}
          </button>
        ) : null}
        {kanSkrive ? (
          <button className="ikonknapp ik2-slett" title="Rediger rutinen" onClick={start}>
            <Pencil size={13} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {rutine.innhold ? (
        <p className="ik2-rutine-tekst valgbar">{rutine.innhold}</p>
      ) : (
        <p className="ik2-tom-tekst">Ikke skrevet ennå.</p>
      )}
    </article>
  )
}

function Kapittel({
  kapittel,
  punkter,
  treff,
  filtertekst,
  nullstill,
  velgTag,
  fokus,
  skjemaer,
  lesinger,
  maler,
  ansatte,
  kanSkrive,
  naa,
  etterEndring,
}: {
  kapittel: IkPunkt
  punkter: Ik2Punkt[]
  treff: Treff | null
  filtertekst: string | null
  nullstill: () => void
  velgTag: (tag: string) => void
  fokus: string | null
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
    tittel: kapittel.tittel,
    hjemmel: kapittel.hjemmel,
    formal: kapittel.formal,
    innhold: kapittel.innhold,
    gjennomgang_intervall_mnd: kapittel.gjennomgang_intervall_mnd,
    ansvarlig: kapittel.ansvarlig,
  })
  const [notat, setNotat] = useState('')
  const [redigerer, setRedigerer] = useState(false)
  /** Tittelen på punktet som er i ferd med å opprettes. `null` = skjemaet er lukket. */
  const [nyttPunkt, setNyttPunkt] = useState<string | null>(null)
  const [jobber, setJobber] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const seAudit = kan(profil?.role, 'logg.les')

  // Klikk i treet: rull dokumentet til punktet eller rutinen. Etter at
  // dokumentet er tegnet — ellers ruller vi til noe som ikke finnes ennå.
  useEffect(() => {
    if (!fokus) return
    const t = window.setTimeout(() => {
      document.getElementById(`ik2-${fokus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 30)
    return () => window.clearTimeout(t)
  }, [fokus, treff])

  function start() {
    setUtkast({
      tittel: kapittel.tittel,
      hjemmel: kapittel.hjemmel,
      formal: kapittel.formal,
      innhold: kapittel.innhold,
      gjennomgang_intervall_mnd: kapittel.gjennomgang_intervall_mnd,
      ansvarlig: kapittel.ansvarlig,
    })
    setRedigerer(true)
  }

  /** Forkaster utkastet. Ingenting er skrevet, saa det er ingenting aa angre. */
  function avbryt() {
    setNotat('')
    setRedigerer(false)
  }

  // Stabile referanser: uten dem henter <Historikk> på nytt ved hver render.
  const hentRev = useCallback(() => hentRevisjoner(kapittel.id), [kapittel.id])
  const hentAud = useCallback(() => hentAuditFor('ik_punkter', kapittel.id), [kapittel.id])

  const endret =
    utkast.tittel !== kapittel.tittel ||
    (utkast.hjemmel ?? '') !== (kapittel.hjemmel ?? '') ||
    (utkast.formal ?? '') !== (kapittel.formal ?? '') ||
    utkast.gjennomgang_intervall_mnd !== kapittel.gjennomgang_intervall_mnd

  // Montør og lærling leser rutinene i appen, men de er DE som skal kjenne dem.
  // Alle med profil er derfor med i lista; det er ikke en kontorliste.
  const relevante = ansatte
  const harLest = lesinger.filter(l => l.versjon === kapittel.gjeldende_versjon)
  const jegHarLest = harLest.find(l => l.user_id === profil?.id)
  const knyttede = new Set(skjemaer.map(s => s.template_id))
  const ledige = maler.filter(m => !knyttede.has(m.id))

  // Et kapittel kan vedtas når minst én rutine under det har tekst. En tom
  // tittel er ikke en rutine.
  const harTekst = punkter.some(p => p.rutiner.some(r => r.innhold?.trim()))

  const forfalt = erForfalt(kapittel.sist_gjennomgatt, kapittel.gjennomgang_intervall_mnd, naa)
  const neste = nesteGjennomgang(kapittel.sist_gjennomgatt, kapittel.gjennomgang_intervall_mnd)

  const utsnitt = utsnittFor(punkter, treff)
  const filtrert = treff !== null && utsnitt.some(u => u.rutiner.length !== u.punkt.rutiner.length || utsnitt.length !== punkter.length)
  const antallRutiner = punkter.reduce((n, p) => n + p.rutiner.length, 0)
  const antallTreff = utsnitt.reduce((n, u) => n + u.rutiner.length, 0)

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
          <span className="hero-nr">Kapittel {kapittel.nummer}</span>
          {kapittel.maaVaereSkriftlig ? <Merke stil="endret">Lovpålagt skriftlig</Merke> : null}
        </div>
        <h1 className="hero-tittel valgbar">{kapittel.tittel}</h1>
        <div className="hero-linje">
          <span className="valgbar">{kapittel.hjemmel || 'Ingen hjemmel oppgitt'}</span>
          <span>Versjon {kapittel.gjeldende_versjon}</span>
        </div>
      </div>

      {/* Statuslinja: alt det administrative på én linje, med den ene
          handlingen til høyre. Det som før sto som en hel spalte ved siden av
          teksten, og gjorde at teksten fikk halve bredden. */}
      <div className="ik2-strip">
        {kapittel.status === 'vedtatt'
          ? <span className="ik2-strip-post"><CircleCheck size={14} strokeWidth={2} style={{ color: 'var(--gronn)' }} />Vedtatt {dato(kapittel.vedtatt_at)}</span>
          : <span className="ik2-strip-post"><CircleDashed size={14} strokeWidth={2} style={{ color: 'var(--blekk-3)' }} />Utkast, ikke vedtatt</span>}
        <span className="ik2-strip-post" style={forfalt ? { color: 'var(--gul)' } : undefined}>
          {forfalt ? <TriangleAlert size={14} strokeWidth={2} /> : null}
          {neste ? `Gjennomgås innen ${dato(neste)}` : `Gjennomgås hver ${kapittel.gjennomgang_intervall_mnd}. måned`}
        </span>
        {kapittel.status === 'vedtatt' ? (
          <span className="ik2-strip-post">Lest av {antall(harLest.length)} av {antall(relevante.length)}</span>
        ) : null}
        <span className="ik2-strip-post">{skjemaer.length === 0 ? 'Ingen skjemaer' : stk(skjemaer.length, 'skjema', 'skjemaer')}</span>
        {kanSkrive ? (
          <span className="ik2-strip-handling">
            {kapittel.status !== 'vedtatt' ? (
              <>
                {!harTekst ? <span className="felt-hjelp">Skriv minst én rutine først.</span> : null}
                {harTekst && redigerer ? <span className="felt-hjelp">Lagre eller avbryt redigeringen først.</span> : null}
                <Knapp
                  stil="primar"
                  disabled={!harTekst || redigerer || jobber != null}
                  onClick={() => kjor('vedta', () => vedta(kapittel.id, profil?.id ?? ''))}
                >
                  {jobber === 'vedta' ? 'Vedtar …' : 'Vedta kapittelet'}
                </Knapp>
              </>
            ) : (
              <Knapp
                stil="stille"
                disabled={jobber != null}
                onClick={() => kjor('kvitter', () => kvitterGjennomgang(kapittel.id))}
              >
                {jobber === 'kvitter' ? 'Registrerer …' : 'Gjennomgått i dag'}
              </Knapp>
            )}
          </span>
        ) : null}
      </div>

      <div className="detalj-kropp ik2-dok">
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

        {/* LESER eller SKRIVER — aldri tvil om hvilken av delene. */}
        {redigerer ? (
          <div className="seksjon seksjon-redigerer">
            <div className="seksjon-hode">
              <div className="seksjon-tittel">Redigerer kapittel {kapittel.nummer}</div>
              <Merke stil="endret">Blir versjon {kapittel.gjeldende_versjon + 1}</Merke>
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
                <span className="felt-hjelp">Hva kapittelet skal sikre. Endres sjelden.</span>
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
                    await lagreEndring(kapittel, utkast, notat, {
                      id: profil?.id ?? '',
                      navn: profil?.full_name ?? '',
                    })
                    setNotat('')
                    setRedigerer(false)
                  })}
                >
                  {jobber === 'lagre' ? 'Lagrer …' : `Lagre som versjon ${kapittel.gjeldende_versjon + 1}`}
                </Knapp>
                <Knapp stil="naken" onClick={avbryt} disabled={jobber != null}>
                  Avbryt
                </Knapp>
                {!endret ? <span className="felt-hjelp">Ingenting er endret ennå.</span> : null}
                {endret && !notat.trim() ? <span className="felt-hjelp">Skriv hva som ble endret.</span> : null}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Formålet. Tomt kapittel sier OPPRETT, ikke «rediger». Ampex
                skriver ikke formålet for firmaet — se lib/ik/skjelett.ts. */}
            <div className="ik2-formal">
              <div className="ik2-formal-hode">
                <span className="ik2-etikett">Formål</span>
                {kanSkrive ? (
                  <Knapp stil={kapittel.formal ? 'naken' : 'merke'} onClick={start}>
                    {kapittel.formal
                      ? <><Pencil size={14} strokeWidth={1.9} />Rediger</>
                      : <><Plus size={15} strokeWidth={1.9} />Opprett formål</>}
                  </Knapp>
                ) : null}
              </div>
              <p className="ik2-formal-tekst valgbar">
                {kapittel.formal || (kanSkrive
                  ? 'Ikke skrevet ennå. Skriv hva dette kapittelet skal sikre hos dere.'
                  : 'Ikke skrevet ennå.')}
              </p>
            </div>

            {/* Punktene. Kapittelet er forskriftens og skrevet generelt;
                punktene er firmaets egen inndeling, og rutinene henger
                ALLTID på et punkt. Det er hele forskjellen fra v1. */}
            <div className="ik2-punkter-hode">
              <span className="ik2-etikett">
                Punkter og rutiner
                {punkter.length > 0 ? <span className="blokk-tall" style={{ marginLeft: 10 }}>{stk(punkter.length, 'punkt', 'punkter')} · {stk(antallRutiner, 'rutine', 'rutiner')}</span> : null}
              </span>
              {kanSkrive ? (
                <Knapp stil={punkter.length === 0 ? 'merke' : 'stille'} onClick={() => setNyttPunkt('')}>
                  <Plus size={15} strokeWidth={1.9} />
                  Nytt punkt
                </Knapp>
              ) : null}
            </div>

            {treff && filtertekst && filtrert ? (
              <div className="ik2-filterlinje">
                <span>Viser {stk(antallTreff, 'rutine', 'rutiner')} som treffer {filtertekst}.</span>
                <button className="ik2-nullstill" onClick={nullstill}>
                  <X size={12} strokeWidth={2.2} />
                  Vis alt
                </button>
              </div>
            ) : null}

            {nyttPunkt !== null ? (
              <form
                className="seksjon seksjon-redigerer"
                onSubmit={ev => {
                  ev.preventDefault()
                  if (!nyttPunkt.trim() || jobber != null) return
                  void kjor('nytt-punkt', async () => {
                    await opprettIk2Punkt(kapittel.id, nyttPunkt)
                    setNyttPunkt(null)
                  })
                }}
              >
                <Felt
                  firkant
                  autoFocus
                  etikett="Hva heter punktet?"
                  value={nyttPunkt}
                  placeholder="Arbeid i tavle"
                  hjelp="Et punkt er én del av kapittelet. Rutinene legges under punktet etterpå."
                  onChange={e => setNyttPunkt(e.target.value)}
                />
                <div className="rad" style={{ marginTop: 12 }}>
                  <Knapp stil="merke" type="submit" disabled={!nyttPunkt.trim() || jobber != null}>
                    {jobber === 'nytt-punkt' ? 'Oppretter …' : 'Opprett punktet'}
                  </Knapp>
                  <Knapp stil="naken" type="button" disabled={jobber != null} onClick={() => setNyttPunkt(null)}>
                    Avbryt
                  </Knapp>
                </div>
              </form>
            ) : null}

            {punkter.length === 0 ? (
              <div className="dokument-tom">
                <p>Ingen punkter ennå. Del kapittelet opp i det dere faktisk gjør.</p>
                {HINT_FOR[kapittel.nummer] ? (
                  <p className="felt-hjelp" style={{ maxWidth: '58ch' }}>{HINT_FOR[kapittel.nummer]}</p>
                ) : null}
              </div>
            ) : (
              utsnitt.map(({ punkt, rutiner }) => (
                <Punkt
                  key={punkt.id}
                  punkt={punkt}
                  synlige={rutiner}
                  velgTag={velgTag}
                  fokus={fokus}
                  kanSkrive={kanSkrive}
                  etterEndring={etterEndring}
                />
              ))
            )}
          </>
        )}

        {/* Det administrative nederst. Viktig, men ikke det man kom for å lese. */}
        <div className="ik2-bunn">
          <div className="blokk">
            <div className="blokk-hode"><div className="blokk-tittel">Skjemaer</div></div>
            {skjemaer.length === 0 ? (
              <p className="dempet-mer">Ingen skjemaer knyttet til kapittelet.</p>
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
                rutine uten verktøy. */}
            {kanSkrive && ledige.length > 0 ? (
              <select
                className="velger"
                style={{ width: '100%', marginTop: 12 }}
                value=""
                onChange={e => {
                  const id = e.target.value
                  if (id) void kjor('knytt', () => knyttSkjema(kapittel.id, id))
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
                Alle firmaets maler er allerede knyttet til dette kapittelet.
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

            {kapittel.status !== 'vedtatt' ? (
              <p className="dempet-mer">Kapittelet er ikke vedtatt ennå.</p>
            ) : (
              <>
                <div className="stabel" style={{ gap: 8 }}>
                  {relevante.map(a => {
                    const lest = lesinger.find((l: Lesing) => l.user_id === a.id && l.versjon === kapittel.gjeldende_versjon)
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
                    Du bekreftet versjon {kapittel.gjeldende_versjon} den {dato(jegHarLest.lest_at)}.
                  </p>
                ) : (
                  <div style={{ marginTop: 14 }}>
                    <Knapp
                      stil="stille"
                      disabled={jobber != null}
                      onClick={() => kjor('lest', () =>
                        bekreftLest(kapittel.id, kapittel.gjeldende_versjon, profil?.full_name ?? ''))}
                    >
                      <CircleCheck size={15} strokeWidth={1.9} />
                      {jobber === 'lest' ? 'Bekrefter …' : 'Jeg har lest dette'}
                    </Knapp>
                    <p className="felt-hjelp" style={{ marginTop: 8 }}>
                      Gjelder versjon {kapittel.gjeldende_versjon}. Endres kapittelet, spør det om ny
                      bekreftelse.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="blokk ik2-bunn-bred">
            <div className="blokk-hode"><div className="blokk-tittel">Historikk</div></div>
            <Historikk
              hentRevisjoner={hentRev}
              hentAudit={hentAud}
              seAudit={seAudit}
              tom="Kapittelet står slik det ble opprettet."
            />
          </div>
        </div>
      </div>
    </>
  )
}
