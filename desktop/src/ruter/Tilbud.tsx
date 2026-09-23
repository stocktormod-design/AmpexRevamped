import { formatKr, mvaLabel, tilOre } from '@delt/invoicing'
import { kan } from '@delt/kontor-tilgang'
import {
  anvendPaslag, foreslaaPris, paslagProsent, prisFraPaslagOre, tilbudStatusLabel,
  type OmradeSum, type Tilbudslinje, type TilbudslinjeArt, type TilbudStatus,
} from '@delt/quoting'
import { Boxes, Calculator, FolderPlus, Lock, MoreHorizontal, Plus, Printer, Send, Trash2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAuth } from '@/auth'
import { hentFirma, hentKunder, hentTilbud, type Kunde, type Tilbud as Rad } from '@/lib/kontor-lager'
import {
  angreSendt, byttPlass, endreLinje, endreLinjer, endreOmradenavn, endreTilbud, GYLDIGHET_DAGER,
  hentKatalog, hentPakker, hentTilbudsdetalj, lagrePakke, linjeSomInn, markerSendt, nyLinje, nyttOmrade,
  nyVare, opprettTilbud, settInnPakke, skrivPriser, skrivUtTilbud, slettLinje, slettLinjer, slettOmrade,
  slettPakke, sokVarer, type Katalogvare, type Linjerad, type Pakke, type Tilbudsdetalj, type Varetreff,
} from '@/lib/tilbud-lager'
import { Beskjed, Felt, Knapp, Merke, Sidehode, stk } from '@/ui/kit'
import { Delt } from '@/ui/Delt'

/**
 * Tilbud — lista til venstre, ARKET til høyre.
 *
 * Tredje runde 18.09, etter Tormod: «burde være mer likt sluttproduktet du
 * sender ut». Så redigeringsflaten ER dokumentet (`lib/pdf/tilbud.ts`): samme
 * brevhode, samme tittel, samme kundeblokk, samme tabell med Beskrivelse /
 * Spesifikasjon / Beløp, samme sum nederst. Du skriver rett på arket — tittel,
 * kunde, brevet, hver linje — og det du ser er det kunden får. Et nytt tilbud
 * er et blankt ark, ikke et skjema foran arket.
 *
 * Det kunden IKKE får — kost, påslag, dekningsbidrag — står ved siden av arket
 * («Innsiden»), for den som kan se DB, og kan slås på som grå tall under
 * linjene. Aldri på selve arket.
 *
 * Inni linjene er det fortsatt Cordels regneark: piler og Enter mellom radene,
 * Enter på siste rad lager en ny, Escape angrer cella, avkryssing i margen
 * merker linjer for én operasjon på alle («Blokk»). Hvert område har sin egen
 * «legg til»-rad med varesøket i (Jobber).
 *
 * Summen REGNES IKKE HER. `lib/quoting.ts` gjør det, den har `verify:quoting`,
 * og montørappen bruker den samme. Kontoret og telefonen skal aldri kunne
 * komme til to forskjellige svar på det samme tilbudet — det er beløpet kunden
 * har sagt ja til.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
const DATO_LANG = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })

function dato(v: string | null): string {
  return v ? DATO.format(new Date(v)) : '–'
}

const STIL: Record<TilbudStatus, 'ny' | 'varsel' | 'feil' | 'endret' | 'noytral'> = {
  utkast: 'noytral',
  sendt: 'endret',
  akseptert: 'ny',
  avslatt: 'feil',
  utlopt: 'varsel',
}

/** Norsk komma er det som tastes. Tomt felt er null, ikke null kroner. */
function somTall(v: string): number | null {
  const n = Number(v.replace(',', '.').replace(/\s/g, ''))
  return v.trim() === '' || !Number.isFinite(n) ? null : n
}

function tallTekst(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n).replace('.', ',')
}

/* ── Regnearket: celler og tastatur ─────────────────────────────────────── */

type Retning = 'opp' | 'ned'

/**
 * Cella i samme kolonne i neste (eller forrige) linjerad. Går forbi
 * områderadene og forbi tekstlinjer som mangler kolonnen — Enter i «Pris» skal
 * lande i neste PRIS, ikke i ingenting.
 */
function naboCelle(fra: HTMLElement, retning: Retning): HTMLInputElement | null {
  const kol = fra.dataset.kol
  const rad = fra.closest('tr')
  const tabell = fra.closest('table')
  if (!kol || !rad || !tabell) return null
  const rader = [...tabell.querySelectorAll<HTMLTableRowElement>('tr[data-linje]')]
  const i = rader.indexOf(rad as HTMLTableRowElement)
  if (i < 0) return null
  const steg = retning === 'ned' ? 1 : -1
  for (let j = i + steg; j >= 0 && j < rader.length; j += steg) {
    const treff = rader[j].querySelector<HTMLInputElement>(`input[data-kol="${kol}"]`)
    if (treff) return treff
  }
  return null
}

/**
 * Én redigerbar celle på arket. Ser ut som tekst til du er over den.
 *
 * Verdien commit-es på blur og på Enter, ikke på hvert tastetrykk: en runde til
 * basen per tegn ville både vært støy og gjort at markøren hoppet når svaret
 * kom tilbake. Escape forlater cella uten å lagre. Enter og piler går til
 * samme kolonne i neste rad (Cordel); Enter på siste rad lager en ny linje.
 */
function Celle({ verdi, vis, onLagre, bredde, tekst, laast, kol, onSisteRad, plassholder, klasse }: {
  verdi: string
  /** Slik tallet står på arket når cella ikke redigeres («249,00»). Rå verdi ved fokus. */
  vis?: string
  onLagre: (v: string) => void
  bredde?: number
  tekst?: boolean
  laast?: boolean
  kol: string
  onSisteRad?: () => void
  plassholder?: string
  klasse?: string
}) {
  const [utkast, setUtkast] = useState(verdi)
  const [fokus, setFokus] = useState(false)
  useEffect(() => { setUtkast(verdi) }, [verdi])

  if (laast) {
    return <span className={klasse}>{(vis ?? verdi) || (plassholder ? <span className="dempet-mer">{plassholder}</span> : '—')}</span>
  }

  function hopp(e: KeyboardEvent<HTMLInputElement>, retning: Retning, lagNy: boolean) {
    const el = e.currentTarget
    const nabo = naboCelle(el, retning)
    e.preventDefault()
    el.blur() // commit-er via onBlur
    if (nabo) { nabo.focus(); nabo.select() }
    else if (lagNy && onSisteRad) onSisteRad()
  }

  return (
    <input
      className={klasse ? `celle-inn ${klasse}` : 'celle-inn'}
      data-kol={kol}
      style={{ width: bredde, textAlign: tekst ? 'left' : 'right' }}
      value={!fokus && vis !== undefined && utkast === verdi ? vis : utkast}
      placeholder={plassholder}
      inputMode={tekst ? 'text' : 'decimal'}
      onChange={e => setUtkast(e.target.value)}
      onFocus={e => { setFokus(true); const t = e.target; requestAnimationFrame(() => t.select()) }}
      onBlur={() => { setFokus(false); if (utkast !== verdi) onLagre(utkast) }}
      onKeyDown={e => {
        if (e.key === 'Enter') hopp(e, 'ned', true)
        else if (e.key === 'ArrowDown') hopp(e, 'ned', false)
        else if (e.key === 'ArrowUp') hopp(e, 'opp', false)
        else if (e.key === 'Escape') { setUtkast(verdi); e.currentTarget.blur() }
      }}
    />
  )
}

