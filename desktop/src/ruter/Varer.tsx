import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/supabase'
import { hentPrisferskhet, type Prisferskhet } from '@/lib/prisfil-lager'
import { antall, Beskjed, Felt, Kort, kroner, Merke, Sidehode } from '@/ui/kit'
import { Tabell, type Kolonne } from '@/ui/Tabell'

/**
 * Varekartoteket, kontorutgaven: se hva importen faktisk la inn, og hvilken
 * grossist som er billigst på en gitt vare.
 *
 * Søket går mot `search_text`, samme kolonne montørappens varesøk bruker. Den
 * er små bokstaver og mellomromseparert nettopp for at databasen skal kunne
 * filtrere før noe havner i JS.
 */

type Vare = {
  id: string
  elnummer: string | null
  name: string
  fabrikat: string | null
  unit: string
  cost_price: number | null
  unit_price: number | null
  supplier: string | null
  category: string | null
}

type Pris = { product_id: string; supplier: string; net_price: number }

const GRENSE = 300

export function Varer() {
  const [sok, setSok] = useState('')
  const [rader, setRader] = useState<Vare[]>([])
  const [priser, setPriser] = useState<Map<string, Pris[]>>(new Map())
  const [ferskhet, setFerskhet] = useState<Prisferskhet[]>([])
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const teller = useRef(0)

  useEffect(() => {
    hentPrisferskhet().then(setFerskhet).catch(e => setFeil(String(e)))
  }, [])

  useEffect(() => {
    // Enkelt debounce: kontoret skriver fort, og hvert tastetrykk skal ikke bli
    // en spørring. 200 ms er under det noen rekker å merke.
    const id = window.setTimeout(async () => {
      const mitt = ++teller.current
      setLaster(true)
      const q = supabase
        .from('products')
        .select('id,elnummer,name,fabrikat,unit,cost_price,unit_price,supplier,category')
        .is('deleted_at', null)
        .order('name')
        .limit(GRENSE)
      const ord = sok.trim().toLowerCase().split(/\s+/).filter(Boolean)
      for (const o of ord) q.like('search_text', `%${o}%`)
      const { data, error } = await q
      if (mitt !== teller.current) return
      if (error) { setFeil(error.message); setLaster(false); return }

      const varer = (data ?? []) as Vare[]
      setRader(varer)
      setFeil(null)

      if (varer.length > 0) {
        const p = await supabase
          .from('product_prices')
          .select('product_id,supplier,net_price')
          .in('product_id', varer.map(v => v.id))
          .is('deleted_at', null)
        if (mitt !== teller.current) return
        const kart = new Map<string, Pris[]>()
        for (const r of (p.data ?? []) as Pris[]) {
          const liste = kart.get(r.product_id) ?? []
          liste.push(r)
          kart.set(r.product_id, liste)
        }
        setPriser(kart)
      } else {
        setPriser(new Map())
      }
      setLaster(false)
    }, 200)
    return () => window.clearTimeout(id)
  }, [sok])

  const kolonner = useMemo<Kolonne<Vare>[]>(
    () => [
      { nokkel: 'el', navn: 'El-nr', bredde: '96px', celle: v => <span className="valgbar">{v.elnummer ?? ''}</span> },
      { nokkel: 'navn', navn: 'Vare', bredde: 'minmax(0,2fr)', celle: v => v.name },
      { nokkel: 'fab', navn: 'Fabrikat', bredde: 'minmax(0,1fr)', celle: v => <span className="dempet">{v.fabrikat ?? ''}</span> },
      { nokkel: 'kat', navn: 'Gruppe', bredde: 'minmax(0,1fr)', celle: v => <span className="dempet">{v.category ?? ''}</span> },
      { nokkel: 'enh', navn: 'Enhet', bredde: '56px', celle: v => <span className="dempet">{v.unit}</span> },
      { nokkel: 'kost', navn: 'Kostpris', bredde: '84px', tall: true, celle: v => kroner(v.cost_price) },
      { nokkel: 'salg', navn: 'Utsalg', bredde: '84px', tall: true, celle: v => kroner(v.unit_price) },
      {
        nokkel: 'gros',
        navn: 'Billigst hos',
        bredde: '150px',
        // Poenget med hele product_prices-tabellen: «Solar er 14 % billigere på
        // denne» skal kunne besvares. Står det (1), har vi bare én pris å gå på.
        celle: v => {
          const liste = priser.get(v.id) ?? []
          return (
            <span className="rad" style={{ gap: 6 }}>
              <span>{v.supplier ?? '–'}</span>
              {/* Tallet er hele poenget med product_prices: står det 2, kan
                  «Solar er 14 % billigere på denne» faktisk besvares. */}
              {liste.length > 1 ? <span className="teller">{liste.length}</span> : null}
            </span>
          )
        },
      },
    ],
    [priser],
  )

  return (
    <>
      <Sidehode
        tittel="Varer"
        under={
          laster
            ? 'Søker …'
            : `${antall(rader.length)}${rader.length === GRENSE ? '+' : ''} varer i kartoteket`
        }
        handling={
          <>
            {ferskhet.slice(0, 3).map(f => (
              <Merke key={f.grossist} stil="noytral">
                {f.grossist} · {antall(f.antall)}
              </Merke>
            ))}
            <div style={{ width: 280 }}>
              <Felt
                placeholder="Søk el-nummer, navn, fabrikat …"
                value={sok}
                autoFocus
                onChange={e => setSok(e.target.value)}
              />
            </div>
          </>
        }
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {rader.length === 0 && !laster && sok.trim() === '' ? (
        <Kort tittel="Varekartoteket er tomt">
          <p className="kort-hjelp">
            Importer en prisfil fra grossisten, så fylles det. Det er den ene jobben kontor-PC-en har
            som telefonen ikke skal ha.
          </p>
        </Kort>
      ) : (
        <div className="arbeidsflate">
          <Tabell rader={rader} kolonner={kolonner} nokkel={v => v.id} tomTekst="Ingen treff" />
        </div>
      )}
    </>
  )
}
