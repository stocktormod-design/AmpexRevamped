import { supabase } from '@/supabase'
import {
  bolker,
  PRIS_KOLONNER,
  VARE_KOLONNER,
  type EksisterendePris,
  type EksisterendeVare,
  type Plan,
} from '@delt/pricefile/plan'

/**
 * I/O-halvdelen av prisfilimporten. All regning ligger i `lib/pricefile/plan.ts`
 * og har selvtest; her er det bare henting og skriving.
 */

/** Hvor mange el-numre som får plass i én `in(...)`-spørring uten at URL-en blir for lang. */
const OPPSLAG = 300

/** Hvor mange rader som sendes per upsert. Supabase tåler mer, men feilmeldingen blir uleselig. */
const SKRIV = 500

export type Eksisterende = {
  varer: EksisterendeVare[]
  priser: EksisterendePris[]
}

export async function hentEksisterende(elnumre: string[]): Promise<Eksisterende> {
  const varer: EksisterendeVare[] = []
  const priser: EksisterendePris[] = []

  for (const bolk of bolker(elnumre, OPPSLAG)) {
    const v = await supabase
      .from('products')
      .select(VARE_KOLONNER)
      .in('elnummer', bolk)
      .is('deleted_at', null)
    if (v.error) throw new Error(`Kunne ikke lese varekartoteket: ${v.error.message}`)
    varer.push(...((v.data ?? []) as unknown as EksisterendeVare[]))

    const p = await supabase
      .from('product_prices')
      .select(PRIS_KOLONNER)
      .in('elnummer', bolk)
      .is('deleted_at', null)
    if (p.error) throw new Error(`Kunne ikke lese prisradene: ${p.error.message}`)
    priser.push(...((p.data ?? []) as unknown as EksisterendePris[]))
  }

  return { varer, priser }
}

export type Fremdrift = { skrevet: number; av: number }

/**
 * Skriver planen.
 *
 * Varene først, prisradene etterpå: `product_prices.product_id` peker på en
 * vare, og en prisrad som lander før varen sin ville brutt fremmednøkkelen.
 *
 * Det finnes ingen transaksjon over flere upserts i PostgREST. Halvveis skrevet
 * er derfor mulig hvis nettet ryker midt i, og det er akseptabelt her: importen
 * er en upsert på (company_id, elnummer) og (company_id, product_id, supplier),
 * så samme fil kan kjøres om igjen uten å duplisere noe. Samme krav som
 * SpeedyCraft-migreringen stiller, av samme grunn.
 */
export async function skrivImport(plan: Plan, fremdrift?: (f: Fremdrift) => void): Promise<void> {
  const totalt = plan.varer.length + plan.priser.length
  let skrevet = 0

  for (const bolk of bolker(plan.varer, SKRIV)) {
    const { error } = await supabase.from('products').upsert(bolk, { onConflict: 'id' })
    if (error) throw new Error(`Kunne ikke skrive varer: ${error.message}`)
    skrevet += bolk.length
    fremdrift?.({ skrevet, av: totalt })
  }

  for (const bolk of bolker(plan.priser, SKRIV)) {
    const { error } = await supabase.from('product_prices').upsert(bolk, { onConflict: 'id' })
    if (error) throw new Error(`Kunne ikke skrive priser: ${error.message}`)
    skrevet += bolk.length
    fremdrift?.({ skrevet, av: totalt })
  }
}

export type Prisferskhet = { grossist: string; sistOppdatert: string; antall: number }

/**
 * «Onninen: 3 dager siden, Solar: 94 dager siden.»
 *
 * Leses fra `product_prices`, ikke fra `products.supplier` — ellers forsvinner
 * en grossist fra lista i det en annen importeres over.
 */
export async function hentPrisferskhet(): Promise<Prisferskhet[]> {
  const { data, error } = await supabase
    .from('product_prices')
    .select('supplier,imported_at')
    .is('deleted_at', null)
    .order('imported_at', { ascending: false })
    .limit(20000)
  if (error) throw new Error(error.message)

  const per = new Map<string, { sist: string; antall: number }>()
  for (const r of (data ?? []) as { supplier: string; imported_at: string }[]) {
    const rad = per.get(r.supplier)
    if (!rad) per.set(r.supplier, { sist: r.imported_at, antall: 1 })
    else { rad.antall++; if (r.imported_at > rad.sist) rad.sist = r.imported_at }
  }
  return [...per.entries()]
    .map(([grossist, r]) => ({ grossist, sistOppdatert: r.sist, antall: r.antall }))
    .sort((a, b) => (a.sistOppdatert < b.sistOppdatert ? 1 : -1))
}
