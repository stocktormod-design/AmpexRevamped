import { formatKr, tilOre } from '@delt/invoicing'
import { kan } from '@delt/kontor-tilgang'
import {
  anvendPaslag, foreslaaPris, paslagProsent, prisFraPaslagOre, tilbudStatusLabel,
  type OmradeSum, type Tilbudslinje, type TilbudslinjeArt, type TilbudStatus,
} from '@delt/quoting'
import { Boxes, ChevronDown, ChevronUp, FolderPlus, Lock, Plus, Printer, Send, Trash2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAuth } from '@/auth'
import { hentFirma, hentKunder, hentTilbud, type Kunde, type Tilbud as Rad } from '@/lib/kontor-lager'
import {
  angreSendt, byttPlass, endreLinje, endreLinjer, endreOmradenavn, endreTilbud, GYLDIGHET_DAGER,
  hentPakker, hentTilbudsdetalj, lagrePakke, linjeSomInn, markerSendt, nyLinje, nyttOmrade,
  opprettTilbud, settInnPakke, skrivPriser, skrivUtTilbud, slettLinje, slettLinjer, slettOmrade,
  slettPakke, sokVarer, type Linjerad, type Pakke, type Tilbudsdetalj, type Varetreff,
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
function Celle({ verdi, onLagre, bredde, tekst, laast, kol, onSisteRad, plassholder, klasse }: {
  verdi: string
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
  useEffect(() => { setUtkast(verdi) }, [verdi])

  if (laast) {
    return <span className={klasse}>{verdi || (plassholder ? <span className="dempet-mer">{plassholder}</span> : '—')}</span>
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
      value={utkast}
      placeholder={plassholder}
      inputMode={tekst ? 'text' : 'decimal'}
      onChange={e => setUtkast(e.target.value)}
      onFocus={e => e.target.select()}
      onBlur={() => { if (utkast !== verdi) onLagre(utkast) }}
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

/* ── Varesøket ──────────────────────────────────────────────────────────── */

/**
 * Katalogen rett på arket. Skriv el-nummer eller navn, pil ned, Enter. Enter
 * uten treff legger til teksten som en egen vare (Cordel «skaffevare»).
 */
function Varesok({ disabled, placeholder, onVelg, onFritekst }: {
  disabled: boolean
  placeholder: string
  onVelg: (v: Varetreff) => void
  onFritekst: (tekst: string) => void
}) {
  const [sok, setSok] = useState('')
  const [treff, setTreff] = useState<Varetreff[]>([])
  const [apen, setApen] = useState(false)
  const [aktiv, setAktiv] = useState(0)
  const teller = useRef(0)
  const boks = useRef<HTMLDivElement>(null)
  useKlikkUtenfor(boks, useCallback(() => setApen(false), []))

  useEffect(() => {
    if (sok.trim().length < 2) { setTreff([]); setApen(false); return }
    const id = window.setTimeout(async () => {
      const mitt = ++teller.current
      try {
        const r = await sokVarer(sok)
        if (mitt !== teller.current) return
        setTreff(r)
        setAktiv(0)
        setApen(true)
      } catch {
        // Søket er en hjelp, ikke en handling — feiler det, står fritekst igjen.
      }
    }, 200)
    return () => window.clearTimeout(id)
  }, [sok])

  function velg(v: Varetreff) {
    onVelg(v)
    setSok('')
    setTreff([])
    setApen(false)
  }

  return (
    <div className="varesok" ref={boks}>
      <input
        className="felt-inn"
        placeholder={placeholder}
        value={sok}
        disabled={disabled}
        onChange={e => setSok(e.target.value)}
        onFocus={() => { if (treff.length > 0) setApen(true) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && treff.length > 0) { e.preventDefault(); setApen(true); setAktiv(a => Math.min(a + 1, treff.length - 1)) }
          else if (e.key === 'ArrowUp' && treff.length > 0) { e.preventDefault(); setAktiv(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') {
            e.preventDefault()
            if (apen && treff[aktiv]) velg(treff[aktiv])
            else if (sok.trim()) { onFritekst(sok.trim()); setSok('') }
          }
          else if (e.key === 'Escape') setApen(false)
        }}
      />
      {apen ? (
        <div className="nedtrekk">
          {treff.length === 0 ? (
            <div className="nedtrekk-hjelp">Ingen treff i katalogen. Enter legger til «{sok.trim()}» som egen vare.</div>
          ) : treff.map((v, i) => (
            <button
              key={v.id}
              type="button"
              className="nedtrekk-rad"
              aria-selected={i === aktiv}
              onMouseEnter={() => setAktiv(i)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => velg(v)}
            >
              <span className="nedtrekk-navn">{v.name}</span>
              <span className="nedtrekk-tall">{v.unit_price !== null ? `${formatKr(tilOre(v.unit_price))} kr` : v.cost_price !== null ? `kost ${formatKr(tilOre(v.cost_price))}` : ''}</span>
              <span className="nedtrekk-meta">{[v.elnummer, v.unit].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ── Pakkene ────────────────────────────────────────────────────────────── */

function Pakkemeny({ pakker, disabled, onSettInn, onSlett }: {
  pakker: Pakke[]
  disabled: boolean
  onSettInn: (p: Pakke, antall: number) => void
  onSlett: (p: Pakke) => void
}) {
  const [apen, setApen] = useState(false)
  const [antall, setAntall] = useState<Record<string, string>>({})
  const boks = useRef<HTMLDivElement>(null)
  useKlikkUtenfor(boks, useCallback(() => setApen(false), []))

  return (
    <div className="pakkemeny" ref={boks} style={{ position: 'relative' }}>
      <button type="button" className="knapp knapp-naken" disabled={disabled} onClick={() => setApen(a => !a)}>
        <Boxes size={14} strokeWidth={1.8} /> Pakke
      </button>
      {apen ? (
        <div className="nedtrekk" style={{ minWidth: 340, right: 0, left: 'auto' }}>
          {pakker.length === 0 ? (
            <div className="nedtrekk-hjelp">
              Ingen pakker ennå. Merk linjene som hører sammen — f.eks. en dobbel stikkontakt med
              kabel og montasje — og velg «Lagre som pakke».
            </div>
          ) : pakker.map(p => (
            <div key={p.id} className="nedtrekk-rad" style={{ cursor: 'default' }}>
              <span className="nedtrekk-navn">{p.name}</span>
              <span className="nedtrekk-verktoy">
                <input
                  className="celle-inn"
                  inputMode="decimal"
                  value={antall[p.id] ?? '1'}
                  title="Antall pakker"
                  onChange={e => setAntall(a => ({ ...a, [p.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { onSettInn(p, somTall(antall[p.id] ?? '1') ?? 1); setApen(false) } }}
                />
                <button className="knapp knapp-stille" type="button" style={{ height: 26, padding: '0 10px' }}
                  onClick={() => { onSettInn(p, somTall(antall[p.id] ?? '1') ?? 1); setApen(false) }}>
                  Sett inn
                </button>
                <button className="ikonknapp" type="button" title="Slett pakken" style={{ width: 24, height: 24 }}
                  onClick={() => { if (window.confirm(`Slette pakken «${p.name}»?`)) onSlett(p) }}>
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              </span>
              <span className="nedtrekk-meta">{stk(p.linjer.length, 'linje', 'linjer')}: {p.linjer.map(l => l.beskrivelse).join(', ')}</span>
            </div>
          ))}
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

  const KOLONNER = 5 // avkryss, beskrivelse, spesifikasjon, beløp, verktøy

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
            <input type="checkbox" checked={merket} title="Merk linja (shift for et område)"
              onClick={e => merk(l.id, e.shiftKey)} onChange={() => {}} />
          ) : null}
        </td>

        {l.art === 'tekst' ? (
          <td colSpan={2} style={{ paddingLeft: innrykk * 16 }}>
            <Celle tekst kol="navn" laast={!redigerbar} verdi={l.beskrivelse} klasse="ark-tekst"
              plassholder="Overskrift eller forbehold"
              onLagre={v => void skriv(() => endreLinje(l.id, { description: v }))}
              onSisteRad={() => leggTil('tekst', rad.section_id)} />
          </td>
        ) : (
          <>
            <td style={{ paddingLeft: innrykk * 16 }}>
              <Celle tekst kol="navn" laast={!redigerbar} verdi={l.beskrivelse} klasse="ark-navn"
                plassholder="Hva linja gjelder"
                onLagre={v => void skriv(() => endreLinje(l.id, { description: v }))}
                onSisteRad={() => leggTil(l.art, rad.section_id)} />
              {l.elnummer ? <div className="ark-hjelp">El-nr {l.elnummer}</div> : null}
            </td>
            <td className="tall">
              {/* Spesifikasjonen slik den står på arket: «12 stk × 249,00 − 10 %» — bare at tallene kan tastes. */}
              <span className="spes">
                <Celle kol="antall" bredde={44} laast={!redigerbar} verdi={tallTekst(rad.quantity)}
                  onLagre={v => void skriv(() => endreLinje(l.id, { quantity: somTall(v) }))} />
                <Celle tekst kol="enhet" bredde={34} laast={!redigerbar} verdi={rad.unit ?? ''}
                  onLagre={v => void skriv(() => endreLinje(l.id, { unit: v.trim() || null }))} />
                <span className="spes-tegn">×</span>
                {l.prisLaast ? <span className="laas-ikon" title="Låst pris — «oppdater påslag» rører ikke linja"><Lock size={11} strokeWidth={2} /></span> : null}
                <Celle kol="pris" bredde={66} laast={!redigerbar} verdi={tallTekst(rad.unit_price)}
                  onLagre={v => void skriv(() => endreLinje(l.id, { unit_price: somTall(v) }))} />
                {redigerbar || l.rabattProsent > 0 ? (
                  // Rabatten vises når den finnes; ellers dukker feltet opp når
                  // du er over raden. Et tomt «− %» på hver linje er støy på et ark.
                  <span className="spes-rabatt" data-har={l.rabattProsent > 0}>
                    <span className="spes-tegn">−</span>
                    <Celle kol="rabatt" bredde={34} laast={!redigerbar} verdi={tallTekst(rad.discount_percent)}
                      onLagre={v => void skriv(() => endreLinje(l.id, { discount_percent: somTall(v) }))} />
                    <span className="spes-tegn">%</span>
                  </span>
                ) : null}
              </span>
              {visInnsiden ? (
                <span className="innsiden">
                  kost
                  <Celle kol="kost" bredde={52} laast={!redigerbar} verdi={tallTekst(rad.cost_price)}
                    onLagre={v => void skriv(() => endreLinje(l.id, { cost_price: somTall(v) }))} />
                  · påslag
                  <Celle kol="paslag" bredde={44}
                    laast={!redigerbar || l.prisLaast || rad.cost_price === null || rad.cost_price <= 0}
                    verdi={paslag === null ? '' : tallTekst(paslag)}
                    onLagre={v => {
                      const p = somTall(v)
                      if (p === null || rad.cost_price === null) return
                      void skriv(() => endreLinje(l.id, { unit_price: prisFraPaslagOre(tilOre(rad.cost_price!), p) / 100 }))
                    }} />
                  %
                </span>
              ) : null}
            </td>
          </>
        )}

        <td className="tall ark-belop" style={{ color: tapt ? 'var(--rod)' : undefined }}>
          {l.art === 'tekst' ? null : (
            <>
              <div>{fravalgt ? <span className="sum-parentes">({formatKr(l.nettoOre)})</span> : formatKr(l.nettoOre)}</div>
              {l.valgfri ? (
                <button type="button" className="tilvalg-knapp" data-valgt={l.valgt}
                  disabled={!kanVelgeTilvalg || jobber}
                  title={kanVelgeTilvalg ? (l.valgt ? 'Kunden har valgt dette — klikk for å ta det ut' : 'Ikke medregnet — klikk når kunden sier ja') : 'Tilvalg'}
                  onClick={() => void skriv(() => endreLinje(l.id, { is_selected: !l.valgt }))}>
                  {l.valgt ? 'Tilvalg · valgt' : 'Tilvalg · ikke valgt'}
                </button>
              ) : null}
            </>
          )}
        </td>

        <td className="verktoy">
          {redigerbar ? (
            <div className="radverktoy">
              <button className="ikonknapp" title="Flytt opp" disabled={i === 0 || jobber}
                onClick={() => { const b = perId.get(gruppe[i - 1]?.id ?? ''); if (b) void skriv(() => byttPlass(rad, b)) }}>
                <ChevronUp size={13} strokeWidth={2} />
              </button>
              <button className="ikonknapp" title="Flytt ned" disabled={i === gruppe.length - 1 || jobber}
                onClick={() => { const b = perId.get(gruppe[i + 1]?.id ?? ''); if (b) void skriv(() => byttPlass(rad, b)) }}>
                <ChevronDown size={13} strokeWidth={2} />
              </button>
              <button className="ikonknapp" title="Slett linja" disabled={jobber}
                onClick={() => void skriv(() => slettLinje(l.id))}>
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
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
        <td style={{ paddingLeft: o.niva * 16 }}>
          <Celle tekst kol="omrade" laast={!redigerbar || !rad} verdi={o.navn} klasse="ark-omradenavn"
            plassholder="Område"
            onLagre={v => void skriv(() => endreOmradenavn(o.id, v))} />
          <div className="ark-hjelp">{stk(o.antallLinjer, 'linje', 'linjer')}</div>
        </td>
        <td className="tall">
          {visInnsiden && o.dbOre !== null
            ? <span className="innsiden">DB {formatKr(o.dbOre)}{o.dbProsent !== null ? ` · ${o.dbProsent.toFixed(0)} %` : ''}</span>
            : null}
        </td>
        <td className="tall ark-belop">{formatKr(o.nettoOre)}</td>
        <td className="verktoy">
          {redigerbar && rad ? (
            <div className="radverktoy">
              <button className="ikonknapp" title="Nytt underområde" disabled={jobber}
                onClick={() => { const navn = window.prompt(`Underområde i «${o.navn}»`); if (navn?.trim()) void skriv(() => nyttOmrade(hode.id, navn, o.id)) }}>
                <FolderPlus size={13} strokeWidth={2} />
              </button>
              <button className="ikonknapp" title="Slett området — linjene blir liggende" disabled={jobber}
                onClick={() => void skriv(() => slettOmrade(o.id, rad.forelderId))}>
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          ) : null}
        </td>
      </tr>
    )
  }

  /** «Legg til»-raden nederst i hvert område (Jobber «+ Add line items»). */
  function leggTilRad(sectionId: string | null, navn: string, innrykk: number) {
    return (
      <tr key={`${sectionId ?? 'rot'}-legg-til`} className="ark-legg-til">
        <td className="avkryss" />
        <td colSpan={KOLONNER - 1} style={{ paddingLeft: innrykk * 16 }}>
          <div className="legg-til">
            <Varesok
              disabled={jobber}
              placeholder={sectionId ? `Legg til i ${navn} — vare eller tekst, Enter` : 'Legg til — vare eller tekst, Enter'}
              onVelg={v => leggTilVare(v, sectionId)}
              onFritekst={tekst => leggTil('materiell', sectionId, tekst)}
            />
            <button type="button" className="knapp knapp-naken" disabled={jobber} onClick={() => leggTil('arbeid', sectionId)}>
              <Plus size={14} strokeWidth={1.8} /> Arbeid
            </button>
            <button type="button" className="knapp knapp-naken" disabled={jobber} onClick={() => leggTil('tekst', sectionId)}>
              <Plus size={14} strokeWidth={1.8} /> Tekst
            </button>
            <Pakkemeny
              pakker={pakker}
              disabled={jobber}
              onSettInn={(p, antall) => void skriv(() => settInnPakke(hode.id, p, antall, sectionId, hode.default_markup_percent))}
              onSlett={p => void skriv(async () => { await slettPakke(p.id); setPakker(await hentPakker()) })}
            />
          </div>
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

  return (
    <div className="detalj-kropp ark-kropp">
      {/* Handlingene over arket: det som gjøres MED dokumentet, ikke i det. */}
      <div className="ark-topp">
        <Merke stil={STIL[hode.visning]}>{tilbudStatusLabel[hode.visning]}</Merke>
        <span className="dempet-mer">{hode.quote_number != null ? `Tilbud #${hode.quote_number}` : 'Uten nummer ennå'}</span>
        <span style={{ flex: 1 }} />
        <Knapp stil="stille" onClick={() => void skrivUtTilbud(hode.id).catch(e => setFeil(e instanceof Error ? e.message : String(e)))}>
          <Printer size={15} strokeWidth={1.8} /> Forhåndsvis PDF
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

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
      {!detalj.redigerbar ? (
        <Beskjed stil="varsel">
          Tilbudet er {tilbudStatusLabel[hode.visning].toLowerCase()} og kan ikke endres. Det er
          dokumentet kunden har fått — skal noe rettes, lag en kopi.
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
          <Knapp stil="stille" disabled={jobber} onClick={() => paaUtvalg({ price_locked: false })}>Lås opp</Knapp>
          <Knapp stil="stille" disabled={jobber} onClick={() => paaUtvalg({ is_optional: true, is_selected: false })}>Gjør til tilvalg</Knapp>
          <Knapp stil="stille" disabled={jobber} onClick={() => paaUtvalg({ is_optional: false })}>Ikke tilvalg</Knapp>
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

      <div className={seDb ? 'ark-ramme ark-ramme-med-rail' : 'ark-ramme'}>
        {/* ── Arket: det kunden får ── */}
        <div className="tilbudsark">
          <div className="ark-brevhode">
            <div>
              <div className="ark-firma">{firma?.navn ?? ' '}</div>
              {firma?.orgnr ? <div className="ark-firma-detalj">Org.nr {firma.orgnr}</div> : null}
            </div>
            <div className="ark-hoyre">
              <div className="ark-doktype">Tilbud</div>
              <div className="ark-doknr">{hode.quote_number != null ? `#${hode.quote_number}` : '—'}</div>
              <div className="ark-meta">{dato(hode.sent_at ?? new Date().toISOString())}</div>
            </div>
          </div>

          <div className="ark-tittel">
            <Celle tekst kol="tittel" laast={!redigerbar} verdi={hode.title} plassholder="Hva tilbudet gjelder — f.eks. «Rehabilitering Bjørndalen 12»"
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
                <Celle tekst kol="adresse" laast={!redigerbar} verdi={hode.address ?? ''} plassholder="Arbeidssted — tomt betyr kundens egen adresse"
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
          </div>

          {/* Tilbudsbrevet står øverst i dokumentet, over linjene — så det gjør det her også. */}
          {redigerbar ? (
            <textarea
              className="ark-brev"
              rows={3}
              defaultValue={hode.description ?? ''}
              key={`brev-${hode.id}`}
              placeholder="Hva jobben går ut på, hva som er forutsatt, hva som ikke er med …"
              onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px` }}
              onBlur={e => {
                const v = e.target.value.trim() || null
                if (v !== hode.description) void skriv(() => endreTilbud(hode.id, { description: v }))
              }}
            />
          ) : hode.description ? <div className="ark-brev-tekst">{hode.description}</div> : null}

          <h2 className="ark-h2">Tilbudet omfatter</h2>
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
                <th className="tall">Spesifikasjon</th>
                <th className="tall">Beløp</th>
                <th className="verktoy" />
              </tr>
            </thead>
            <tbody>
              {innhold.utenOmrade.map((l, i) => linjerad(l, innhold.utenOmrade, i, 0))}
              {redigerbar && (innhold.utenOmrade.length > 0 || innhold.omrader.length === 0) ? leggTilRad(null, '', 0) : null}
              {innhold.omrader.map(o => (
                <Fragment key={o.id}>
                  {omraderad(o)}
                  {o.linjer.map((l, i) => linjerad(l, o.linjer, i, o.niva + 1))}
                  {redigerbar ? leggTilRad(o.id, o.navn || 'området', o.niva + 1) : null}
                </Fragment>
              ))}
              {!redigerbar && sum.linjer.length === 0 && innhold.omrader.length === 0 ? (
                <tr><td colSpan={KOLONNER} className="dempet">Ingen linjer.</td></tr>
              ) : null}

              {/* Summen, som på arket. */}
              <tr className="ark-sum ark-sum-forste"><td /><td colSpan={2} className="tall">Sum eks. mva</td><td className="tall">{formatKr(sum.nettoOre)}</td><td /></tr>
              {sum.rabattOre > 0 ? (
                <tr className="ark-sum"><td /><td colSpan={2} className="tall">Herav rabatt</td><td className="tall">−{formatKr(sum.rabattOre)}</td><td /></tr>
              ) : null}
              {sum.mvaFordeling.map(f => (
                <tr className="ark-sum" key={f.mva}><td /><td colSpan={2} className="tall">Mva av {formatKr(f.nettoOre)}</td><td className="tall">{formatKr(f.mvaOre)}</td><td /></tr>
              ))}
              <tr className="ark-sum ark-sum-total"><td /><td colSpan={2} className="tall">Totalt inkl. mva</td><td className="tall">{formatKr(sum.bruttoOre)}</td><td /></tr>
              {sum.tilvalgUtenforOre > 0 ? (
                <tr className="ark-sum"><td /><td colSpan={2} className="tall dempet-mer">Tilvalg som kan legges til, eks. mva</td><td className="tall dempet-mer">{formatKr(sum.tilvalgUtenforOre)}</td><td /></tr>
              ) : null}
            </tbody>
          </table>

          {hode.valid_until ? (
            <div className="ark-gyldighet">Tilbudet er gyldig til og med {DATO_LANG.format(new Date(hode.valid_until))}.</div>
          ) : null}

          <div className="ark-bunn">
            <span>Tilbud{hode.quote_number != null ? ` #${hode.quote_number}` : ''}</span>
            <span>{firma?.navn ?? ''}</span>
          </div>
        </div>

        {/* ── Innsiden: det kunden ikke får ── */}
        {seDb ? (
          <aside className="ark-rail">
            <div className="ark-rail-boks">
              <div className="ark-rail-tittel">Innsiden</div>
              <div className="sum-rad"><span>Materiell</span><span className="sum-verdi">{formatKr(materiell)}</span></div>
              <div className="sum-rad"><span>Arbeid</span><span className="sum-verdi">{formatKr(arbeid)}</span></div>
              <div className="sum-rad"><span>Kost</span><span className="sum-verdi">{formatKr(sum.kostOre)}</span></div>
              {sum.dbOre !== null ? (
                <>
                  <div className={dbTap ? 'sum-rad sum-rad-db tap' : 'sum-rad sum-rad-db'}>
                    <span>Dekningsbidrag</span>
                    <span className="sum-verdi">{formatKr(sum.dbOre)}</span>
                  </div>
                  {sum.dbProsent !== null ? (
                    <div className={dbTap ? 'sum-rad sum-rad-db tap' : 'sum-rad sum-rad-db'}>
                      <span>av salgsprisen</span>
                      <span className="sum-verdi">{sum.dbProsent.toFixed(1).replace('.', ',')} %</span>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="sum-rad dempet-mer"><span>Dekningsbidrag</span><span>ingen kost ført</span></div>
              )}
              <p className="ark-rail-hjelp">Står aldri på arket. Kunden ser bare tallene til venstre.</p>
            </div>
            {redigerbar ? (
              <div className="ark-rail-boks">
                <label className="kalkyle-innstilling" style={{ marginLeft: 0 }}>
                  <input type="checkbox" checked={visInnsiden} onChange={e => setVisInnsiden(e.target.checked)} />
                  Vis kost og påslag på linjene
                </label>
                <label className="kalkyle-innstilling" style={{ marginLeft: 0 }} title="Påslag i % av kost. Brukes på varer uten egen pris, og av «Oppdater alle».">
                  Standard påslag
                  <input
                    className="celle-inn"
                    inputMode="decimal"
                    defaultValue={tallTekst(hode.default_markup_percent)}
                    key={`paslag-${hode.default_markup_percent ?? ''}`}
                    onBlur={e => {
                      const p = somTall(e.target.value)
                      if (p !== hode.default_markup_percent) void skriv(() => endreTilbud(hode.id, { default_markup_percent: p }))
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  />
                  %
                </label>
                <Knapp stil="stille" disabled={jobber || hode.default_markup_percent === null}
                  title="Setter pris = kost + påslag på alle linjer med kost som ikke er låst"
                  onClick={() => oppdaterPaslag(hode.default_markup_percent)}>
                  Oppdater alle priser
                </Knapp>
                <Knapp stil="stille" disabled={jobber}
                  onClick={() => { const navn = window.prompt('Hva heter området? F.eks. «Kjøkken» eller «1. etasje»'); if (navn?.trim()) void skriv(() => nyttOmrade(hode.id, navn, null)) }}>
                  <FolderPlus size={15} strokeWidth={1.8} /> Nytt område
                </Knapp>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
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
