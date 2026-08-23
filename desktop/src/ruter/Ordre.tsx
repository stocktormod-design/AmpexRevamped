import { formatKr, mvaLabel, somMvaType, type Fakturagrunnlag } from '@delt/invoicing'
import { kan } from '@delt/kontor-tilgang'
import { BOLKNAVN, BOLKREKKEFOLGE, grupper, type Bolk } from '@delt/ordrebolk'
import { finnAvvik, type Snapshot } from '@delt/approvals-calc'
import { CheckCircle2, CircleAlert, FileText, Snowflake, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/auth'
import { hentKunder, type Kunde } from '@/lib/kontor-lager'
import {
  grunnlagFra,
  hentArkiv,
  hentOrdredetalj,
  hentOrdrer,
  kanFryses,
  kanGodkjenneFaglig,
  markerFakturert,
  opprettOrdre,
  STATUS_NAVN,
  type Arkivrad,
  type Ordredetalj,
  type Ordrerad,
} from '@/lib/ordre-lager'
import { antall, Beskjed, Felt, Knapp, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Ordre.
 *
 * **Én ting per flate.** Lista til venstre, ORDREN til høyre — som ett dokument
 * med navngitte bokser under hverandre, ikke som fem faner man må klikke seg
 * gjennom for å se om noe mangler. Faner skjuler; en ordre er ikke fem ting, den
 * er én ting med fem avsnitt.
 *
 * Nøkkeltallene som sto her før er borte. De gjentok det forsiden allerede sier,
 * og en flate som åpner med fire store tall før innholdet har en flate som ikke
 * har bestemt seg for hva den handler om.
 *
 * ── Bunkene ────────────────────────────────────────────────────────────────
 *
 * Databasen har fem statuser; kontoret jobber i tre bunker (`lib/ordrebolk.ts`).
 * Lista grupperes på dem, og «Til godkjenning» står øverst fordi det er den
 * bunken som venter på et menneske. Inne i den kommer de UGODKJENTE først: en
 * ordre som er fakturaklar uten faglig godkjenning stopper når noen prøver å
 * fakturere, og databasen håndhever det.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short' })
const DATO_LANG = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'long', year: 'numeric' })

function dato(v: string | null | undefined, lang = false): string {
  if (!v) return '–'
  return (lang ? DATO_LANG : DATO).format(new Date(v))
}

function timer(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')
}

/**
 * `formatKr` gir tallet uten enhet, fordi den er laget for tabellkolonner der
 * overskriften alt sier «Netto». Står beløpet ALENE må enheten med, ellers er
 * «0,00» like gjerne timer.
 */
function kr(ore: number): string {
  return `${formatKr(ore)} kr`
}