/** Lukk en nedtrekksliste når det klikkes utenfor den. */
function useKlikkUtenfor(ref: React.RefObject<HTMLElement | null>, lukk: () => void) {
  useEffect(() => {
    function paa(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) lukk()
    }
    document.addEventListener('mousedown', paa)
    return () => document.removeEventListener('mousedown', paa)
  }, [ref, lukk])
}

/**
 * Åpner lista OPPOVER når knappen står i nedre halvdel av vinduet. En
 * nedtrekksliste man må rulle for å se er ikke en nedtrekksliste.
 */
function useOppover(ref: React.RefObject<HTMLElement | null>, apen: boolean): boolean {
  const [oppover, setOppover] = useState(false)
  useEffect(() => {
    if (!apen || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setOppover(r.top > window.innerHeight * 0.55)
  }, [apen, ref])
  return apen && oppover
}

/* ── «Legg til» ─────────────────────────────────────────────────────────── */

type Valg = { nokkel: string; tittel: string; meta?: string; hoyre?: string; gjor: () => void; slett?: () => void }

/**
 * Én linje nederst i hvert område, som ser ut som den neste raden på arket.
 * Før var det et søkefelt og fire knapper (Vare, Arbeid, Tekst, Pakke) — Tormod
 * 23.09: «mer opplagt og intuitivt enn noen knapper på siden». Nå skriver du
 * det du vil ha, og lista under sier hva det kan bli: en vare fra katalogen,
 * eller teksten som vare, arbeid eller fritekst. Tomt felt viser snarveiene:
 * arbeid, tekst, pakkene og katalogen til å bla i. Pil og Enter velger.
 */
function LeggTil({ disabled, placeholder, pakker, onVare, onNy, onPakke, onSlettPakke }: {
  disabled: boolean
  placeholder: string
  pakker: Pakke[]
  onVare: (v: Varetreff) => void
  onNy: (art: TilbudslinjeArt, tekst: string) => void
  onPakke: (p: Pakke) => void
  onSlettPakke: (p: Pakke) => void
}) {
  const [sok, setSok] = useState('')
  const [treff, setTreff] = useState<Varetreff[]>([])
  const [apen, setApen] = useState(false)
  const [aktiv, setAktiv] = useState(0)
  const [katalog, setKatalog] = useState(false)
  const teller = useRef(0)
  const boks = useRef<HTMLDivElement>(null)
  const inn = useRef<HTMLInputElement>(null)
  useKlikkUtenfor(boks, useCallback(() => setApen(false), []))
  const oppover = useOppover(boks, apen)
  const q = sok.trim()

  useEffect(() => {
    if (q.length < 2) { setTreff([]); return }
    const id = window.setTimeout(async () => {
      const mitt = ++teller.current
      try {
        const r = await sokVarer(q)
        if (mitt === teller.current) setTreff(r)
      } catch {
        // Søket er en hjelp, ikke en handling — feiler det, står fritekst igjen.
      }
    }, 180)
    return () => window.clearTimeout(id)
  }, [q])

  function ferdig() {
    setSok('')
    setTreff([])
    setAktiv(0)
    setApen(false)
  }

  const pris = (v: Varetreff) => v.unit_price !== null ? `${formatKr(tilOre(v.unit_price))} kr` : v.cost_price !== null ? `kost ${formatKr(tilOre(v.cost_price))}` : ''
  const pakkeValg = (p: Pakke): Valg => ({
    nokkel: `pakke-${p.id}`, tittel: p.name, meta: `Pakke · ${stk(p.linjer.length, 'linje', 'linjer')}`,
    gjor: () => { onPakke(p); ferdig() },
    slett: () => { if (window.confirm(`Slette pakken «${p.name}»?`)) onSlettPakke(p) },
  })

  const valg: Valg[] = q.length >= 2 ? [
    ...treff.map(v => ({ nokkel: v.id, tittel: v.name, meta: [v.elnummer, v.unit].filter(Boolean).join(' · '), hoyre: pris(v), gjor: () => { onVare(v); ferdig() } })),
    ...pakker.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).map(pakkeValg),
    { nokkel: 'vare', tittel: `«${q}» som vare`, meta: treff.length === 0 ? 'Ikke i katalogen — legges til som egen linje' : 'Uten katalog', gjor: () => { onNy('materiell', q); ferdig() } },
    { nokkel: 'arbeid', tittel: `«${q}» som arbeid`, meta: 'Timer × timepris', gjor: () => { onNy('arbeid', q); ferdig() } },
    { nokkel: 'tekst', tittel: `«${q}» som tekst`, meta: 'Overskrift eller forbehold, uten beløp', gjor: () => { onNy('tekst', q); ferdig() } },
  ] : [
    { nokkel: 'arbeid', tittel: 'Arbeid', meta: 'Ny timelinje', gjor: () => { onNy('arbeid', 'Arbeid'); ferdig() } },
    { nokkel: 'tekst', tittel: 'Tekst', meta: 'Overskrift eller forbehold, uten beløp', gjor: () => { onNy('tekst', ''); ferdig() } },
    ...pakker.map(pakkeValg),
    { nokkel: 'katalog', tittel: 'Bla i katalogen …', meta: 'For når du ikke vet hva varen heter', gjor: () => { setApen(false); setKatalog(true) } },
  ]

  return (
    <div className="leggtil" ref={boks}>
      <Plus size={15} strokeWidth={2} className="leggtil-pluss" />
      <input
        ref={inn}
        className="leggtil-inn"
        placeholder={placeholder}
        value={sok}
        disabled={disabled}
        onChange={e => { setSok(e.target.value); setAktiv(0); setApen(true) }}
        onFocus={() => setApen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setApen(true); setAktiv(a => Math.min(a + 1, valg.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAktiv(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); valg[aktiv]?.gjor() }
          else if (e.key === 'Escape') { setApen(false); e.currentTarget.blur() }
        }}
      />
      {apen && !disabled ? (
        <div className={oppover ? 'nedtrekk leggtil-liste oppover' : 'nedtrekk leggtil-liste'}>
          {q.length >= 2 && treff.length > 0 ? <div className="varevelger-gruppe">Fra katalogen</div> : null}
          {valg.map((v, i) => (
            <Fragment key={v.nokkel}>
              {q.length >= 2 && v.nokkel === 'vare' ? <div className="varevelger-gruppe">Eller legg til som</div> : null}
              <button
                type="button"
                className="nedtrekk-rad"
                aria-selected={i === aktiv}
                onMouseEnter={() => setAktiv(i)}
                onMouseDown={e => e.preventDefault()}
                onClick={v.gjor}
              >
                <span className="nedtrekk-navn">{v.tittel}</span>
                <span className="nedtrekk-tall">
                  {v.hoyre}
                  {v.slett ? (
                    <span className="leggtil-slett" role="button" title="Slett pakken"
                      onClick={e => { e.stopPropagation(); v.slett!() }}>
                      <Trash2 size={12} strokeWidth={2} />
                    </span>
                  ) : null}
                </span>
                {v.meta ? <span className="nedtrekk-meta">{v.meta}</span> : null}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
      <Varevelger apen={katalog} onLukk={() => setKatalog(false)} onVelg={v => { onVare(v); setKatalog(false) }} />
    </div>
  )
}

/* ── Varevelgeren ───────────────────────────────────────────────────────── */

/**
 * Katalogen til å BLA i (Cordel «prisbok»), for den som ikke vet navnet:
 * gruppert på kategori, søk øverst, ett klikk legger varen på arket. Er
 * katalogen tom — et firma uten prisfil — legges varen inn her, i katalogen,
 * så den finnes neste gang. Det er slik katalogen starter.
 */
function Varevelger({ apen, onLukk, onVelg }: { apen: boolean; onLukk: () => void; onVelg: (v: Varetreff) => void }) {
  const setApen = (a: boolean) => { if (!a) onLukk() }
  const [sok, setSok] = useState('')
  const [varer, setVarer] = useState<Katalogvare[] | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [nyModus, setNyModus] = useState(false)
  const [ny, setNy] = useState({ name: '', elnummer: '', unit: 'stk', kost: '', pris: '' })
  const [lagrer, setLagrer] = useState(false)
  const teller = useRef(0)
  const boks = useRef<HTMLDivElement>(null)
  useKlikkUtenfor(boks, useCallback(() => setApen(false), []))
  const oppover = useOppover(boks, apen)

  useEffect(() => {
    if (!apen) return
    const id = window.setTimeout(async () => {
      const mitt = ++teller.current
      try {
        const r = await hentKatalog(sok)
        if (mitt === teller.current) { setVarer(r); setFeil(null) }
      } catch (e) {
        if (mitt === teller.current) setFeil(e instanceof Error ? e.message : String(e))
      }
    }, 150)
    return () => window.clearTimeout(id)
  }, [apen, sok])

  const grupper = useMemo(() => {
    const ut = new Map<string, Katalogvare[]>()
    for (const v of varer ?? []) {
      const g = v.category || v.discount_group || 'Uten kategori'
      ut.set(g, [...(ut.get(g) ?? []), v])
    }
    return [...ut.entries()]
  }, [varer])

  function velg(v: Varetreff) {
    onVelg(v)
    setApen(false)
    setSok('')
  }

  async function lagreNy() {
    if (lagrer) return
    setLagrer(true)
    setFeil(null)
    try {
      const v = await nyVare({
        name: ny.name,
        elnummer: ny.elnummer || null,
        unit: ny.unit,
        unit_price: somTall(ny.pris),
        cost_price: somTall(ny.kost),
      })
      setNy({ name: '', elnummer: '', unit: 'stk', kost: '', pris: '' })
      setNyModus(false)
      velg(v)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setLagrer(false)
    }
  }

  return (
    <div className="varevelger-anker" ref={boks}>
      {apen ? (
        <div className={oppover ? 'nedtrekk varevelger oppover' : 'nedtrekk varevelger'}>
          <div className="varevelger-hode">
            <input
              className="felt-inn"
              autoFocus
              placeholder="Søk i katalogen — navn eller el-nummer"
              value={sok}
              onChange={e => setSok(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setApen(false)
                if (e.key === 'Enter' && varer && varer.length > 0) { e.preventDefault(); velg(varer[0]) }
              }}
            />
          </div>
          <div className="varevelger-liste">
            {feil ? <div className="nedtrekk-hjelp" style={{ color: 'var(--rod)' }}>{feil}</div> : null}
            {varer === null ? (
              <div className="nedtrekk-hjelp">Henter katalogen …</div>
            ) : varer.length === 0 && !sok.trim() ? (
              <div className="nedtrekk-hjelp">
                Katalogen er tom. Importer en prisfil fra grossisten, eller legg inn varene én og én
                her etter hvert som de trengs — de blir liggende i katalogen.
              </div>
            ) : varer.length === 0 ? (
              <div className="nedtrekk-hjelp">Ingen treff på «{sok.trim()}».</div>
            ) : grupper.map(([gruppe, liste]) => (
              <Fragment key={gruppe}>
                <div className="varevelger-gruppe">{gruppe}</div>
                {liste.map(v => (
                  <button key={v.id} type="button" className="nedtrekk-rad" onMouseDown={e => e.preventDefault()} onClick={() => velg(v)}>
                    <span className="nedtrekk-navn">{v.name}</span>
                    <span className="nedtrekk-tall">{v.unit_price !== null ? `${formatKr(tilOre(v.unit_price))} kr` : v.cost_price !== null ? `kost ${formatKr(tilOre(v.cost_price))}` : ''}</span>
                    <span className="nedtrekk-meta">{[v.elnummer, v.unit].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
          <div className="varevelger-bunn">
            {nyModus ? (
              <>
                <div className="varevelger-felt">
                  <input className="felt-inn" autoFocus placeholder="Navn" value={ny.name} onChange={e => setNy(v => ({ ...v, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void lagreNy() } }} />
                  <input className="felt-inn" placeholder="El-nr" value={ny.elnummer} onChange={e => setNy(v => ({ ...v, elnummer: e.target.value }))} />
                  <input className="felt-inn" placeholder="Enhet" value={ny.unit} onChange={e => setNy(v => ({ ...v, unit: e.target.value }))} />
                  <input className="felt-inn" placeholder="Kost" inputMode="decimal" value={ny.kost} onChange={e => setNy(v => ({ ...v, kost: e.target.value }))} />
                  <input className="felt-inn" placeholder="Pris" inputMode="decimal" value={ny.pris} onChange={e => setNy(v => ({ ...v, pris: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void lagreNy() } }} />
                </div>
                <div className="rad" style={{ gap: 8 }}>
                  <button type="button" className="knapp knapp-primar" style={{ height: 30 }} disabled={!ny.name.trim() || lagrer} onClick={() => void lagreNy()}>
                    {lagrer ? 'Lagrer …' : 'Legg i katalogen og på arket'}
                  </button>
                  <button type="button" className="knapp knapp-naken" style={{ height: 30 }} onClick={() => setNyModus(false)}>Avbryt</button>
                </div>
              </>
            ) : (
              <button type="button" className="knapp knapp-naken" style={{ height: 30, justifyContent: 'flex-start' }} onClick={() => setNyModus(true)}>
                <Plus size={14} strokeWidth={1.8} /> Ny vare i katalogen
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ── Arket ──────────────────────────────────────────────────────────────── */

function Ark({ detalj, kanSkrive, seDb, etterSkriving }: {
  detalj: Tilbudsdetalj
  kanSkrive: boolean
  seDb: boolean
  etterSkriving: () => Promise<void>
}) {
  const { hode, sum, innhold, omrader, linjer } = detalj
  const [feil, setFeil] = useState<string | null>(null)
  const [jobber, setJobber] = useState(false)
  const [kunder, setKunder] = useState<Kunde[]>([])
  const [pakker, setPakker] = useState<Pakke[]>([])
  const [firma, setFirma] = useState<{ navn: string; orgnr: string | null } | null>(null)
  // Innsiden på linjene: kost og påslag som grå tall under spesifikasjonen.
  // Av som standard — arket skal se ut som det kunden får.
  const [visInnsiden, setVisInnsiden] = useState(false)
  // Blokk: merkede linjer. Shift-klikk merker et område.
  const [valgte, setValgte] = useState<Set<string>>(new Set())
  const [sisteMerket, setSisteMerket] = useState<string | null>(null)
  const [utvalgPaslag, setUtvalgPaslag] = useState('')
  const [fokusId, setFokusId] = useState<string | null>(null)
  const [nyttRot, setNyttRot] = useState(false)
  const [nyttUnder, setNyttUnder] = useState<string | null>(null)
  const redigerbar = kanSkrive && detalj.redigerbar
  const kanVelgeTilvalg = kanSkrive && hode.status !== 'akseptert' && hode.status !== 'avslatt'

  const perId = useMemo(() => new Map(linjer.map(l => [l.id, l])), [linjer])
  const rekkefolge = useMemo(() => [
    ...innhold.utenOmrade.map(l => l.id),
    ...innhold.omrader.flatMap(o => o.linjer.map(l => l.id)),
  ], [innhold])

  useEffect(() => { void hentPakker().then(setPakker).catch(() => {}) }, [])
  useEffect(() => {
    void hentFirma()
      .then(f => setFirma({ navn: f.company?.name ?? 'Ampex', orgnr: f.company?.org_number ?? null }))
      .catch(() => setFirma({ navn: 'Ampex', orgnr: null }))
  }, [])

  useEffect(() => {
    setValgte(v => {
      const ny = new Set([...v].filter(id => perId.has(id)))
      return ny.size === v.size ? v : ny
    })
  }, [perId])

  useEffect(() => {
    if (!fokusId) return
    const el = document.querySelector<HTMLInputElement>(`tr[data-linje="${fokusId}"] input[data-kol="navn"]`)
    if (el) { el.focus(); el.select(); setFokusId(null) }
  }, [fokusId, linjer])

  /** Alt som skriver går herfra: én feilvisning, én oppfriskning. */
  const skriv = useCallback(async (gjor: () => Promise<unknown>) => {
    setJobber(true)
    setFeil(null)
    try {
      await gjor()
      await etterSkriving()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(false)
    }
  }, [etterSkriving])

  const medregnet = sum.linjer.filter(l => l.tellerMed)
  const materiell = medregnet.filter(l => l.art === 'materiell').reduce((n, l) => n + l.nettoOre, 0)
  const arbeid = medregnet.filter(l => l.art === 'arbeid').reduce((n, l) => n + l.nettoOre, 0)
  const dbTap = sum.dbOre !== null && sum.dbOre < 0

  /* ── Legge til ── */

  function leggTil(kind: TilbudslinjeArt, sectionId: string | null, description = '') {
    void skriv(async () => {
      const id = await nyLinje(hode.id, { kind, sectionId, description, quantity: kind === 'tekst' ? null : 1 })
      setFokusId(id)
    })
  }

  function leggTilVare(v: Varetreff, sectionId: string | null) {
    void skriv(() => nyLinje(hode.id, {
      kind: 'materiell',
      sectionId,
      description: v.name,
      quantity: 1,
      unit: v.unit,
      unitPrice: foreslaaPris(v.cost_price, v.unit_price, hode.default_markup_percent),
      costPrice: v.cost_price,
      vatType: v.vat_type,
      productId: v.id,
      elnummer: v.elnummer,
    }))
  }

  /* ── Blokk ── */

  function merk(id: string, shift: boolean) {
    setValgte(v => {
      const ny = new Set(v)
      if (shift && sisteMerket && rekkefolge.includes(sisteMerket)) {
        const a = rekkefolge.indexOf(sisteMerket)
        const b = rekkefolge.indexOf(id)
        for (const x of rekkefolge.slice(Math.min(a, b), Math.max(a, b) + 1)) ny.add(x)
      } else if (ny.has(id)) ny.delete(id)
      else ny.add(id)
      return ny
    })
    setSisteMerket(id)
  }

  const ids = [...valgte]
  const merkede = ids.map(id => perId.get(id)).filter((l): l is Linjerad => !!l)

  function paaUtvalg(patch: Parameters<typeof endreLinjer>[1]) {
    void skriv(() => endreLinjer(ids, patch))
  }

  function oppdaterPaslag(prosent: number | null, bare?: Set<string>) {
    if (prosent === null) return
    const patcher = anvendPaslag(linjer.map(linjeSomInn), prosent, bare)
    if (patcher.length === 0) { setFeil('Ingen linjer å oppdatere: låste linjer, tekst og linjer uten kost røres ikke.'); return }
    void skriv(() => skrivPriser(patcher))
  }

  /* ── Radene på arket ── */

  // Avkryss · Beskrivelse · Antall · Enhetspris · Beløp · ⋯ — samme fire
  // kolonner som PDF-en (lib/pdf/tilbud.ts), og som Drifti/Stripe/Jobber.
  const KOLONNER = 6

  function linjerad(l: Tilbudslinje, gruppe: Tilbudslinje[], i: number, innrykk: number) {
    const rad = perId.get(l.id)
    if (!rad) return null
    const paslag = paslagProsent(rad.cost_price !== null ? tilOre(rad.cost_price) : null, l.enhetsprisOre)
    const tapt = l.kostOre !== null && l.tellerMed && l.nettoOre < l.kostOre
    const fravalgt = l.valgfri && !l.valgt
    const merket = valgte.has(l.id)

    return (
      <tr
        key={l.id}
        data-linje={l.id}
        aria-selected={merket}
        className={[fravalgt ? 'fravalgt' : '', l.art === 'tekst' ? 'tekstrad' : ''].filter(Boolean).join(' ') || undefined}
      >
        <td className="avkryss">
          {redigerbar ? (
            <input type="checkbox" checked={merket} title="Merk linja (shift for flere)"
              onClick={e => merk(l.id, e.shiftKey)} onChange={() => {}} />
          ) : null}
        </td>

        {l.art === 'tekst' ? (
          <td colSpan={3} style={{ paddingLeft: innrykk * 16 }}>
            <Celle tekst kol="navn" laast={!redigerbar} verdi={l.beskrivelse} klasse="ark-tekst"
              plassholder="Overskrift eller forbehold"
              onLagre={v => void skriv(() => endreLinje(l.id, { description: v }))}
              onSisteRad={() => leggTil('tekst', rad.section_id)} />
          </td>
        ) : (
          <>
            <td style={{ paddingLeft: innrykk * 16 }}>
              <Celle tekst kol="navn" laast={!redigerbar} verdi={l.beskrivelse} klasse="ark-navn"
                plassholder={l.art === 'arbeid' ? 'Hva arbeidet gjelder' : 'Hva linja gjelder'}
                onLagre={v => void skriv(() => endreLinje(l.id, { description: v }))}
                onSisteRad={() => leggTil(l.art, rad.section_id)} />
              {l.elnummer || l.valgfri || l.prisLaast ? (
                <div className="ark-hjelp">
                  {[
                    l.elnummer ? `El-nr ${l.elnummer}` : null,
                    l.prisLaast ? 'Låst pris' : null,
                  ].filter(Boolean).join(' · ')}
                  {l.valgfri && (l.elnummer || l.prisLaast) ? <span className="ark-skille">·</span> : null}
                  {l.valgfri ? (
                    <button type="button" className="tilvalg-knapp" data-valgt={l.valgt}
                      disabled={!kanVelgeTilvalg || jobber}
                      title={kanVelgeTilvalg ? (l.valgt ? 'Kunden har valgt dette — klikk for å ta det ut' : 'Ikke medregnet — klikk når kunden sier ja') : 'Tilvalg'}
                      onClick={() => void skriv(() => endreLinje(l.id, { is_selected: !l.valgt }))}>
                      {l.valgt ? 'Tilvalg, medregnet' : 'Tilvalg, ikke medregnet'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </td>
            <td className="tall ark-antall">
              <Celle kol="antall" bredde={46} laast={!redigerbar} verdi={tallTekst(rad.quantity)}
                onLagre={v => void skriv(() => endreLinje(l.id, { quantity: somTall(v) }))} />
              <Celle tekst kol="enhet" bredde={30} laast={!redigerbar} verdi={rad.unit ?? ''} klasse="ark-enhet"
                plassholder="enh"
                onLagre={v => void skriv(() => endreLinje(l.id, { unit: v.trim() || null }))} />
            </td>
            <td className="tall">
              <Celle kol="pris" bredde={84} laast={!redigerbar} verdi={tallTekst(rad.unit_price)}
                vis={rad.unit_price === null ? '' : formatKr(tilOre(rad.unit_price))}
                onLagre={v => void skriv(() => endreLinje(l.id, { unit_price: somTall(v) }))} />
              {redigerbar || l.rabattProsent > 0 ? (
                // Rabatten står under prisen når den finnes; ellers dukker feltet
                // opp når du er på raden. «−10 % rabatt», ikke et regnestykke.
                <div className="ark-rabatt" data-har={l.rabattProsent > 0}>
                  <span>−</span><Celle kol="rabatt" bredde={30} laast={!redigerbar} verdi={tallTekst(rad.discount_percent)}
                    plassholder="0"
                    onLagre={v => void skriv(() => endreLinje(l.id, { discount_percent: somTall(v) }))} />
                  % rabatt
                </div>
              ) : null}
              {visInnsiden ? (
                <div className="innsiden">
                  kost
                  <Celle kol="kost" bredde={60} laast={!redigerbar} verdi={tallTekst(rad.cost_price)}
                    onLagre={v => void skriv(() => endreLinje(l.id, { cost_price: somTall(v) }))} />
                  +
                  <Celle kol="paslag" bredde={36}
                    laast={!redigerbar || l.prisLaast || rad.cost_price === null || rad.cost_price <= 0}
                    verdi={paslag === null ? '' : tallTekst(Math.round(paslag * 10) / 10)}
                    onLagre={v => {
                      const pr = somTall(v)
                      if (pr === null || rad.cost_price === null) return
                      void skriv(() => endreLinje(l.id, { unit_price: prisFraPaslagOre(tilOre(rad.cost_price!), pr) / 100 }))
                    }} />
                  %
                </div>
              ) : null}
            </td>
          </>
        )}

        <td className="tall ark-belop" style={{ color: tapt ? 'var(--rod)' : undefined }}>
          {l.art === 'tekst' ? null : formatKr(l.nettoOre)}
        </td>

        <td className="verktoy">
          {redigerbar ? (
            <Radmeny
              disabled={jobber}
              valg={[
                { tekst: 'Flytt opp', av: i === 0, gjor: () => { const b = perId.get(gruppe[i - 1]?.id ?? ''); if (b) void skriv(() => byttPlass(rad, b)) } },
                { tekst: 'Flytt ned', av: i === gruppe.length - 1, gjor: () => { const b = perId.get(gruppe[i + 1]?.id ?? ''); if (b) void skriv(() => byttPlass(rad, b)) } },
                ...(l.art === 'tekst' ? [] : [
                  { tekst: l.valgfri ? 'Ikke tilvalg' : 'Gjør til tilvalg', gjor: () => void skriv(() => endreLinje(l.id, l.valgfri ? { is_optional: false } : { is_optional: true, is_selected: false })) },
                  { tekst: l.prisLaast ? 'Lås opp prisen' : 'Lås prisen', gjor: () => void skriv(() => endreLinje(l.id, { price_locked: !l.prisLaast })) },
                ]),
                { tekst: 'Slett linja', fare: true, gjor: () => void skriv(() => slettLinje(l.id)) },
              ]}
            />
          ) : null}
        </td>
      </tr>
    )
  }

  function omraderad(o: OmradeSum) {
    const rad = omrader.find(x => x.id === o.id)
    return (
      <tr key={o.id} className="ark-omrade">
        <td className="avkryss" />
        <td colSpan={3} style={{ paddingLeft: o.niva * 16 }}>
          <Celle tekst kol="omrade" laast={!redigerbar || !rad} verdi={o.navn} klasse="ark-omradenavn"
            plassholder="Område"
            onLagre={v => void skriv(() => endreOmradenavn(o.id, v))} />
          {visInnsiden && o.dbOre !== null
            ? <div className="innsiden">DB {formatKr(o.dbOre)}{o.dbProsent !== null ? ` · ${o.dbProsent.toFixed(0)} %` : ''}</div>
            : null}
        </td>
        <td className="tall ark-belop ark-omradesum">{formatKr(o.nettoOre)}</td>
        <td className="verktoy">
          {redigerbar && rad ? (
            <Radmeny
              disabled={jobber}
              valg={[
                { tekst: 'Nytt underområde', gjor: () => setNyttUnder(o.id) },
                { tekst: 'Slett området (linjene blir liggende)', fare: true, gjor: () => void skriv(() => slettOmrade(o.id, rad.forelderId)) },
              ]}
            />
          ) : null}
        </td>
      </tr>
    )
  }

  /** Den tomme raden nederst i hvert område: skriv, og velg hva det skal bli. */
  function leggTilRad(sectionId: string | null, navn: string, innrykk: number) {
    return (
      <tr key={`${sectionId ?? 'rot'}-legg-til`} className="ark-legg-til">
        <td className="avkryss" />
        <td colSpan={KOLONNER - 1} style={{ paddingLeft: innrykk * 16 }}>
          <LeggTil
            disabled={jobber}
            placeholder={sectionId ? `Legg til i ${navn}: vare, arbeid eller tekst` : 'Legg til vare, arbeid eller tekst'}
            pakker={pakker}
            onVare={v => leggTilVare(v, sectionId)}
            onNy={(art, tekst) => leggTil(art, sectionId, tekst)}
            onPakke={p => void skriv(() => settInnPakke(hode.id, p, 1, sectionId, hode.default_markup_percent))}
            onSlettPakke={p => void skriv(async () => { await slettPakke(p.id); setPakker(await hentPakker()) })}
          />
        </td>
      </tr>
    )
  }

  /** «+ Nytt område» som en rad på arket, ikke et spørsmålsvindu. */
  function nyttOmradeRad(forelderId: string | null, innrykk: number) {
    const apen = forelderId === null ? nyttRot : nyttUnder === forelderId
    const lukk = () => { if (forelderId === null) setNyttRot(false); else setNyttUnder(null) }
    return (
      <tr key={`nytt-omrade-${forelderId ?? 'rot'}`} className="ark-nytt-omrade">
        <td className="avkryss" />
        <td colSpan={KOLONNER - 1} style={{ paddingLeft: innrykk * 16 }}>
          {apen ? (
            <input
              className="leggtil-inn ark-nytt-omrade-inn"
              autoFocus
              placeholder={forelderId ? 'Navn på underområdet, f.eks. «Stue»' : 'Navn på området, f.eks. «Kjøkken» eller «1. etasje»'}
              onKeyDown={e => {
                const v = e.currentTarget.value.trim()
                if (e.key === 'Enter' && v) { lukk(); void skriv(() => nyttOmrade(hode.id, v, forelderId)) }
                if (e.key === 'Escape') lukk()
              }}
              onBlur={e => {
                const v = e.currentTarget.value.trim()
                lukk()
                if (v) void skriv(() => nyttOmrade(hode.id, v, forelderId))
              }}
            />
          ) : (
            <button type="button" className="ark-nytt-omrade-knapp" disabled={jobber}
              onClick={() => { if (forelderId === null) setNyttRot(true); else setNyttUnder(forelderId) }}>
              <FolderPlus size={14} strokeWidth={1.8} />
              {innhold.omrader.length === 0 ? 'Del opp i områder, f.eks. Kjøkken og Bad' : 'Nytt område'}
            </button>
          )}
        </td>
      </tr>
    )
  }

  const alleMerket = rekkefolge.length > 0 && rekkefolge.every(id => valgte.has(id))
  const mangler = [
    !hode.title.trim() ? 'tittel' : null,
    !hode.customer_name ? 'kunde' : null,
    sum.linjer.length === 0 ? 'linjer' : null,
  ].filter((m): m is string => !!m)
  const tom = sum.linjer.length === 0 && innhold.omrader.length === 0

  return (
    <div className="detalj-kropp ark-kropp">
      {/* Handlingene over arket: det som gjøres MED dokumentet, ikke i det. */}
      <div className="ark-topp">
        <Merke stil={STIL[hode.visning]}>{tilbudStatusLabel[hode.visning]}</Merke>
        <span className="dempet-mer">{hode.quote_number != null ? `Tilbud #${hode.quote_number}` : 'Uten nummer ennå'}</span>
        <span style={{ flex: 1 }} />
        {seDb && redigerbar ? (
          <Kalkylemeny
            visInnsiden={visInnsiden}
            setVisInnsiden={setVisInnsiden}
            paslag={hode.default_markup_percent}
            jobber={jobber}
            onPaslag={pr => void skriv(() => endreTilbud(hode.id, { default_markup_percent: pr }))}
            onOppdaterAlle={() => oppdaterPaslag(hode.default_markup_percent)}
          />
        ) : null}
        <Knapp stil="stille" onClick={() => void skrivUtTilbud(hode.id).catch(e => setFeil(e instanceof Error ? e.message : String(e)))}>
          <Printer size={15} strokeWidth={1.8} /> Forhåndsvis
        </Knapp>
        {detalj.redigerbar && kanSkrive ? (
          <Knapp stil="primar" disabled={jobber || mangler.length > 0}
            title={mangler.length > 0 ? `Mangler ${mangler.join(', ')}` : 'Låser tilbudet som dokument og starter fristen'}
            onClick={() => void skriv(() => markerSendt(hode.id))}>
            <Send size={15} strokeWidth={1.8} /> Marker som sendt
          </Knapp>
        ) : null}
        {hode.status === 'sendt' && kanSkrive ? (
          <Knapp stil="naken" disabled={jobber} onClick={() => void skriv(() => angreSendt(hode.id))}>
            Angre «sendt» og rediger videre
          </Knapp>
        ) : null}
      </div>

      {/* Innsiden: det kunden ikke får, på én linje over arket. */}
      {seDb && sum.linjer.length > 0 ? (
        <div className={dbTap ? 'ark-innsiden tap' : 'ark-innsiden'} title="Står aldri på arket. Kunden ser bare tallene under.">
          <span className="ark-innsiden-merke">Bare for deg</span>
          <span>Materiell <b>{formatKr(materiell)}</b></span>
          <span>Arbeid <b>{formatKr(arbeid)}</b></span>
          <span>Kost <b>{formatKr(sum.kostOre)}</b></span>
          {sum.dbOre !== null ? (
            <span>Dekningsbidrag <b>{formatKr(sum.dbOre)}</b>{sum.dbProsent !== null ? ` · ${sum.dbProsent.toFixed(1).replace('.', ',')} %` : ''}</span>
          ) : <span className="dempet-mer">Dekningsbidrag: ingen kost ført</span>}
        </div>
      ) : null}

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
      {!detalj.redigerbar ? (
        <Beskjed stil="varsel">
          Tilbudet er {tilbudStatusLabel[hode.visning].toLowerCase()} og kan ikke endres. Det er
          dokumentet kunden har fått. Skal noe rettes, lag en kopi.
          {sum.antallTilvalg > 0 && kanVelgeTilvalg ? ' Tilvalgene kan fortsatt krysses av til kunden har svart.' : ''}
        </Beskjed>
      ) : null}

      {redigerbar && valgte.size > 0 ? (
        <div className="utvalg-linje">
          <span className="utvalg-tall">{stk(valgte.size, 'linje', 'linjer')} merket</span>
          <select className="celle-inn" value="" disabled={jobber} title="Flytt til område"
            onChange={e => { if (e.target.value !== '') paaUtvalg({ section_id: e.target.value === '-' ? null : e.target.value }) }}>
            <option value="">Flytt til …</option>
            <option value="-">Uten område</option>
            {omrader.map(o => <option key={o.id} value={o.id}>{o.navn}</option>)}
          </select>
          {seDb ? (
            <>
              <input className="celle-inn" inputMode="decimal" placeholder="Påslag %" value={utvalgPaslag}
                onChange={e => setUtvalgPaslag(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') oppdaterPaslag(somTall(utvalgPaslag), valgte) }} />
              <Knapp stil="stille" disabled={jobber || somTall(utvalgPaslag) === null} onClick={() => oppdaterPaslag(somTall(utvalgPaslag), valgte)}>
                Bruk påslag
              </Knapp>
            </>
          ) : null}
          <Knapp stil="stille" disabled={jobber} onClick={() => paaUtvalg({ price_locked: true })}><Lock size={13} strokeWidth={2} /> Lås pris</Knapp>
          <Knapp stil="stille" disabled={jobber} onClick={() => paaUtvalg({ is_optional: true, is_selected: false })}>Gjør til tilvalg</Knapp>
          <Knapp stil="stille" disabled={jobber}
            onClick={() => {
              const navn = window.prompt('Hva skal pakken hete? F.eks. «Dobbel stikkontakt» eller «Bad, standard»')
              if (!navn?.trim()) return
              void skriv(async () => { await lagrePakke(navn, merkede); setPakker(await hentPakker()) })
            }}>
            <Boxes size={13} strokeWidth={2} /> Lagre som pakke
          </Knapp>
          <Knapp stil="fare" disabled={jobber}
            onClick={() => { if (window.confirm(`Slette ${stk(valgte.size, 'linja', 'linjene')}?`)) void skriv(() => slettLinjer(ids)) }}>
            <Trash2 size={13} strokeWidth={2} /> Slett
          </Knapp>
          <Knapp stil="naken" onClick={() => setValgte(new Set())}>Avbryt</Knapp>
        </div>
      ) : null}

      <div className="ark-ramme">
        {/* ── Arket: det kunden får ── */}
        <div className="tilbudsark">
          <div className="ark-brevhode">
            <div>
              <div className="ark-firma">{firma?.navn ?? ' '}</div>
              {firma?.orgnr ? <div className="ark-firma-detalj">Org.nr {firma.orgnr}</div> : null}
            </div>
            <div className="ark-hoyre">
              <div className="ark-doktype">Tilbud {hode.quote_number != null ? `#${hode.quote_number}` : ''}</div>
              <div className="ark-meta">{dato(hode.sent_at ?? new Date().toISOString())}</div>
            </div>
          </div>

          <div className="ark-tittel">
            <Celle tekst kol="tittel" laast={!redigerbar} verdi={hode.title} plassholder="Hva gjelder tilbudet? F.eks. «Rehabilitering Bjørndalen 12»"
              onLagre={v => void skriv(() => endreTilbud(hode.id, { title: v.trim() }))} />
          </div>

          <div className="ark-partier">
            <div className="ark-parti">
              <div className="ark-merke">Kunde</div>
              {redigerbar ? (
                <select
                  className="ark-inline-select"
                  value={hode.customer_id ?? ''}
                  onFocus={() => { if (kunder.length === 0) void hentKunder('').then(setKunder).catch(() => {}) }}
                  onMouseDown={() => { if (kunder.length === 0) void hentKunder('').then(setKunder).catch(() => {}) }}
                  onChange={e => {
                    const k = kunder.find(x => x.id === e.target.value)
                    // Snapshot, ikke peker: tilbudet skal kunne leses uendret om
                    // kunderegisteret rettes etterpå.
                    void skriv(() => endreTilbud(hode.id, {
                      customer_id: k?.id ?? null, customer_name: k?.name ?? null,
                      customer_phone: k?.phone ?? null, address: k?.address ?? hode.address,
                    }))
                  }}
                >
                  <option value="">{hode.customer_name ?? 'Velg kunde …'}</option>
                  {kunder.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              ) : <div>{hode.customer_name ?? <span className="dempet-mer">Ingen kunde</span>}</div>}
              <div className="ark-firma-detalj">
                <Celle tekst kol="adresse" laast={!redigerbar} verdi={hode.address ?? ''} plassholder="Arbeidssted (tomt = kundens adresse)"
                  onLagre={v => void skriv(() => endreTilbud(hode.id, { address: v.trim() || null }))} />
              </div>
            </div>
            <div className="ark-parti ark-parti-smal">
              <div className="ark-merke">Gyldig til</div>
              {redigerbar ? (
                <input type="date" className="ark-inline-dato"
                  defaultValue={hode.valid_until ? hode.valid_until.slice(0, 10) : ''}
                  key={`gyldig-${hode.valid_until ?? ''}`}
                  onBlur={e => {
                    const v = e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null
                    if (v !== hode.valid_until) void skriv(() => endreTilbud(hode.id, { valid_until: v }))
                  }} />
              ) : <div>{dato(hode.valid_until)}</div>}
            </div>
            {/* Svaret først (Stripe): det kunden lurer på, øverst til høyre. */}
            <div className="ark-parti ark-parti-smal ark-parti-total">
              <div className="ark-merke">Totalt inkl. mva</div>
              <div className="ark-total">{formatKr(sum.bruttoOre)} kr</div>
            </div>
          </div>

          {/* Tilbudsbrevet står øverst i dokumentet, over linjene — så det gjør det her også. */}
          {redigerbar ? (
            <textarea
              className="ark-brev"
              rows={2}
              defaultValue={hode.description ?? ''}
              key={`brev-${hode.id}`}
              placeholder="Beskriv jobben: hva som skal gjøres, hva som er forutsatt og hva som ikke er med."
              onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px` }}
              onBlur={e => {
                const v = e.target.value.trim() || null
                if (v !== hode.description) void skriv(() => endreTilbud(hode.id, { description: v }))
              }}
            />
          ) : hode.description ? <div className="ark-brev-tekst">{hode.description}</div> : null}

          <table className="ark-tabell">
            <thead>
              <tr>
                <th className="avkryss">
                  {redigerbar && rekkefolge.length > 0 ? (
                    <input type="checkbox" checked={alleMerket} title="Merk alle"
                      onChange={e => setValgte(e.target.checked ? new Set(rekkefolge) : new Set())} />
                  ) : null}
                </th>
                {/* 100 %: beskrivelsen tar alt de andre kolonnene ikke trenger. */}
                <th style={{ width: '100%' }}>Beskrivelse</th>
                <th className="tall">Antall</th>
                <th className="tall">Enhetspris</th>
                <th className="tall">Beløp</th>
                <th className="verktoy" />
              </tr>
            </thead>
            <tbody>
              {tom && redigerbar ? (
                <tr className="ark-tom"><td /><td colSpan={KOLONNER - 1}>
                  Tilbudet er tomt. Skriv en vare eller et arbeid på linja under, eller del opp i områder først.
                </td></tr>
              ) : null}
              {innhold.utenOmrade.map((l, i) => linjerad(l, innhold.utenOmrade, i, 0))}
              {redigerbar && (innhold.utenOmrade.length > 0 || innhold.omrader.length === 0) ? leggTilRad(null, '', 0) : null}
              {innhold.omrader.map(o => (
                <Fragment key={o.id}>
                  {omraderad(o)}
                  {o.linjer.map((l, i) => linjerad(l, o.linjer, i, o.niva + 1))}
                  {redigerbar ? leggTilRad(o.id, o.navn || 'området', o.niva + 1) : null}
                  {redigerbar && nyttUnder === o.id ? nyttOmradeRad(o.id, o.niva + 1) : null}
                </Fragment>
              ))}
              {redigerbar ? nyttOmradeRad(null, 0) : null}
              {!redigerbar && tom ? (
                <tr><td colSpan={KOLONNER} className="dempet">Ingen linjer.</td></tr>
              ) : null}
            </tbody>
          </table>

          {/* Summen: høyre halvdel, hårlinjer, tyngre strek over totalen (Stripe). */}
          <div className="ark-summer">
            <div className="ark-sumrad"><span>Sum eks. mva</span><span>{formatKr(sum.nettoOre)}</span></div>
            {sum.rabattOre > 0 ? (
              <div className="ark-sumrad"><span>Herav rabatt</span><span>−{formatKr(sum.rabattOre)}</span></div>
            ) : null}
            {sum.mvaFordeling.map(f => (
              <div className="ark-sumrad" key={f.mva}><span>Mva {mvaLabel[f.mva as keyof typeof mvaLabel] ?? ''}</span><span>{formatKr(f.mvaOre)}</span></div>
            ))}
            <div className="ark-sumrad ark-sumrad-total"><span>Totalt inkl. mva</span><span>{formatKr(sum.bruttoOre)} kr</span></div>
            {sum.tilvalgUtenforOre > 0 ? (
              <div className="ark-sumrad ark-sumrad-tilvalg"><span>Tilvalg som kan legges til, eks. mva</span><span>{formatKr(sum.tilvalgUtenforOre)}</span></div>
            ) : null}
          </div>

          {hode.valid_until ? (
            <div className="ark-gyldighet">Tilbudet er gyldig til og med {DATO_LANG.format(new Date(hode.valid_until))}.</div>
          ) : null}

          <div className="ark-bunn">
            <span>Tilbud{hode.quote_number != null ? ` #${hode.quote_number}` : ''}</span>
            <span>{firma?.navn ?? ''}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Menyene ────────────────────────────────────────────────────────────── */

/**
 * «⋯» ytterst på raden. Før var det tre ikonknapper (opp, ned, slett) som
 * dukket opp på hver rad; nå er alt man kan gjøre med linja ett sted, med ord.
 */
function Radmeny({ valg, disabled }: {
  valg: { tekst: string; gjor: () => void; av?: boolean; fare?: boolean }[]
  disabled: boolean
}) {
  const [apen, setApen] = useState(false)
  const boks = useRef<HTMLDivElement>(null)
  useKlikkUtenfor(boks, useCallback(() => setApen(false), []))
  const oppover = useOppover(boks, apen)
  return (
    <div className="radmeny" ref={boks} data-apen={apen}>
      <button type="button" className="ikonknapp" title="Mer" disabled={disabled} onClick={() => setApen(a => !a)}>
        <MoreHorizontal size={15} strokeWidth={2} />
      </button>
      {apen ? (
        <div className={oppover ? 'nedtrekk radmeny-liste oppover' : 'nedtrekk radmeny-liste'}>
          {valg.map(v => (
            <button key={v.tekst} type="button" className={v.fare ? 'nedtrekk-rad radmeny-fare' : 'nedtrekk-rad'}
              disabled={v.av} onClick={() => { setApen(false); v.gjor() }}>
              <span className="nedtrekk-navn">{v.tekst}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Kalkylen: påslag og kost, samlet bak én knapp over arket. */
function Kalkylemeny({ visInnsiden, setVisInnsiden, paslag, jobber, onPaslag, onOppdaterAlle }: {
  visInnsiden: boolean
  setVisInnsiden: (v: boolean) => void
  paslag: number | null
  jobber: boolean
  onPaslag: (p: number | null) => void
  onOppdaterAlle: () => void
}) {
  const [apen, setApen] = useState(false)
  const boks = useRef<HTMLDivElement>(null)
  useKlikkUtenfor(boks, useCallback(() => setApen(false), []))
  return (
    <div className="radmeny" ref={boks}>
      <Knapp stil="stille" onClick={() => setApen(a => !a)}>
        <Calculator size={15} strokeWidth={1.8} /> Kalkyle
      </Knapp>
      {apen ? (
        <div className="nedtrekk kalkylemeny">
          <label className="kalkylemeny-rad">
            <input type="checkbox" checked={visInnsiden} onChange={e => setVisInnsiden(e.target.checked)} />
            Vis kost og påslag på linjene
          </label>
          <label className="kalkylemeny-rad" title="Påslag i % av kost. Brukes på varer uten egen pris, og av «Oppdater alle priser».">
            Standard påslag
            <input
              className="celle-inn kalkylemeny-tall"
              inputMode="decimal"
              defaultValue={tallTekst(paslag)}
              key={`paslag-${paslag ?? ''}`}
              onBlur={e => { const p = somTall(e.target.value); if (p !== paslag) onPaslag(p) }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
            %
          </label>
          <Knapp stil="stille" disabled={jobber || paslag === null}
            title="Setter pris = kost + påslag på alle linjer med kost som ikke er låst"
            onClick={() => { onOppdaterAlle(); setApen(false) }}>
            Oppdater alle priser med påslaget
          </Knapp>
        </div>
      ) : null}
    </div>
  )
}

export function Tilbud() {
  const { profil } = useAuth()
  const rolle = profil?.role ?? null
  const kanSkrive = kan(rolle, 'tilbud.skriv')
  const seDb = kan(rolle, 'db.les')

  const [rader, setRader] = useState<Rad[]>([])
  const [sok, setSok] = useState('')
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const [valgt, setValgt] = useState<string | null>(null)
  const [detalj, setDetalj] = useState<Tilbudsdetalj | null>(null)
  const [oppretter, setOppretter] = useState(false)

  const last = useCallback(async () => {
    const [liste, d] = await Promise.all([
      hentTilbud(),
      valgt ? hentTilbudsdetalj(valgt) : Promise.resolve(null),
    ])
    setRader(liste)
    setDetalj(d)
  }, [valgt])

  useEffect(() => {
    setLaster(true)
    last()
      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
      .finally(() => setLaster(false))
  }, [last])

  const synlige = useMemo(() => {
    const s = sok.trim().toLowerCase()
    if (!s) return rader
    return rader.filter(t =>
      [t.title, t.customer_name, t.quote_number != null ? String(t.quote_number) : null]
        .some(v => v?.toLowerCase().includes(s)),
    )
  }, [rader, sok])

  const per = (s: TilbudStatus) => rader.filter(t => t.visning === s)
  const sum = (liste: Rad[]) => liste.reduce((n, t) => n + t.bruttoOre, 0)
  const utlopt = per('utlopt')

  /** Nytt tilbud er et blankt ark som åpner med én gang — det fylles ut PÅ arket. */
  async function nytt() {
    setOppretter(true)
    setFeil(null)
    try {
      const id = await opprettTilbud({ tittel: '', kundeId: null, kundeNavn: null, kundeTelefon: null, adresse: null, gyldigDager: GYLDIGHET_DAGER })
      setValgt(id)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setOppretter(false)
    }
  }

  return (
    <>
      <Sidehode
        tittel="Tilbud"
        under={laster
          ? 'Henter …'
          : `${formatKr(sum(per('sendt')))} kr ute hos kunden · ${formatKr(sum(per('akseptert')))} kr akseptert${utlopt.length > 0 ? ` · ${stk(utlopt.length, 'utløpt', 'utløpte')}` : ''}`}
        handling={
          <>
            <div style={{ width: 250 }}>
              <Felt placeholder="Søk tilbudsnummer, kunde, tittel …" value={sok} onChange={e => setSok(e.target.value)} />
            </div>
            {kanSkrive ? (
              <Knapp stil="merke" disabled={oppretter} onClick={() => void nytt()}>
                {oppretter ? 'Lager …' : 'Nytt tilbud'}
              </Knapp>
            ) : null}
          </>
        }
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="arbeidsflate arbeidsflate-tilbud">
        <Delt valgt={!!valgt} tilbake={() => setValgt(null)}>
          <div className="liste">
            <div className="liste-kropp">
              {synlige.length === 0 && !laster ? (
                <div className="tomt-mykt">
                  <p>{sok ? 'Ingen tilbud passer søket' : 'Ingen tilbud ennå'}</p>
                </div>
              ) : (
                synlige.map(t => (
                  <button key={t.id} className="ordrerad" aria-selected={t.id === valgt} onClick={() => setValgt(t.id)}>
                    <div className="ordrerad-topp">
                      <span className="ordrerad-nr">{t.quote_number != null ? `#${t.quote_number}` : '—'}</span>
                      <span className="ordrerad-tittel">{t.title || 'Uten tittel'}</span>
                    </div>
                    <div className="ordrerad-bunn">
                      <span className="ordrerad-kunde">{t.customer_name || 'Ingen kunde'}</span>
                      <span className="ordrerad-dato">{formatKr(t.bruttoOre)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="detalj">
            {!valgt ? (
              <div className="tomt-mykt"><p>Velg et tilbud, eller lag et nytt</p></div>
            ) : !detalj ? (
              <div className="tomt-mykt"><p>Henter tilbudet …</p></div>
            ) : (
              <Ark key={detalj.hode.id} detalj={detalj} kanSkrive={kanSkrive} seDb={seDb} etterSkriving={last} />
            )}
          </div>
        </Delt>
      </div>
    </>
  )
}
