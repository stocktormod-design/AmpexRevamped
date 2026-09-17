import { formatKr, tilOre } from '@delt/invoicing'
import { kan } from '@delt/kontor-tilgang'
import {
  paslagProsent, prisFraPaslagOre, tilbudStatusLabel,
  type OmradeSum, type Tilbudslinje, type TilbudslinjeArt, type TilbudStatus,
} from '@delt/quoting'
import { ChevronDown, ChevronUp, FolderPlus, Plus, Trash2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import { hentTilbud, type Tilbud as Rad } from '@/lib/kontor-lager'
import {
  byttPlass, endreLinje, endreOmradenavn, hentTilbudsdetalj, nyLinje, nyttOmrade,
  slettLinje, slettOmrade, type Tilbudsdetalj,
} from '@/lib/tilbud-lager'
import { Beskjed, Felt, Knapp, Merke, Nokkeltall, Sidehode, stk } from '@/ui/kit'
import { Delt } from '@/ui/Delt'

/**
 * Tilbud — lista til venstre, KALKULASJONEN til høyre.
 *
 * Kalkulasjonen ligger på kontoret og ikke i appen, og det er ikke en
 * nedprioritering av telefonen: et tilbud på en enebolig er tolv rom, tre
 * etasjer og hundre linjer med kost, påslag og rabatt ved siden av hverandre.
 * Det er en skrivebordsjobb med et tastatur. Appen viser den ferdige
 * oppdelingen med sum per område, og fører timer og materiell på ordren
 * etterpå.
 *
 * Summen REGNES IKKE HER. `lib/quoting.ts` gjør det, den har `verify:quoting`,
 * og montørappen bruker den samme. Kontoret og telefonen skal aldri kunne
 * komme til to forskjellige svar på det samme tilbudet — det er beløpet kunden
 * har sagt ja til.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

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

/**
 * Én redigerbar celle.
 *
 * Verdien commit-es på blur og på Enter, ikke på hvert tastetrykk: en runde til
 * basen per tegn ville både vært støy og gjort at markøren hoppet når svaret
 * kom tilbake. Escape forlater cella uten å lagre.
 */
function Celle({ verdi, onLagre, bredde, suffiks, tekst, laast }: {
  verdi: string
  onLagre: (v: string) => void
  bredde?: number
  suffiks?: string
  tekst?: boolean
  laast?: boolean
}) {
  const [utkast, setUtkast] = useState(verdi)
  useEffect(() => { setUtkast(verdi) }, [verdi])

  if (laast) {
    return <span className={tekst ? '' : 'dempet'}>{verdi || '—'}{suffiks ? ` ${suffiks}` : ''}</span>
  }

  return (
    <input
      className="celle-inn"
      style={{ width: bredde, textAlign: tekst ? 'left' : 'right' }}
      value={utkast}
      inputMode={tekst ? 'text' : 'decimal'}
      onChange={e => setUtkast(e.target.value)}
      onBlur={() => { if (utkast !== verdi) onLagre(utkast) }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setUtkast(verdi); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}

const ARTNAVN: Record<TilbudslinjeArt, string> = {
  materiell: 'Materiell',
  arbeid: 'Arbeid',
  tekst: 'Tekst',
}

function Kalkulasjon({ detalj, kanSkrive, seDb, etterSkriving }: {
  detalj: Tilbudsdetalj
  kanSkrive: boolean
  seDb: boolean
  etterSkriving: () => Promise<void>
}) {
  const { hode, sum, innhold, omrader, linjer } = detalj
  const [feil, setFeil] = useState<string | null>(null)
  const [jobber, setJobber] = useState(false)
  const redigerbar = kanSkrive && detalj.redigerbar

  const perId = useMemo(() => new Map(linjer.map(l => [l.id, l])), [linjer])

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

  // Salgsverdien delt på materiell og arbeid. Spark kaller sine to tilsvarende
  // tall «Materialkost» og «Arbeidskost»; her står salgsprisen, fordi det er
  // den kunden betaler. Kosten vår står i DB-tallet ved siden av.
  const materiell = sum.linjer.filter(l => l.art === 'materiell').reduce((n, l) => n + l.nettoOre, 0)
  const arbeid = sum.linjer.filter(l => l.art === 'arbeid').reduce((n, l) => n + l.nettoOre, 0)

  function linjerad(l: Tilbudslinje, gruppe: Tilbudslinje[], i: number, innrykk: number) {
    const rad = perId.get(l.id)
    if (!rad) return null
    const paslag = paslagProsent(l.kostOre, l.enhetsprisOre)
    const tapt = l.kostOre !== null && l.nettoOre < l.kostOre

    return (
      <tr key={l.id}>
        <td style={{ paddingLeft: 10 + innrykk * 18 }}>
          <Celle
            tekst
            laast={!redigerbar}
            verdi={l.beskrivelse}
            onLagre={v => void skriv(() => endreLinje(l.id, { description: v }))}
          />
          <span className="dempet-mer valgbar">
            {' '}· {ARTNAVN[l.art]}{l.elnummer ? ` · ${l.elnummer}` : ''}
          </span>
        </td>

        {l.art === 'tekst' ? (
          <td className="dempet" colSpan={6} style={{ textAlign: 'right' }}>Teller ikke i summen</td>
        ) : (
          <>
            <td className="h">
              <Celle bredde={54} laast={!redigerbar} verdi={tallTekst(rad.quantity)}
                onLagre={v => void skriv(() => endreLinje(l.id, { quantity: somTall(v) }))} />
            </td>
            <td className="dempet">
              <Celle tekst bredde={44} laast={!redigerbar} verdi={rad.unit ?? ''}
                onLagre={v => void skriv(() => endreLinje(l.id, { unit: v.trim() || null }))} />
            </td>
            <td className="h">
              <Celle bredde={74} laast={!redigerbar} verdi={tallTekst(rad.cost_price)}
                onLagre={v => void skriv(() => endreLinje(l.id, { cost_price: somTall(v) }))} />
            </td>
            {/* Påslaget er ikke lagret — det er kost og pris som er det.
                Skrives det her, settes PRISEN. Slik tastes det i faget. */}
            <td className="h">
              <Celle
                bredde={54}
                laast={!redigerbar || rad.cost_price === null || rad.cost_price <= 0}
                verdi={paslag === null ? '' : tallTekst(paslag)}
                onLagre={v => {
                  const p = somTall(v)
                  if (p === null || rad.cost_price === null) return
                  const pris = prisFraPaslagOre(tilOre(rad.cost_price), p) / 100
                  void skriv(() => endreLinje(l.id, { unit_price: pris }))
                }}
              />
            </td>
            <td className="h">
              <Celle bredde={80} laast={!redigerbar} verdi={tallTekst(rad.unit_price)}
                onLagre={v => void skriv(() => endreLinje(l.id, { unit_price: somTall(v) }))} />
            </td>
            <td className="h">
              <Celle bredde={50} laast={!redigerbar} verdi={tallTekst(rad.discount_percent)}
                onLagre={v => void skriv(() => endreLinje(l.id, { discount_percent: somTall(v) }))} />
            </td>
          </>
        )}

        <td className="h" style={{ fontWeight: 500, color: tapt ? 'var(--rod)' : undefined }}>
          {l.art === 'tekst' ? '' : formatKr(l.nettoOre)}
        </td>

        <td style={{ width: 150 }}>
          {redigerbar ? (
            <div className="radverktoy">
              <select
                className="celle-inn"
                style={{ width: 92 }}
                value={rad.section_id ?? ''}
                onChange={e => void skriv(() => endreLinje(l.id, { section_id: e.target.value || null }))}
              >
                <option value="">Uten område</option>
                {omrader.map(o => <option key={o.id} value={o.id}>{o.navn}</option>)}
              </select>
              <button className="ikonknapp" title="Flytt opp" disabled={i === 0 || jobber}
                onClick={() => {
                  const b = perId.get(gruppe[i - 1]?.id ?? '')
                  if (b) void skriv(() => byttPlass(rad, b))
                }}>
                <ChevronUp size={13} strokeWidth={2} />
              </button>
              <button className="ikonknapp" title="Flytt ned" disabled={i === gruppe.length - 1 || jobber}
                onClick={() => {
                  const b = perId.get(gruppe[i + 1]?.id ?? '')
                  if (b) void skriv(() => byttPlass(rad, b))
                }}>
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
      <tr key={o.id} className="omraderad">
        <td style={{ paddingLeft: 10 + o.niva * 18, fontWeight: 600 }}>
          <Celle
            tekst
            laast={!redigerbar || !rad}
            verdi={o.navn}
            onLagre={v => void skriv(() => endreOmradenavn(o.id, v))}
          />
          <span className="dempet-mer"> · {o.antallLinjer === 1 ? '1 linje' : `${o.antallLinjer} linjer`}</span>
        </td>
        <td colSpan={6} className="dempet-mer" style={{ textAlign: 'right' }}>
          {seDb && o.dbOre !== null
            ? `DB ${formatKr(o.dbOre)}${o.dbProsent !== null ? ` · ${o.dbProsent.toFixed(0)} %` : ''}`
            : ''}
        </td>
        <td className="h" style={{ fontWeight: 600 }}>{formatKr(o.nettoOre)}</td>
        <td>
          {redigerbar && rad ? (
            <div className="radverktoy">
              <button className="ikonknapp" title="Nytt underområde" disabled={jobber}
                onClick={() => {
                  const navn = window.prompt(`Underområde i «${o.navn}»`)
                  if (navn?.trim()) void skriv(() => nyttOmrade(hode.id, navn, o.id))
                }}>
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

  function leggTil(kind: TilbudslinjeArt, sectionId: string | null) {
    void skriv(() => nyLinje(hode.id, {
      kind,
      sectionId,
      description: '',
      quantity: kind === 'tekst' ? null : 1,
    }))
  }

  return (
    <>
      <div className="hero">
        <div className="hero-topp">
          <span className="hero-nr">{hode.quote_number != null ? `#${hode.quote_number}` : 'Uten nummer'}</span>
          <Merke stil={STIL[hode.visning]}>{tilbudStatusLabel[hode.visning]}</Merke>
        </div>
        <h2 className="hero-tittel">{hode.title}</h2>
        <div className="hero-under">
          {[hode.customer_name ?? 'Ingen kunde', hode.address, `Gyldig til ${dato(hode.valid_until)}`]
            .filter(Boolean).join(' · ')}
        </div>
      </div>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
      {!detalj.redigerbar ? (
        <Beskjed stil="varsel">
          Tilbudet er {tilbudStatusLabel[hode.visning].toLowerCase()} og kan ikke endres. Det er
          dokumentet kunden har fått — skal noe rettes, lag en kopi.
        </Beskjed>
      ) : null}

      <Nokkeltall
        tall={[
          { navn: 'Materiell', verdi: `${formatKr(materiell)} kr` },
          { navn: 'Arbeid', verdi: `${formatKr(arbeid)} kr` },
          ...(seDb && sum.dbOre !== null
            ? [{
                navn: 'Dekningsbidrag',
                verdi: `${formatKr(sum.dbOre)} kr`,
                under: sum.dbProsent !== null ? `${sum.dbProsent.toFixed(1)} % av salgsprisen` : undefined,
                aksent: true,
              }]
            : []),
          { navn: 'Salgspris', verdi: `${formatKr(sum.nettoOre)} kr`, under: `${formatKr(sum.bruttoOre)} kr inkl. mva` },
        ]}
      />

      <table className="linjer kalkyle">
        <thead>
          <tr>
            <th>Navn</th>
            <th className="h" style={{ width: 70 }}>Ant.</th>
            <th style={{ width: 60 }}>Enhet</th>
            <th className="h" style={{ width: 90 }}>Kost</th>
            <th className="h" style={{ width: 70 }}>Påslag&nbsp;%</th>
            <th className="h" style={{ width: 96 }}>Pris</th>
            <th className="h" style={{ width: 66 }}>Rabatt&nbsp;%</th>
            <th className="h" style={{ width: 110 }}>Sum</th>
            <th style={{ width: 150 }} />
          </tr>
        </thead>
        <tbody>
          {innhold.utenOmrade.map((l, i) => linjerad(l, innhold.utenOmrade, i, 0))}
          {innhold.omrader.map(o => (
            <Fragment key={o.id}>
              {omraderad(o)}
              {o.linjer.map((l, i) => linjerad(l, o.linjer, i, o.niva + 1))}
              {redigerbar ? (
                <tr key={`${o.id}-legg-til`}>
                  <td colSpan={9} style={{ paddingLeft: 10 + (o.niva + 1) * 18 }}>
                    <button className="knapp knapp-naken" disabled={jobber}
                      onClick={() => leggTil('materiell', o.id)}>
                      <Plus size={13} strokeWidth={2} /> Legg til i {o.navn || 'området'}
                    </button>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
          {sum.linjer.length === 0 && innhold.omrader.length === 0 ? (
            <tr><td colSpan={9} className="dempet">Ingen linjer ennå.</td></tr>
          ) : null}
        </tbody>
      </table>

      {redigerbar ? (
        <div className="kalkyle-verktoy">
          <Knapp stil="stille" disabled={jobber} onClick={() => leggTil('materiell', null)}>
            <Plus size={15} strokeWidth={1.8} /> Materiell
          </Knapp>
          <Knapp stil="stille" disabled={jobber} onClick={() => leggTil('arbeid', null)}>
            <Plus size={15} strokeWidth={1.8} /> Arbeid
          </Knapp>
          <Knapp stil="stille" disabled={jobber} onClick={() => leggTil('tekst', null)}>
            <Plus size={15} strokeWidth={1.8} /> Tekst
          </Knapp>
          <Knapp stil="merke" disabled={jobber}
            onClick={() => {
              const navn = window.prompt('Hva heter området? F.eks. «Kjøkken» eller «1. etasje»')
              if (navn?.trim()) void skriv(() => nyttOmrade(hode.id, navn, null))
            }}>
            <FolderPlus size={15} strokeWidth={1.8} /> Nytt område
          </Knapp>
        </div>
      ) : null}

      <div className="sum">
        <div className="sum-rad">
          <span>Netto</span>
          <span className="sum-verdi">{formatKr(sum.nettoOre)}</span>
        </div>
        {sum.rabattOre > 0 ? (
          <div className="sum-rad">
            <span>Herav rabatt</span>
            <span className="sum-verdi">−{formatKr(sum.rabattOre)}</span>
          </div>
        ) : null}
        {sum.mvaFordeling.map(f => (
          <div className="sum-rad" key={f.mva}>
            <span>MVA av {formatKr(f.nettoOre)}</span>
            <span className="sum-verdi">{formatKr(f.mvaOre)}</span>
          </div>
        ))}
        <div className="sum-rad sum-rad-total">
          <span>Tilbudssum inkl. mva</span>
          <span className="sum-verdi">{formatKr(sum.bruttoOre)}</span>
        </div>
      </div>
    </>
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

  return (
    <>
      <Sidehode
        tittel="Tilbud"
        under={laster
          ? 'Henter …'
          : `${formatKr(sum(per('sendt')))} kr ute hos kunden · ${formatKr(sum(per('akseptert')))} kr akseptert${utlopt.length > 0 ? ` · ${stk(utlopt.length, 'utløpt', 'utløpte')}` : ''}`}
        handling={
          <div style={{ width: 250 }}>
            <Felt
              placeholder="Søk tilbudsnummer, kunde, tittel …"
              value={sok}
              onChange={e => setSok(e.target.value)}
            />
          </div>
        }
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="arbeidsflate">
        <Delt valgt={!!valgt} tilbake={() => setValgt(null)}>
          <div className="liste">
            <div className="liste-kropp">
              {synlige.length === 0 && !laster ? (
                <div className="tomt-mykt">
                  <p>{sok ? 'Ingen tilbud passer søket' : 'Ingen tilbud ennå'}</p>
                </div>
              ) : (
                synlige.map(t => (
                  <button
                    key={t.id}
                    className="ordrerad"
                    aria-selected={t.id === valgt}
                    onClick={() => setValgt(t.id)}
                  >
                    <div className="ordrerad-topp">
                      <span className="ordrerad-nr">{t.quote_number != null ? `#${t.quote_number}` : '—'}</span>
                      <span className="ordrerad-tittel">{t.title}</span>
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
              <div className="tomt-mykt"><p>Velg et tilbud</p></div>
            ) : !detalj ? (
              <div className="tomt-mykt"><p>Henter tilbudet …</p></div>
            ) : (
              <Kalkulasjon
                key={detalj.hode.id}
                detalj={detalj}
                kanSkrive={kanSkrive}
                seDb={seDb}
                etterSkriving={last}
              />
            )}
          </div>
        </Delt>
      </div>
    </>
  )
}