export function Ordre() {
  const { profil } = useAuth()
  const rolle = profil?.role
  const seAlle = kan(rolle, 'ordre.alle')
  const seFaktura = kan(rolle, 'faktura.les')
  const kanFakturere = kan(rolle, 'faktura.marker')
  const seDb = kan(rolle, 'db.les')
  const kanOpprette = kan(rolle, 'ordre.skriv')

  const [sok, setSok] = useState('')
  const [apen, setApen] = useState(false)
  const [kunder, setKunder] = useState<Kunde[]>([])
  const [ny, setNy] = useState({ tittel: '', kundeId: '', adresse: '', beskrivelse: '' })
  const [oppretterJobber, setOppretterJobber] = useState(false)
  const [skjemafeil, setSkjemafeil] = useState<string | null>(null)
  const [bolker, setBolker] = useState<Bolk[]>([])
  const [rader, setRader] = useState<Ordrerad[]>([])
  const [valgt, setValgt] = useState<string | null>(null)
  const [detalj, setDetalj] = useState<Ordredetalj | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const [kanGodkjenne, setKanGodkjenne] = useState(false)
  const [versjon, setVersjon] = useState(0)
  const teller = useRef(0)

  useEffect(() => { void kanGodkjenneFaglig().then(setKanGodkjenne) }, [])

  const last = useCallback(async () => {
    const mitt = ++teller.current
    try {
      const ut = await hentOrdrer({
        sok,
        bareMine: seAlle ? null : (profil?.id ?? null),
      })
      if (mitt !== teller.current) return
      setRader(ut)
      // Detaljen må hentes på nytt selv om `valgt` er den samme. En teller er
      // den enkleste måten å si «det du har er utdatert» til en effekt.
      setVersjon(v => v + 1)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
  }, [sok, seAlle, profil?.id])

  useEffect(() => {
    const id = window.setTimeout(async () => {
      const mitt = ++teller.current
      setLaster(true)
      try {
        const ut = await hentOrdrer({
          sok,
          // Basen ser sine egne ordrer. Filteret er en visning, ikke en sperre:
          // RLS slipper hele firmaet gjennom, og det er med vilje — han skal
          // kunne slå opp en kollegas ordre, bare ikke drukne i dem.
          bareMine: seAlle ? null : (profil?.id ?? null),
        })
        if (mitt !== teller.current) return
        setRader(ut)
        setFeil(null)
        setValgt(v => (v && ut.some(o => o.id === v) ? v : (ut[0]?.id ?? null)))
      } catch (e) {
        if (mitt === teller.current) setFeil(e instanceof Error ? e.message : String(e))
      } finally {
        if (mitt === teller.current) setLaster(false)
      }
    }, 200)
    return () => window.clearTimeout(id)
  }, [sok, seAlle, profil?.id])

  useEffect(() => {
    if (!valgt) { setDetalj(null); return }
    let avbrutt = false
    setDetalj(null)
    hentOrdredetalj(valgt)
      .then(d => { if (!avbrutt) setDetalj(d) })
      .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
    return () => { avbrutt = true }
  }, [valgt, versjon])

  const synlige = useMemo(
    () => (bolker.length ? rader.filter(o => bolker.includes(o.bolk)) : rader),
    [rader, bolker],
  )
  const gruppert = useMemo(() => grupper(synlige), [synlige])
  const flat = useMemo(() => gruppert.flatMap(g => g.rader), [gruppert])

  // Pil opp og ned flytter i lista uten at hånda forlater tastaturet, og følger
  // rekkefølgen man SER — ikke rekkefølgen dataene kom i.
  const flytt = useCallback((retning: 1 | -1) => {
    setValgt(v => {
      const i = flat.findIndex(o => o.id === v)
      const neste = Math.min(Math.max(i + retning, 0), flat.length - 1)
      return flat[neste]?.id ?? v
    })
  }, [flat])

  useEffect(() => {
    const påTast = (e: KeyboardEvent) => {
      const i = document.activeElement
      const skriver = i instanceof HTMLInputElement || i instanceof HTMLTextAreaElement
      if (e.key === 'ArrowDown' && !skriver) { e.preventDefault(); flytt(1) }
      if (e.key === 'ArrowUp' && !skriver) { e.preventDefault(); flytt(-1) }
      if (e.key === 'Escape' && skriver) (i as HTMLInputElement).blur()
    }
    window.addEventListener('keydown', påTast)
    return () => window.removeEventListener('keydown', påTast)
  }, [flytt])

  const perBolk = useMemo(() => {
    const m = new Map<Bolk, number>()
    for (const o of rader) m.set(o.bolk, (m.get(o.bolk) ?? 0) + 1)
    return m
  }, [rader])

  const grunnlag = useMemo<Fakturagrunnlag | null>(
    () => (detalj && seFaktura ? grunnlagFra(detalj) : null),
    [detalj, seFaktura],
  )

  function veksle(b: Bolk) {
    setBolker(v => (v.includes(b) ? v.filter(x => x !== b) : [...v, b]))
  }

  return (
    <>
      <Sidehode
        tittel="Ordre"
        under={seAlle ? 'Hele firmaets portefølje' : 'Ordrene du er med på'}
        handling={
          <>
            {!seAlle ? <Merke stil="noytral">Mine ordrer</Merke> : null}
            <div style={{ width: 250 }}>
              <Felt
                placeholder="Søk ordrenummer, kunde, adresse …"
                value={sok}
                autoFocus
                onChange={e => setSok(e.target.value)}
              />
            </div>
            {kanOpprette ? (
              <Knapp
                stil="merke"
                onClick={() => {
                  setApen(true)
                  setSkjemafeil(null)
                  // Kunderegisteret hentes bare når skjemaet faktisk åpnes —
                  // ingen som bare søker i lista skal betale for det oppslaget.
                  if (kunder.length === 0) void hentKunder('').then(setKunder).catch(() => {})
                }}
              >
                Ny ordre
              </Knapp>
            ) : null}
          </>
        }
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {apen ? (
        <div className="inviter-boks" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
          <form
            className="stabel"
            onSubmit={async ev => {
              ev.preventDefault()
              setOppretterJobber(true)
              setSkjemafeil(null)
              try {
                const kunde = kunder.find(k => k.id === ny.kundeId)
                const id = await opprettOrdre(
                  {
                    tittel: ny.tittel,
                    kundeId: ny.kundeId || null,
                    kundeNavn: kunde?.name ?? '',
                    adresse: ny.adresse,
                    beskrivelse: ny.beskrivelse,
                  },
                  profil?.id ?? '',
                )
                setNy({ tittel: '', kundeId: '', adresse: '', beskrivelse: '' })
                setApen(false)
                await last()
                setValgt(id)
              } catch (e) {
                setSkjemafeil(e instanceof Error ? e.message : String(e))
              }
              setOppretterJobber(false)
            }}
          >
            <div className="inviter-felt">
              <Felt
                firkant
                autoFocus
                etikett="Tittel"
                hjelp="Det navnet ordren skal gå under."
                value={ny.tittel}
                onChange={e => setNy(n => ({ ...n, tittel: e.target.value }))}
              />
              <label className="felt felt-firkant">
                <span className="felt-etikett">Kunde</span>
                <select
                  className="felt-inn"
                  value={ny.kundeId}
                  onChange={e => setNy(n => ({ ...n, kundeId: e.target.value }))}
                >
                  <option value="">Ingen valgt ennå</option>
                  {kunder.map(k => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <Felt
              firkant
              etikett="Adresse"
              hjelp="Der jobben skal utføres — ikke nødvendigvis kundens fakturaadresse."
              value={ny.adresse}
              onChange={e => setNy(n => ({ ...n, adresse: e.target.value }))}
            />
            <label className="felt felt-firkant">
              <span className="felt-etikett">Beskrivelse</span>
              <textarea
                className="felt-inn skrivefelt skrivefelt-lav"
                value={ny.beskrivelse}
                onChange={e => setNy(n => ({ ...n, beskrivelse: e.target.value }))}
              />
            </label>
            {skjemafeil ? <Beskjed stil="feil">{skjemafeil}</Beskjed> : null}
            <div className="rad">
              <Knapp stil="merke" type="submit" disabled={oppretterJobber || !ny.tittel.trim()}>
                {oppretterJobber ? 'Oppretter …' : 'Opprett ordren'}
              </Knapp>
              <Knapp type="button" onClick={() => { setApen(false); setSkjemafeil(null) }}>
                Avbryt
              </Knapp>
              <span className="felt-hjelp">
                Tildeling, tidspunkt og materiell settes på ordren etter at den er opprettet.
              </span>
            </div>
          </form>
        </div>
      ) : null}

      <div className="arbeidsflate">
        <div className="delt">
          <div className="liste">
            <div className="liste-verktoy">
              <div className="filter">
                {BOLKREKKEFOLGE.map(b => (
                  <button
                    key={b}
                    className="filter-knapp"
                    aria-pressed={bolker.includes(b)}
                    onClick={() => veksle(b)}
                  >
                    {BOLKNAVN[b]}
                    <span className="filter-tall">{perBolk.get(b) ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="liste-kropp">
              {flat.length === 0 && !laster ? (
                <div className="tomt-mykt">
                  <p>{sok || bolker.length ? 'Ingen ordrer passer filteret' : 'Ingen ordrer ennå'}</p>
                </div>
              ) : (
                gruppert.map(g => (
                  <div key={g.bolk}>
                    <div className="liste-gruppe">{g.navn} · {antall(g.rader.length)}</div>
                    {g.rader.map(o => (
                      <button
                        key={o.id}
                        className="ordrerad"
                        aria-selected={o.id === valgt}
                        onClick={() => setValgt(o.id)}
                      >
                        <div className="ordrerad-topp">
                          <span className="ordrerad-nr">{o.order_number != null ? `#${o.order_number}` : '—'}</span>
                          <span className="ordrerad-tittel">{o.title}</span>
                        </div>
                        <div className="ordrerad-bunn">
                          <span className={`prikk prikk-${o.status}`} />
                          <span className="ordrerad-kunde">{o.customer_name || o.address || 'Ingen kunde'}</span>
                          {/* Bare i godkjenningsbunken. Ellers er flagget uten
                              betydning, og en hake der ville betydd ingenting. */}
                          {o.bolk === 'godkjenning' ? (
                            o.godkjent
                              ? <CheckCircle2 size={13} strokeWidth={2} style={{ color: 'var(--gronn)', flex: 'none' }} />
                              : <span className="ordrerad-dato" style={{ color: 'var(--gul)' }}>venter</span>
                          ) : (
                            <span className="ordrerad-dato">{dato(o.scheduled_at ?? o.updated_at)}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="detalj">
            {!valgt ? (
              <div className="tomt-mykt"><p>Velg en ordre</p></div>
            ) : !detalj ? (
              <div className="tomt-mykt"><p>Henter ordren …</p></div>
            ) : (
              <Detalj
                key={detalj.ordre.id}
                detalj={detalj}
                grunnlag={grunnlag}
                seFaktura={seFaktura}
                kanFakturere={kanFakturere}
                seDb={seDb}
                kanGodkjenne={kanGodkjenne}
                etterSkriving={last}
              />
            )}
          </div>
        </div>
      </div>

      <div className="dempet-mer" style={{ fontSize: 12, paddingLeft: 4 }}>
        {laster ? 'Henter …' : stk(synlige.length, 'ordre', 'ordrer')}
      </div>
    </>
  )
}

/**
 * Ordren som ett dokument.
 *
 * Bokser under hverandre med navn på, i den rekkefølgen kontoret leser dem:
 * hvem det gjelder, hva som ble gjort, hva som ble brukt, hva som skal
 * faktureres. Tomme bokser tegnes ikke — en ordre uten materiell skal ikke ha
 * en tom «Materiell»-boks man må rulle forbi.
 */
function Detalj({
  detalj,
  grunnlag,
  seFaktura,
  kanFakturere,
  seDb,
  kanGodkjenne,
  etterSkriving,
}: {
  detalj: Ordredetalj
  grunnlag: Fakturagrunnlag | null
  seFaktura: boolean
  kanFakturere: boolean
  seDb: boolean
  kanGodkjenne: boolean
  etterSkriving: () => Promise<void>
}) {
  const o = detalj.ordre
  const sumTimer = detalj.timer.reduce((s, t) => s + t.hours, 0)
  const foreslatte = detalj.tillegg.filter(t => t.status === 'foreslatt')
  const godkjent = detalj.godkjenninger.some(g => g.beslutning === 'godkjent')

  const [jobber, setJobber] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [arkiv, setArkiv] = useState<Arkivrad | null>(null)
  const [kanArkivere, setKanArkivere] = useState<{ ok: boolean; grunn: string | null } | null>(null)

  useEffect(() => {
    hentArkiv(o.id).then(setArkiv).catch(() => setArkiv(null))
    if (o.status === 'fakturert') kanFryses(o.id).then(setKanArkivere).catch(() => setKanArkivere(null))
  }, [o.id, o.status])

  async function fakturer() {
    if (!grunnlag) return
    setJobber('faktura')
    setFeil(null)
    try {
      await markerFakturert(o.id, grunnlag, null)
      await etterSkriving()
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
          <span className="hero-nr">{o.order_number != null ? `#${o.order_number}` : 'Uten nummer'}</span>
          <span className={`prikk prikk-${o.status}`} />
          <span className="dempet">{STATUS_NAVN[o.status]}</span>
          {o.quote_id ? <Merke stil="noytral">Fra tilbud</Merke> : null}
        </div>
        <h1 className="hero-tittel valgbar">{o.title}</h1>
        <div className="hero-handling">
          <Godkjenningsmerke detalj={detalj} grunnlag={grunnlag} kanGodkjenne={kanGodkjenne} />

          {/* Fakturaknappen dukker opp FØRST når ordren er godkjent. En knapp
              som alltid står der og feiler når man trykker, lærer folk å
              ignorere feilmeldinger. */}
          {kanFakturere && godkjent && o.status !== 'fakturert' && grunnlag && grunnlag.linjer.length > 0 ? (
            <Knapp stil="merke" onClick={fakturer} disabled={jobber != null}>
              {jobber === 'faktura' ? 'Merker …' : `Send faktura · ${kr(grunnlag.bruttoOre)}`}
            </Knapp>
          ) : null}

          {o.status === 'fakturert' && !arkiv ? (
            <Knapp stil="stille" disabled title="Frysingen må flyttes fra appen først">
              <Snowflake size={15} strokeWidth={1.8} />
              Arkiver
            </Knapp>
          ) : null}
          {arkiv ? <Merke stil="noytral">Arkivert</Merke> : null}
        </div>
      </div>

      <div className="detalj-kropp">
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
        <Boks tittel="Kunde">
          <div className="fakta">
            <Fakta navn="Navn" verdi={o.customer_name || 'Ingen kunde'} />
            <Fakta navn="Telefon" verdi={o.customer_phone || '–'} />
            <Fakta navn="Adresse" verdi={o.address || '–'} />
            <Fakta navn="Planlagt" verdi={o.scheduled_at ? dato(o.scheduled_at, true) : 'Ikke planlagt'} />
          </div>
        </Boks>

        <Boks tittel="Jobben">
          <p className="kort-hjelp valgbar">{o.description || 'Ingen beskrivelse ført.'}</p>
          {detalj.deltakere.length > 0 ? (
            <div className="rad" style={{ marginTop: 14, color: 'var(--blekk-2)' }}>
              <Users size={15} strokeWidth={1.8} />
              {detalj.deltakere.map(d => d.user_name).filter(Boolean).join(', ')}
            </div>
          ) : null}
        </Boks>

        {detalj.materiell.length > 0 ? (
          <Boks tittel="Materiell" merkelapp={stk(detalj.materiell.length, 'linje', 'linjer')}>
            <Materiell detalj={detalj} seFaktura={seFaktura} seDb={seDb} />
          </Boks>
        ) : null}

        {detalj.timer.length > 0 ? (
          <Boks tittel="Timer" merkelapp={`${timer(sumTimer)} t`}>
            <Timer detalj={detalj} seFaktura={seFaktura} />
          </Boks>
        ) : null}

        {foreslatte.length > 0 ? (
          <Boks tittel="Tilleggsarbeid som venter på kunden">
            {/* Et tillegg som fødes godkjent er et tillegg ingen spurte kunden om. */}
            {foreslatte.map(t => (
              <div key={t.id} className="rad" style={{ padding: '5px 0' }}>
                <CircleAlert size={15} strokeWidth={1.8} style={{ color: 'var(--gul)', flex: 'none' }} />
                <span className="strekk">{t.title}</span>
                <Merke stil="varsel">Foreslått</Merke>
              </div>
            ))}
          </Boks>
        ) : null}

        {detalj.dokumenter.length > 0 ? (
          <Boks tittel="Dokumentasjon" merkelapp={stk(detalj.dokumenter.length, 'dokument', 'dokumenter')}>
            {detalj.dokumenter.map(d => (
              <div key={d.id} className="rad" style={{ padding: '7px 0' }}>
                <FileText size={15} strokeWidth={1.8} className="dempet-mer" />
                <span className="strekk">{d.template_id}</span>
                {d.status === 'fullfort' ? (
                  <>
                    <CheckCircle2 size={14} strokeWidth={1.8} style={{ color: 'var(--gronn)' }} />
                    <span className="dempet-mer">{dato(d.completed_at, true)}</span>
                  </>
                ) : (
                  <Merke stil="varsel">Utkast</Merke>
                )}
              </div>
            ))}
          </Boks>
        ) : null}

        {grunnlag && (grunnlag.linjer.length > 0 || grunnlag.utelatt.length > 0) ? (
          <Boks tittel="Fakturagrunnlag" merkelapp={kr(grunnlag.bruttoOre)}>
            <Faktura grunnlag={grunnlag} seDb={seDb} />
          </Boks>
        ) : null}

        <Boks tittel="Faglig godkjenning">
          <Godkjenning detalj={detalj} />
        </Boks>

        {o.status === 'fakturert' || arkiv ? (
          <Boks tittel="Arkiv">
            {arkiv ? (
              <div className="fakta">
                <Fakta navn="Frosset" verdi={dato(arkiv.frosset_at, true)} />
                <Fakta navn="Oppbevares til" verdi={arkiv.oppbevares_til ? dato(arkiv.oppbevares_til, true) : '–'} />
                <Fakta navn="Størrelse" verdi={`${antall(Math.round(arkiv.bytes / 1024))} kB`} />
                <Fakta navn="SHA-256" verdi={`${arkiv.sha256.slice(0, 16)}…`} />
              </div>
            ) : (
              <p className="kort-hjelp">
                Ordren er fakturert og kan fryses til et uforanderlig arkiv i R2.{' '}
                {kanArkivere && !kanArkivere.ok && kanArkivere.grunn
                  ? <span className="dempet-mer">Databasen sier nei: {kanArkivere.grunn}</span>
                  : null}
              </p>
            )}
            {!arkiv ? (
              <p className="felt-hjelp" style={{ marginTop: 12 }}>
                Frysingen kjøres foreløpig fra montørappen, fordi R2-kanalen (`r2-sign`) ligger der.
                `lib/archive/freeze.ts` sier selv at den skal flyttes hit uendret når kontoret finnes
                — pakkebyggingen (`byggPakke`) er allerede ren. Det står igjen å hente radene fra
                Supabase i stedet for WatermelonDB.
              </p>
            ) : null}
          </Boks>
        ) : null}
      </div>
    </>
  )
}

/** Én navngitt boks. Tripletex-mønsteret: tittel, valgfri merkelapp, innhold. */
function Boks({
  tittel,
  merkelapp,
  children,
}: {
  tittel: string
  merkelapp?: string
  children: React.ReactNode
}) {
  return (
    <section className="seksjon">
      <div className="seksjon-hode">
        <div className="seksjon-tittel">{tittel}</div>
        {merkelapp ? <span className="dempet-mer" style={{ fontSize: 12 }}>{merkelapp}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Fakta({ navn, verdi }: { navn: string; verdi: string }) {
  return (
    <div>
      <div className="fakta-navn">{navn}</div>
      <div className="fakta-verdi valgbar">{verdi}</div>
    </div>
  )
}

/**
 * Godkjenningen, og om den fortsatt stemmer.
 *
 * `finnAvvik` er den samme rene funksjonen montørappen bruker, testet i
 * `verify:approvals`. Kjernen er at en godkjenning kan bli feil UTEN at noen
 * har gjort noe galt: godkjennes en ordre på 12 400 kr og noen fører to timer
 * etterpå, ser alt riktig ut med mindre noen sier fra.
 */
function Godkjenningsmerke({
  detalj,
  grunnlag,
  kanGodkjenne,
}: {
  detalj: Ordredetalj
  grunnlag: Fakturagrunnlag | null
  kanGodkjenne: boolean
}) {
  const siste = detalj.godkjenninger[0]
  if (!siste) {
    // «Ikke godkjent» på en ordre som nettopp kom inn er ikke informasjon, det
    // er støy — ingen har rukket å gjøre jobben ennå.
    const venter = detalj.ordre.status === 'fakturaklar'
    return kanGodkjenne && venter ? <Merke stil="varsel">Mangler godkjenning</Merke> : null
  }
  if (siste.beslutning === 'avvist') return <Merke stil="feil">Avvist</Merke>

  const snapshot: Snapshot = {
    sumOre: siste.sum_ore,
    timer: siste.timer,
    antallMateriell: siste.antall_materiell,
    antallDokumenter: siste.antall_dokumenter,
    antallSignaturer: siste.antall_signaturer,
    besluttetAt: new Date(siste.besluttet_at),
    beslutning: 'godkjent',
  }
  const avvik = grunnlag
    ? finnAvvik(snapshot, {
        sumOre: grunnlag.bruttoOre,
        timer: detalj.timer.reduce((s, t) => s + t.hours, 0),
        antallMateriell: detalj.materiell.length,
        antallDokumenter: detalj.dokumenter.length,
        antallFullforte: detalj.dokumenter.filter(d => d.status === 'fullfort').length,
        antallSignaturer: siste.antall_signaturer ?? 0,
        harKunde: !!detalj.ordre.customer_name,
      })
    : []

  return avvik.length > 0
    ? <Merke stil="varsel">Godkjent, men endret siden</Merke>
    : <Merke stil="ny">Godkjent</Merke>
}

function Godkjenning({ detalj }: { detalj: Ordredetalj }) {
  const siste = detalj.godkjenninger[0]
  if (!siste) {
    return (
      <p className="dempet-mer">
        Ingen beslutning ennå. Ordren kan ikke faktureres før faglig ansvarlig har godkjent den —
        databasen sperrer for det.
      </p>
    )
  }
  return (
    <>
      <div className="fakta">
        <Fakta navn="Beslutning" verdi={siste.beslutning === 'godkjent' ? 'Godkjent' : 'Avvist'} />
        <Fakta navn="Av" verdi={siste.godkjenner_navn ?? '–'} />
        <Fakta navn="Dato" verdi={dato(siste.besluttet_at, true)} />
        <Fakta navn="Sum den gangen" verdi={siste.sum_ore == null ? '–' : kr(siste.sum_ore)} />
      </div>
      {siste.begrunnelse ? <p className="kort-hjelp" style={{ marginTop: 14 }}>{siste.begrunnelse}</p> : null}
    </>
  )
}

function Materiell({ detalj, seFaktura, seDb }: { detalj: Ordredetalj; seFaktura: boolean; seDb: boolean }) {
  return (
    <table className="linjer">
      <thead>
        <tr>
          <th style={{ width: 90 }}>El-nr</th>
          <th>Vare</th>
          <th className="h" style={{ width: 70 }}>Antall</th>
          <th style={{ width: 50 }}>Enhet</th>
          {seFaktura ? <th className="h" style={{ width: 90 }}>Pris</th> : null}
          {seFaktura ? <th className="h" style={{ width: 60 }}>Rabatt</th> : null}
          {seDb ? <th className="h" style={{ width: 90 }}>Kost</th> : null}
          <th style={{ width: 100 }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {detalj.materiell.map(m => (
          <tr key={m.id}>
            <td className="valgbar dempet">{m.elnummer ?? ''}</td>
            <td>{m.description}</td>
            <td className="h">{antall(m.quantity)}</td>
            <td className="dempet">{m.unit}</td>
            {seFaktura ? <td className="h">{m.unit_price == null ? '–' : m.unit_price.toFixed(2).replace('.', ',')}</td> : null}
            {seFaktura ? <td className="h dempet">{m.discount_percent ? `${m.discount_percent} %` : ''}</td> : null}
            {seDb ? <td className="h dempet">{m.cost_price == null ? '–' : m.cost_price.toFixed(2).replace('.', ',')}</td> : null}
            <td>
              {m.invoiced_at ? <Merke stil="noytral">Fakturert</Merke>
                : m.billable === false ? <Merke stil="noytral">Ikke fakturerbar</Merke>
                : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Timer({ detalj, seFaktura }: { detalj: Ordredetalj; seFaktura: boolean }) {
  return (
    <table className="linjer">
      <thead>
        <tr>
          <th style={{ width: 80 }}>Dato</th>
          <th style={{ width: 150 }}>Person</th>
          <th style={{ width: 150 }}>Aktivitet</th>
          <th className="h" style={{ width: 60 }}>Timer</th>
          <th>Notat</th>
          {seFaktura ? <th style={{ width: 100 }}>Status</th> : null}
        </tr>
      </thead>
      <tbody>
        {detalj.timer.map(t => {
          const a = t.activity_id ? detalj.aktiviteter.get(t.activity_id) : undefined
          return (
            <tr key={t.id}>
              <td className="dempet">{dato(t.date)}</td>
              <td>{t.user_name ?? '–'}</td>
              <td className="dempet">{a?.name ?? '–'}</td>
              <td className="h">{timer(t.hours)}</td>
              {/* internal_note vises ALDRI her: den er intern, og denne skjermen
                  er der noen leser opp linjene for kunden på telefon. */}
              <td className="dempet valgbar">{t.note ?? ''}</td>
              {seFaktura ? (
                <td>
                  {t.invoiced_at ? <Merke stil="noytral">Fakturert</Merke>
                    : t.billable === false ? <Merke stil="noytral">Ikke fakturerbar</Merke>
                    : null}
                </td>
              ) : null}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Faktura({ grunnlag, seDb }: { grunnlag: Fakturagrunnlag; seDb: boolean }) {
  const GRUNN: Record<string, string> = {
    ikke_fakturerbar: 'Ikke fakturerbar',
    mangler_pris: 'Mangler pris',
    allerede_fakturert: 'Allerede fakturert',
    ikke_godkjent: 'Ikke godkjent av kunden',
    avvist: 'Avvist',
  }

  return (
    <>
      <table className="linjer">
        <thead>
          <tr>
            <th>Beskrivelse</th>
            <th className="h" style={{ width: 70 }}>Antall</th>
            <th style={{ width: 50 }}>Enhet</th>
            <th className="h" style={{ width: 90 }}>Pris</th>
            <th className="h" style={{ width: 70 }}>Rabatt</th>
            <th style={{ width: 70 }}>MVA</th>
            <th className="h" style={{ width: 100 }}>Netto</th>
          </tr>
        </thead>
        <tbody>
          {grunnlag.linjer.map(l => (
            <tr key={l.kildeIder.join('+')}>
              <td>
                {l.beskrivelse}
                {l.elnummer ? <span className="dempet-mer valgbar"> · {l.elnummer}</span> : null}
              </td>
              <td className="h">{antall(l.antall)}</td>
              <td className="dempet">{l.enhet}</td>
              <td className="h">{formatKr(l.enhetsprisOre)}</td>
              <td className="h dempet">{l.rabattOre ? `−${formatKr(l.rabattOre)}` : ''}</td>
              <td className="dempet">{mvaLabel[somMvaType(l.mva)]}</td>
              <td className="h">{formatKr(l.nettoOre)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sum">
        <div className="sum-rad">
          <span>Netto</span>
          <span className="sum-verdi">{kr(grunnlag.nettoOre)}</span>
        </div>
        {grunnlag.mvaFordeling.map(f => (
          <div className="sum-rad" key={f.mva}>
            <span>MVA {mvaLabel[f.mva]}</span>
            <span className="sum-verdi">{kr(f.mvaOre)}</span>
          </div>
        ))}
        <div className="sum-rad sum-rad-total">
          <span>Å fakturere</span>
          <span className="sum-verdi">{kr(grunnlag.bruttoOre)}</span>
        </div>
        {seDb && grunnlag.dbOre != null ? (
          <div className="sum-rad sum-db">
            <span>Dekningsbidrag</span>
            <span className="sum-verdi">
              {kr(grunnlag.dbOre)}
              {grunnlag.dbProsent != null ? ` · ${grunnlag.dbProsent.toFixed(0)} %` : ''}
            </span>
          </div>
        ) : null}
      </div>

      {/* Linjer som IKKE er med er like viktige som dem som er det: uten denne
          lista er «hvorfor står ikke de tre timene på fakturaen?» et spørsmål
          ingen kan svare på uten å åpne databasen. */}
      {grunnlag.utelatt.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <div className="fakta-navn" style={{ marginBottom: 10 }}>Holdt utenfor</div>
          <table className="linjer">
            <tbody>
              {grunnlag.utelatt.map(u => (
                <tr key={u.id}>
                  <td>{u.beskrivelse}</td>
                  <td style={{ width: 200 }} className="dempet">{GRUNN[u.grunn] ?? u.grunn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  )
}
