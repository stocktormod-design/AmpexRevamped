import { dekodAnsi, parseEfoNelfo, type ParseResultat } from '@delt/pricefile/efo-nelfo'
import { Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { kan } from '@delt/kontor-tilgang'
import { useAuth } from '@/auth'
import {
  elnumreIFil,
  planleggImport,
  type ImportValg,
  type Plan,
  type PrisRad,
} from '@delt/pricefile/plan'
import { hentEksisterende, hentPrisferskhet, skrivImport, type Fremdrift, type Prisferskhet } from '@/lib/prisfil-lager'
import { antall, Beskjed, Felt, Knapp, Kort, kroner, Merke, Nokkeltall, Sidehode, stk, Tomt } from '@/ui/kit'
import { Tabell, type Kolonne } from '@/ui/Tabell'

/**
 * Prisfil-import.
 *
 * Dette er grunnen til at Ampex Desktop finnes i det hele tatt: montøren skal
 * ikke ut på web for å laste opp en grossistfil, og kontoret skal ikke måtte
 * gjøre det på en telefon.
 *
 * Tre steg, med vilje adskilt:
 *
 *   1. LES FILA. Skjer lokalt, uten nett. Avvikslista sier med én gang om vi
 *      har tolket noe feil.
 *   2. REGN UT. Henter alt vi allerede har på de samme el-numrene og viser hva
 *      importen VIL gjøre. Ingenting er skrevet.
 *   3. SKRIV.
 *
 * Grunnen til at steg 2 er sitt eget trykk er at det koster nett: en fil på
 * femti tusen linjer blir mange oppslag. Å bruke tid uten å ha sagt fra er
 * verre enn ett trykk til.
 */

type Steg =
  | { navn: 'tom' }
  | { navn: 'lest'; filnavn: string; parse: ParseResultat }
  | { navn: 'planlagt'; filnavn: string; parse: ParseResultat; plan: Plan; fantes: Set<string> }
  | { navn: 'skrevet'; filnavn: string; plan: Plan }

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

function dato(d: Date | string | null | undefined): string {
  if (!d) return '–'
  const v = typeof d === 'string' ? new Date(d) : d
  return DATO.format(v)
}

export function Prisfil() {
  const { profil } = useAuth()
  const [steg, setSteg] = useState<Steg>({ navn: 'tom' })
  const [grossist, setGrossist] = useState('')
  const [paslag, setPaslag] = useState('')
  const [utgaatte, setUtgaatte] = useState(false)
  const [drar, setDrar] = useState(false)
  const [jobber, setJobber] = useState<string | null>(null)
  const [fremdrift, setFremdrift] = useState<Fremdrift | null>(null)
  const [feil, setFeil] = useState<string | null>(null)

  const kanSkrive = kan(profil?.role, 'priser.importer')

  const valg = useMemo<ImportValg>(() => {
    const p = paslag.trim() === '' ? undefined : Number(paslag.replace(',', '.'))
    return {
      grossist: grossist.trim(),
      paslagProsent: p != null && Number.isFinite(p) ? p : undefined,
      inkluderUtgaatte: utgaatte,
    }
  }, [grossist, paslag, utgaatte])

  async function lesFil(fil: File) {
    setFeil(null)
    setJobber('Leser fila …')
    try {
      // EFO/NELFO-filer er ANSI, ikke UTF-8. Leser man dem som UTF-8 blir
      // «Kabel installasjon 3G2,5 grå» til «gr?», og varenavnet er det folk søker på.
      const bytes = new Uint8Array(await fil.arrayBuffer())
      const parse = parseEfoNelfo(dekodAnsi(bytes))
      setSteg({ navn: 'lest', filnavn: fil.name, parse })
      if (!grossist.trim() && parse.hode.selgerNavn) setGrossist(parse.hode.selgerNavn)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(null)
    }
  }

  async function regnUt() {
    if (steg.navn !== 'lest' && steg.navn !== 'planlagt') return
    if (!profil?.company_id) { setFeil('Brukeren mangler firma.'); return }
    setFeil(null)
    setJobber('Sammenligner mot varekartoteket …')
    try {
      const elnumre = elnumreIFil(steg.parse, valg)
      const eks = await hentEksisterende(elnumre)
      const plan = planleggImport(steg.parse, valg, eks.varer, eks.priser, {
        companyId: profil.company_id,
        brukerId: profil.id,
        nyId: () => crypto.randomUUID(),
        naa: new Date(),
      })
      setSteg({
        navn: 'planlagt',
        filnavn: steg.filnavn,
        parse: steg.parse,
        plan,
        fantes: new Set(eks.varer.map(v => v.elnummer).filter((x): x is string => !!x)),
      })
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(null)
    }
  }

  async function skriv() {
    if (steg.navn !== 'planlagt') return
    setFeil(null)
    setJobber('Skriver …')
    try {
      await skrivImport(steg.plan, setFremdrift)
      setSteg({ navn: 'skrevet', filnavn: steg.filnavn, plan: steg.plan })
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setJobber(null)
      setFremdrift(null)
    }
  }

  return (
    <>
    <Sidehode
      tittel="Prisfiler"
      under="EFO/NELFO 4.0 fra grossisten. Fila leses her, og ingenting skrives før du har sett hva den vil gjøre."
    />
    <div className="flate-rull stabel">
      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
      {!kanSkrive ? (
        <Beskjed stil="varsel">
          Rollen din kan lese, men ikke skrive til varekartoteket. Prisimport krever eier eller
          administrator.
        </Beskjed>
      ) : null}

      {steg.navn === 'tom' ? (
        <>
          <Slippsone drar={drar} setDrar={setDrar} lesFil={lesFil} />
          <Ferskhet />
        </>
      ) : null}

      {steg.navn !== 'tom' ? (
        <Kort
          tittel={steg.filnavn}
          verktoy={
            <Knapp stil="naken" onClick={() => setSteg({ navn: 'tom' })}>
              Bytt fil
            </Knapp>
          }
        >
          {steg.navn === 'skrevet' ? (
            <Beskjed stil="ok">
              Skrevet: {antall(steg.plan.resultat.nye)} nye varer, {antall(steg.plan.resultat.oppdaterte)}{' '}
              oppdaterte, {antall(steg.plan.priser.length)} prisrader.
            </Beskjed>
          ) : (
            <Filhode parse={steg.parse} />
          )}
        </Kort>
      ) : null}

      {steg.navn === 'lest' || steg.navn === 'planlagt' ? (
        <Kort tittel="Import">
          <div className="rad" style={{ alignItems: 'flex-end', gap: 16 }}>
            <div style={{ width: 220 }}>
              <Felt
                firkant
                etikett="Grossist"
                value={grossist}
                onChange={e => setGrossist(e.target.value)}
                placeholder="Onninen"
                hjelp="Navnet prisraden lagres på"
              />
            </div>
            <div style={{ width: 176 }}>
              <Felt
                firkant
                etikett="Påslag %"
                value={paslag}
                onChange={e => setPaslag(e.target.value)}
                placeholder="tomt = rør ikke"
                hjelp="Utsalgspris = netto + påslag"
              />
            </div>
            <label className="rad" style={{ height: 30, marginBottom: 18 }}>
              <input type="checkbox" checked={utgaatte} onChange={e => setUtgaatte(e.target.checked)} />
              <span className="dempet">Ta med utgåtte varer</span>
            </label>
            <div className="strekk" />
            <Knapp stil="stille" onClick={regnUt} disabled={!grossist.trim() || jobber != null}>
              Regn ut
            </Knapp>
            <Knapp
              stil="merke"
              onClick={skriv}
              disabled={steg.navn !== 'planlagt' || !kanSkrive || jobber != null}
            >
              Skriv til kartoteket
            </Knapp>
          </div>
          {jobber ? (
            <p className="felt-hjelp" style={{ marginTop: 12 }}>
              {jobber}
              {fremdrift ? ` ${antall(fremdrift.skrevet)} / ${antall(fremdrift.av)}` : ''}
            </p>
          ) : null}
        </Kort>
      ) : null}

      {steg.navn === 'planlagt' ? <Fasit plan={steg.plan} /> : null}
      {steg.navn === 'planlagt' ? <Forhandsvisning plan={steg.plan} fantes={steg.fantes} /> : null}
      {steg.navn === 'lest' && steg.parse.avvik.length > 0 ? <Avvik parse={steg.parse} /> : null}
    </div>
    </>
  )
}

function Slippsone({
  drar,
  setDrar,
  lesFil,
}: {
  drar: boolean
  setDrar: (v: boolean) => void
  lesFil: (f: File) => void
}) {
  return (
    <div className="slipp-ramme">
      <label
        className={drar ? 'slipp slipp-aktiv' : 'slipp'}
        onDragOver={e => { e.preventDefault(); setDrar(true) }}
        onDragLeave={() => setDrar(false)}
        onDrop={e => {
          e.preventDefault()
          setDrar(false)
          const f = e.dataTransfer.files[0]
          if (f) lesFil(f)
        }}
      >
        <div className="slipp-ikon">
          <Upload size={22} strokeWidth={1.6} />
        </div>
        <h2>Slipp grossistfila her</h2>
        <p className="kort-hjelp" style={{ maxWidth: '46ch' }}>
          EFO/NELFO 4.0 varefil eller pristilbud. Fila leses på maskinen; ingenting sendes noe sted
          før du har sett hva den vil gjøre.
        </p>
        <input
          type="file"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) lesFil(f)
          }}
        />
        <span className="knapp knapp-primar" style={{ marginTop: 6 }}>Velg fil</span>
      </label>
    </div>
  )
}

/**
 * Hvor gammel er prisen vi regner med?
 *
 * Leses fra `product_prices`, ikke fra `products.supplier` — ellers forsvinner
 * en grossist fra lista i det en annen importeres over. Nittifire dager gamle
 * priser er ikke en teknisk detalj: det er dekningsbidraget som er feil.
 */
function Ferskhet() {
  const [rader, setRader] = useState<Prisferskhet[]>([])
  const [lastet, setLastet] = useState(false)

  useEffect(() => {
    hentPrisferskhet()
      .then(setRader)
      .catch(() => setRader([]))
      .finally(() => setLastet(true))
  }, [])

  if (!lastet || rader.length === 0) return null

  const naa = Date.now()
  return (
    <Kort tittel="Siste import" merkelapp="Per grossist">
      <table className="linjer">
        <thead>
          <tr>
            <th>Grossist</th>
            <th className="h" style={{ width: 110 }}>Prisrader</th>
            <th style={{ width: 150 }}>Sist oppdatert</th>
            <th style={{ width: 120 }}>Alder</th>
          </tr>
        </thead>
        <tbody>
          {rader.map(r => {
            const dager = Math.floor((naa - new Date(r.sistOppdatert).getTime()) / 86_400_000)
            return (
              <tr key={r.grossist}>
                <td style={{ fontWeight: 500 }}>{r.grossist}</td>
                <td className="h">{antall(r.antall)}</td>
                <td className="dempet">{dato(r.sistOppdatert)}</td>
                <td>
                  {dager > 60
                    ? <Merke stil="varsel">{stk(dager, 'dag', 'dager')}</Merke>
                    : <span className="dempet-mer">{dager === 0 ? 'i dag' : stk(dager, 'dag', 'dager')}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Kort>
  )
}

function Filhode({ parse }: { parse: ParseResultat }) {
  const h = parse.hode
  return (
    <div className="rad" style={{ gap: 24, flexWrap: 'wrap' }}>
      <Opplysning navn="Filtype" verdi={h.filtype === 'vare' ? 'Varefil' : 'Pristilbud'} />
      <Opplysning navn="Selger" verdi={h.selgerNavn || '–'} />
      <Opplysning navn="Kundenr." verdi={h.kundeNr ?? '–'} />
      <Opplysning navn="Valuta" verdi={h.valuta || "–"} />
      <Opplysning navn="Gyldig fra" verdi={dato(h.gyldigFra)} />
      <Opplysning navn="Gyldig til" verdi={dato(h.gyldigTil)} />
      <Opplysning navn="Linjer" verdi={antall(parse.varer.length)} />
      <Opplysning
        navn="Avvik"
        verdi={parse.avvik.length === 0 ? 'ingen' : antall(parse.avvik.length)}
      />
    </div>
  )
}

function Opplysning({ navn, verdi }: { navn: string; verdi: string }) {
  return (
    <div>
      <div className="felt-etikett">{navn}</div>
      <div className="valgbar">{verdi}</div>
    </div>
  )
}

function Fasit({ plan }: { plan: Plan }) {
  const r = plan.resultat
  return (
    <div className="stabel">
      <Nokkeltall
        tall={[
          { navn: 'Nye varer', verdi: antall(r.nye) },
          { navn: 'Oppdaterte', verdi: antall(r.oppdaterte) },
          { navn: 'Billigst her', verdi: antall(r.billigstHer) },
          { navn: 'Beriket', verdi: antall(r.berikede) },
          { navn: 'Uten el-nummer', verdi: antall(r.utenElnummer) },
          { navn: 'Utgått', verdi: antall(r.utgaatte) },
        ]}
      />
      {r.listepriser > 0 ? (
        <Beskjed stil="varsel">
          {stk(r.listepriser, 'linje er', 'linjer er')} LISTEPRIS, ikke firmaets pris. Da vet vi hva
          varen koster i katalogen, ikke hva dere betaler, og dekningsbidraget blir for lavt. Be
          grossisten om en fil med deres egne betingelser.
        </Beskjed>
      ) : null}
      {r.utenElnummer > 0 ? (
        <Beskjed stil="varsel">
          {stk(r.utenElnummer, 'linje mangler', 'linjer mangler')} el-nummer og hoppes over. Uten
          el-nummer kan varen ikke sammenlignes mot en annen grossist, som er hele poenget med
          kartoteket.
        </Beskjed>
      ) : null}
    </div>
  )
}

type Visning = {
  id: string
  elnummer: string
  navn: string
  fabrikat: string | null
  enhet: string
  netto: number
  kost: number | null
  pakning: number | null
  ny: boolean
}

function Forhandsvisning({ plan, fantes }: { plan: Plan; fantes: Set<string> }) {
  const rader = useMemo<Visning[]>(() => {
    const pris = new Map<string, PrisRad>()
    for (const p of plan.priser) pris.set(p.product_id, p)
    return plan.varer.map(v => ({
      id: v.id,
      elnummer: v.elnummer ?? '',
      navn: v.name,
      fabrikat: v.fabrikat,
      enhet: v.unit,
      netto: pris.get(v.id)?.net_price ?? 0,
      kost: v.cost_price,
      pakning: pris.get(v.id)?.sales_pack ?? null,
      ny: !(v.elnummer && fantes.has(v.elnummer)),
    }))
  }, [plan, fantes])

  const kolonner: Kolonne<Visning>[] = [
    { nokkel: 'el', navn: 'El-nr', bredde: '96px', celle: r => <span className="valgbar">{r.elnummer}</span> },
    { nokkel: 'navn', navn: 'Vare', bredde: 'minmax(0,2fr)', celle: r => r.navn },
    { nokkel: 'fab', navn: 'Fabrikat', bredde: 'minmax(0,1fr)', celle: r => <span className="dempet">{r.fabrikat ?? ''}</span> },
    { nokkel: 'enh', navn: 'Enhet', bredde: '56px', celle: r => <span className="dempet">{r.enhet}</span> },
    { nokkel: 'pak', navn: 'Pakning', bredde: '72px', tall: true, celle: r => (r.pakning == null ? '' : antall(r.pakning)) },
    { nokkel: 'net', navn: 'Netto', bredde: '84px', tall: true, celle: r => kroner(r.netto) },
    {
      nokkel: 'kost',
      navn: 'Kostpris',
      bredde: '84px',
      tall: true,
      // Kostprisen kan være LAVERE enn nettoprisen i denne fila: da er en annen
      // grossist billigere, og det er den vi skal regne dekningsbidrag med.
      celle: r => (
        <span className={r.kost != null && r.kost < r.netto ? 'merke merke-endret' : undefined}>
          {kroner(r.kost)}
        </span>
      ),
    },
    {
      nokkel: 'st',
      navn: 'Status',
      bredde: '86px',
      celle: r => (r.ny ? <Merke stil="ny">Ny</Merke> : <Merke stil="noytral">Oppdateres</Merke>),
    },
  ]

  return (
    <Kort tittel={`Forhåndsvisning — ${antall(rader.length)} varer`}>
      <div style={{ height: 420, display: 'flex' }}>
        <Tabell rader={rader} kolonner={kolonner} nokkel={r => r.id} />
      </div>
    </Kort>
  )
}

function Avvik({ parse }: { parse: ParseResultat }) {
  return (
    <Kort tittel={`Avvik — ${stk(parse.avvik.length, 'linje', 'linjer')} vi ikke tolket`}>
      <p className="kort-hjelp" style={{ marginBottom: 12 }}>
        Disse linjene ble hoppet over. Er de mange, har fila et format vi ikke har sett før, og
        linjenummeret under kan slås opp direkte i fila.
      </p>
      {parse.avvik.length === 0 ? (
        <Tomt>Ingen avvik</Tomt>
      ) : (
        <div style={{ height: 220, display: 'flex' }}>
          <Tabell
            rader={parse.avvik.slice(0, 500)}
            nokkel={(_, i) => String(i)}
            kolonner={[
              { nokkel: 'l', navn: 'Linje', bredde: '72px', tall: true, celle: a => antall(a.linje) },
              { nokkel: 'g', navn: 'Grunn', bredde: '220px', celle: a => a.grunn },
              { nokkel: 'i', navn: 'Innhold', bredde: 'minmax(0,1fr)', celle: a => <span className="dempet valgbar">{a.innhold}</span> },
            ]}
          />
        </div>
      )}
    </Kort>
  )
}
