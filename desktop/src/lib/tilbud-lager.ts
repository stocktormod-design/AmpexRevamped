import {
  byggTilbudssum, effektivStatus, grupperTilbud, kanRedigeres, somTilbudStatus, utvidPakke,
  type NyTilbudslinje, type Omrade, type Pakkelinje, type Prispatch, type Tilbudslinje,
  type TilbudsInnhold, type TilbudslinjeArt, type TilbudslinjeInn, type Tilbudssum, type TilbudStatus,
} from '@delt/quoting'
import { dokumentHtml } from '@delt/pdf/dokument'
import { tilbudInnholdHtml, type TilbudslinjeUt } from '@delt/pdf/tilbud'
import { mvaLabel } from '@delt/invoicing'
import { hentFirma, mittFirma, nyId } from '@/lib/kontor-lager'
import { supabase } from '@/supabase'

/**
 * Kalkulasjonen — ett tilbud, med områder og linjer.
 *
 * Her skrives det. Kontoret går rett på Supabase (regel 2: offline-først
 * gjelder montørappen), men REGNER ingenting selv: summene kommer fra
 * `lib/quoting.ts`, som har `verify:quoting` og brukes av telefonen også.
 * To flater som kommer til to svar på det samme tilbudet er den ene feilen
 * dette laget ikke får lov å gjøre.
 *
 * Arbeidsdelingen mot appen: OPPDELINGEN lages her. En kalkulasjon med tolv rom
 * og tre etasjer er en skrivebordsjobb; telefonen viser den ferdige
 * oppdelingen med sum per område, og fører timer og materiell på ordren
 * etterpå.
 */

function sjekk<T>(r: { data: T | null; error: { message: string } | null }, hva: string): T {
  if (r.error) throw new Error(`${hva}: ${r.error.message}`)
  return (r.data ?? []) as T
}

export type Tilbudshode = {
  id: string
  quote_number: number | null
  title: string
  description: string | null
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  status: TilbudStatus
  visning: TilbudStatus
  valid_until: string | null
  sent_at: string | null
  project_id: string | null
  /** Standard påslag i % av kost — brukes på varer uten egen pris, og av «oppdater alle». */
  default_markup_percent: number | null
}

export type Linjerad = {
  id: string
  section_id: string | null
  sort_order: number
  kind: TilbudslinjeArt
  description: string
  elnummer: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  cost_price: number | null
  discount_percent: number | null
  vat_type: string | null
  product_id: string | null
  is_optional: boolean
  is_selected: boolean
  price_locked: boolean
}

export type Omraderad = Omrade & { source: string | null }

export type Tilbudsdetalj = {
  hode: Tilbudshode
  omrader: Omraderad[]
  linjer: Linjerad[]
  /** Hele tilbudet. */
  sum: Tilbudssum
  /** Det samme, delt i områder. */
  innhold: TilbudsInnhold
  /** Sendt eller besvart tilbud er et dokument, ikke et arbeidsark. */
  redigerbar: boolean
}

function somArt(v: string | null): TilbudslinjeArt {
  // Ukjent verdi blir en TEKSTlinje uten beløp — aldri materiell, som stille
  // ville lagt penger til summen.
  return v === 'materiell' || v === 'arbeid' ? v : 'tekst'
}

/** Raden slik `lib/quoting.ts` vil ha den. Eksportert fordi flata regner påslag på et utvalg. */
export function linjeSomInn(l: Linjerad): TilbudslinjeInn {
  return {
    id: l.id,
    art: l.kind,
    beskrivelse: l.description,
    antall: l.quantity,
    enhet: l.unit,
    enhetsprisKr: l.unit_price,
    kostprisKr: l.cost_price,
    rabattProsent: l.discount_percent,
    mvaType: l.vat_type,
    elnummer: l.elnummer,
    omradeId: l.section_id,
    valgfri: l.is_optional,
    valgt: l.is_selected,
    prisLaast: l.price_locked,
  }
}
const somInn = linjeSomInn

const LINJEFELT = 'id,section_id,sort_order,kind,description,elnummer,quantity,unit,unit_price,cost_price,discount_percent,vat_type,product_id,is_optional,is_selected,price_locked'

export async function hentTilbudsdetalj(id: string): Promise<Tilbudsdetalj> {
  const hoder = sjekk(
    await supabase
      .from('quotes')
      .select('id,quote_number,title,description,customer_id,customer_name,customer_phone,address,status,valid_until,sent_at,project_id,default_markup_percent')
      .eq('id', id)
      .is('deleted_at', null)
      .limit(1),
    'Kunne ikke lese tilbudet',
  ) as (Omit<Tilbudshode, 'status' | 'visning'> & { status: string | null })[]

  const rad = hoder[0]
  if (!rad) throw new Error('Tilbudet finnes ikke.')

  const omrader = sjekk(
    await supabase
      .from('quote_sections')
      .select('id,parent_id,name,sort_order,source')
      .eq('quote_id', id)
      .is('deleted_at', null)
      .order('sort_order'),
    'Kunne ikke lese områdene',
  ) as { id: string; parent_id: string | null; name: string; sort_order: number; source: string | null }[]

  const linjer = sjekk(
    await supabase
      .from('quote_lines')
      .select(LINJEFELT)
      .eq('quote_id', id)
      .is('deleted_at', null)
      .order('sort_order'),
    'Kunne ikke lese tilbudslinjene',
  ) as (Omit<Linjerad, 'kind'> & { kind: string | null })[]

  const rader: Linjerad[] = linjer.map(l => ({ ...l, kind: somArt(l.kind) }))
  const status = somTilbudStatus(rad.status)
  const sum = byggTilbudssum(rader.map(somInn))
  const omraderader: Omraderad[] = omrader.map(o => ({
    id: o.id, forelderId: o.parent_id, navn: o.name, sortOrder: o.sort_order, source: o.source,
  }))

  return {
    hode: {
      ...rad,
      status,
      visning: effektivStatus(status, rad.valid_until ? new Date(rad.valid_until).getTime() : null, Date.now()),
    },
    omrader: omraderader,
    linjer: rader,
    sum,
    innhold: grupperTilbud(sum.linjer, omraderader),
    redigerbar: kanRedigeres(status),
  }
}

/* ── Områder ───────────────────────────────────────────────────────────── */

export async function nyttOmrade(quoteId: string, navn: string, forelderId: string | null = null): Promise<string> {
  const rene = navn.trim()
  if (!rene) throw new Error('Området må ha et navn.')

  const sosken = sjekk(
    await supabase.from('quote_sections').select('sort_order').eq('quote_id', quoteId).is('deleted_at', null),
    'Kunne ikke lese områdene',
  ) as { sort_order: number }[]

  const id = nyId()
  const r = await supabase.from('quote_sections').insert({
    id,
    company_id: await mittFirma(),
    quote_id: quoteId,
    parent_id: forelderId,
    name: rene,
    sort_order: sosken.reduce((maks, o) => Math.max(maks, o.sort_order), -1) + 1,
    source: 'manuell',
  })
  if (r.error) throw new Error(`Kunne ikke opprette området: ${r.error.message}`)
  return id
}

export async function endreOmradenavn(id: string, navn: string): Promise<void> {
  const rene = navn.trim()
  if (!rene) throw new Error('Området må ha et navn.')
  const r = await supabase.from('quote_sections').update({ name: rene }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke endre navnet: ${r.error.message}`)
}

/**
 * Sletter et område. Linjene løftes ut FØRST, underområdene rykker opp ett
 * nivå. Et trykk som fjerner en overskrift skal aldri kunne fjerne penger fra
 * summen — og rekkefølgen er sånn at en halvveis feilet sletting etterlater
 * linjer som er synlige, ikke linjer som peker på et område som er borte.
 */
export async function slettOmrade(id: string, forelderId: string | null): Promise<void> {
  const ut = await supabase.from('quote_lines').update({ section_id: null }).eq('section_id', id)
  if (ut.error) throw new Error(`Kunne ikke flytte linjene ut av området: ${ut.error.message}`)

  const opp = await supabase.from('quote_sections').update({ parent_id: forelderId }).eq('parent_id', id)
  if (opp.error) throw new Error(`Kunne ikke flytte underområdene: ${opp.error.message}`)

  // Soft delete (regel 5).
  const r = await supabase.from('quote_sections').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette området: ${r.error.message}`)
}

/* ── Linjer ────────────────────────────────────────────────────────────── */

export type NyLinje = {
  kind: TilbudslinjeArt
  description: string
  sectionId: string | null
  quantity?: number | null
  unit?: string | null
  unitPrice?: number | null
  costPrice?: number | null
  discountPercent?: number | null
  vatType?: string | null
  productId?: string | null
  elnummer?: string | null
  isOptional?: boolean
  priceLocked?: boolean
}

async function nesteSortOrder(quoteId: string): Promise<number> {
  const eksisterende = sjekk(
    await supabase.from('quote_lines').select('sort_order').eq('quote_id', quoteId).is('deleted_at', null),
    'Kunne ikke lese linjene',
  ) as { sort_order: number }[]
  return eksisterende.reduce((maks, l) => Math.max(maks, l.sort_order), -1) + 1
}

function linjeRad(quoteId: string, companyId: string, sortOrder: number, inn: NyLinje) {
  return {
    id: nyId(),
    company_id: companyId,
    quote_id: quoteId,
    section_id: inn.sectionId,
    sort_order: sortOrder,
    kind: inn.kind,
    description: inn.description.trim(),
    quantity: inn.kind === 'tekst' ? null : inn.quantity ?? 1,
    unit: inn.kind === 'tekst' ? null : inn.unit ?? (inn.kind === 'arbeid' ? 't' : 'stk'),
    unit_price: inn.kind === 'tekst' ? null : inn.unitPrice ?? null,
    cost_price: inn.kind === 'tekst' ? null : inn.costPrice ?? null,
    discount_percent: inn.kind === 'tekst' ? null : inn.discountPercent ?? null,
    vat_type: inn.vatType ?? null,
    product_id: inn.productId ?? null,
    elnummer: inn.elnummer ?? null,
    // Et nytt tilvalg er AV til noen velger det — summen skal vise merkingen.
    is_optional: inn.isOptional ?? false,
    is_selected: false,
    price_locked: inn.priceLocked ?? false,
  }
}

export async function nyLinje(quoteId: string, inn: NyLinje): Promise<string> {
  const rad = linjeRad(quoteId, await mittFirma(), await nesteSortOrder(quoteId), inn)
  const r = await supabase.from('quote_lines').insert(rad)
  if (r.error) throw new Error(`Kunne ikke legge til linja: ${r.error.message}`)
  return rad.id
}

/** Flere linjer på én gang, i rekkefølge etter hverandre — pakker og import. */
export async function nyeLinjer(quoteId: string, sectionId: string | null, linjer: NyTilbudslinje[]): Promise<string[]> {
  if (linjer.length === 0) return []
  const firma = await mittFirma()
  const start = await nesteSortOrder(quoteId)
  const rader = linjer.map((l, i) => linjeRad(quoteId, firma, start + i, {
    kind: l.art,
    description: l.beskrivelse,
    sectionId,
    quantity: l.antall ?? null,
    unit: l.enhet ?? null,
    unitPrice: l.enhetsprisKr ?? null,
    costPrice: l.kostprisKr ?? null,
    discountPercent: l.rabattProsent ?? null,
    vatType: l.mvaType ?? null,
    productId: l.produktId,
    elnummer: l.elnummer ?? null,
  }))
  const r = await supabase.from('quote_lines').insert(rader)
  if (r.error) throw new Error(`Kunne ikke legge til linjene: ${r.error.message}`)
  return rader.map(x => x.id)
}

export type Linjepatch = Partial<{
  description: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  cost_price: number | null
  discount_percent: number | null
  vat_type: string | null
  section_id: string | null
  kind: TilbudslinjeArt
  is_optional: boolean
  is_selected: boolean
  price_locked: boolean
}>

export async function endreLinje(id: string, patch: Linjepatch): Promise<void> {
  if (Object.keys(patch).length === 0) return
  const r = await supabase.from('quote_lines').update(patch).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke endre linja: ${r.error.message}`)
}

/** Blokk (Cordel): samme endring på mange linjer i én skriving. */
export async function endreLinjer(ids: string[], patch: Linjepatch): Promise<void> {
  if (ids.length === 0 || Object.keys(patch).length === 0) return
  const r = await supabase.from('quote_lines').update(patch).in('id', ids)
  if (r.error) throw new Error(`Kunne ikke endre linjene: ${r.error.message}`)
}

/**
 * Nye priser etter «oppdater påslag». Hver linje får sitt eget tall, så det
 * er én skriving per linje — parallelt, det er kontor-PC-en med nett.
 */
export async function skrivPriser(patcher: Prispatch[]): Promise<void> {
  const svar = await Promise.all(patcher.map(p =>
    supabase.from('quote_lines').update({ unit_price: p.enhetsprisKr }).eq('id', p.id),
  ))
  const feil = svar.find(r => r.error)
  if (feil?.error) throw new Error(`Kunne ikke oppdatere prisene: ${feil.error.message}`)
}

export async function slettLinje(id: string): Promise<void> {
  const r = await supabase.from('quote_lines').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette linja: ${r.error.message}`)
}

export async function slettLinjer(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const r = await supabase.from('quote_lines').update({ deleted_at: new Date().toISOString() }).in('id', ids)
  if (r.error) throw new Error(`Kunne ikke slette linjene: ${r.error.message}`)
}

/* ── Varesøk ───────────────────────────────────────────────────────────── */

export type Varetreff = {
  id: string
  elnummer: string | null
  name: string
  unit: string
  unit_price: number | null
  cost_price: number | null
  vat_type: string | null
}

/**
 * Katalogen, rett i kalkulasjonen. Samme søk som Varer-flata: hvert ord må
 * finnes i `search_text`, så «pfsp 3g2,5» treffer uansett rekkefølge.
 */
export async function sokVarer(sok: string, grense = 12): Promise<Varetreff[]> {
  const ord = sok.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (ord.length === 0) return []
  const q = supabase
    .from('products')
    .select('id,elnummer,name,unit,unit_price,cost_price,vat_type')
    .is('deleted_at', null)
    .order('name')
    .limit(grense)
  for (const o of ord) q.like('search_text', `%${o}%`)
  return sjekk(await q, 'Kunne ikke søke i varene') as Varetreff[]
}

/* ── Pakker ────────────────────────────────────────────────────────────── */

export type Pakke = {
  id: string
  name: string
  description: string | null
  linjer: (Pakkelinje & { id: string })[]
}

export async function hentPakker(): Promise<Pakke[]> {
  const pakker = sjekk(
    await supabase.from('quote_packages').select('id,name,description,sort_order')
      .is('deleted_at', null).order('sort_order').order('name'),
    'Kunne ikke lese pakkene',
  ) as { id: string; name: string; description: string | null }[]
  if (pakker.length === 0) return []

  const linjer = sjekk(
    await supabase.from('quote_package_lines')
      .select('id,package_id,kind,description,elnummer,product_id,quantity,unit,unit_price,cost_price,vat_type')
      .in('package_id', pakker.map(p => p.id)).is('deleted_at', null).order('sort_order'),
    'Kunne ikke lese pakkelinjene',
  ) as {
    id: string; package_id: string; kind: string | null; description: string; elnummer: string | null
    product_id: string | null; quantity: number | null; unit: string | null; unit_price: number | null
    cost_price: number | null; vat_type: string | null
  }[]

  const perPakke = new Map<string, Pakke['linjer']>()
  for (const l of linjer) {
    const liste = perPakke.get(l.package_id) ?? []
    liste.push({
      id: l.id, art: somArt(l.kind), beskrivelse: l.description, antall: l.quantity, enhet: l.unit,
      enhetsprisKr: l.unit_price, kostprisKr: l.cost_price, mvaType: l.vat_type,
      elnummer: l.elnummer, produktId: l.product_id,
    })
    perPakke.set(l.package_id, liste)
  }
  return pakker.map(p => ({ ...p, linjer: perPakke.get(p.id) ?? [] }))
}

/**
 * «Lagre som pakke» fra merkede linjer (Fergus «favourites», Tradify «kits»).
 * Mengdene lagres som de står — den som merker fire stikk og lagrer, får en
 * pakke med fire stikk. Rabatt og område følger ikke med: pakken er malen.
 */
export async function lagrePakke(navn: string, linjer: Linjerad[]): Promise<string> {
  const rene = navn.trim()
  if (!rene) throw new Error('Pakken må ha et navn.')
  if (linjer.length === 0) throw new Error('Merk linjene som skal inn i pakken først.')
  const firma = await mittFirma()
  const id = nyId()
  const p = await supabase.from('quote_packages').insert({ id, company_id: firma, name: rene, sort_order: 0 })
  if (p.error) throw new Error(`Kunne ikke lagre pakken: ${p.error.message}`)
  const r = await supabase.from('quote_package_lines').insert(linjer.map((l, i) => ({
    id: nyId(),
    company_id: firma,
    package_id: id,
    sort_order: i,
    kind: l.kind,
    description: l.description,
    elnummer: l.elnummer,
    product_id: l.product_id,
    quantity: l.quantity,
    unit: l.unit,
    unit_price: l.unit_price,
    cost_price: l.cost_price,
    vat_type: l.vat_type,
  })))
  if (r.error) throw new Error(`Kunne ikke lagre pakkelinjene: ${r.error.message}`)
  return id
}

export async function slettPakke(id: string): Promise<void> {
  const naa = new Date().toISOString()
  const l = await supabase.from('quote_package_lines').update({ deleted_at: naa }).eq('package_id', id)
  if (l.error) throw new Error(`Kunne ikke slette pakkelinjene: ${l.error.message}`)
  const r = await supabase.from('quote_packages').update({ deleted_at: naa }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette pakken: ${r.error.message}`)
}

/** Pakke inn i tilbudet × antall. Regnestykket er `utvidPakke` (selvtestet). */
export async function settInnPakke(
  quoteId: string, pakke: Pakke, antall: number, sectionId: string | null, paslagProsent: number | null,
): Promise<string[]> {
  return nyeLinjer(quoteId, sectionId, utvidPakke(pakke.linjer, antall, paslagProsent))
}

/**
 * Bytter plass på to linjer. Bare de to radenes `sort_order` bytter verdi, så
 * en pil i «Stue» aldri flytter noe i «Kjøkken».
 */
export async function byttPlass(a: Linjerad, b: Linjerad): Promise<void> {
  if (a.sort_order === b.sort_order) return
  const forste = await supabase.from('quote_lines').update({ sort_order: b.sort_order }).eq('id', a.id)
  if (forste.error) throw new Error(`Kunne ikke flytte linja: ${forste.error.message}`)
  const andre = await supabase.from('quote_lines').update({ sort_order: a.sort_order }).eq('id', b.id)
  if (andre.error) throw new Error(`Kunne ikke flytte linja: ${andre.error.message}`)
}

/* ── Opprette og endre selve tilbudet ──────────────────────────────────── */

/** 30 dager. Et tilbud uten frist er et tilbud uten slutt. */
export const GYLDIGHET_DAGER = 30

export type NyttTilbud = {
  tittel: string
  kundeId: string | null
  /** Snapshot: dokumentet skal kunne leses uendret om registeret rettes. */
  kundeNavn: string | null
  kundeTelefon: string | null
  adresse: string | null
  gyldigDager: number
}

/**
 * Tittelen kan være tom: tilbudet opprettes som et blankt ark og fylles ut
 * PÅ arket (Jobber «New Quote»), ikke i et skjema foran. Sjekklista før
 * sending sier fra om den fortsatt er tom.
 */
export async function opprettTilbud(inn: NyttTilbud): Promise<string> {
  const tittel = inn.tittel.trim()

  const dager = Number.isFinite(inn.gyldigDager) && inn.gyldigDager > 0 ? inn.gyldigDager : GYLDIGHET_DAGER
  const id = nyId()
  const r = await supabase.from('quotes').insert({
    id,
    company_id: await mittFirma(),
    title: tittel,
    customer_id: inn.kundeId,
    customer_name: inn.kundeNavn,
    customer_phone: inn.kundeTelefon,
    address: inn.adresse,
    status: 'utkast',
    valid_until: new Date(Date.now() + dager * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (r.error) throw new Error(`Kunne ikke opprette tilbudet: ${r.error.message}`)
  return id
}

export type Tilbudspatch = Partial<{
  title: string
  description: string | null
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  valid_until: string | null
  default_markup_percent: number | null
}>

export async function endreTilbud(id: string, patch: Tilbudspatch): Promise<void> {
  if (Object.keys(patch).length === 0) return
  const r = await supabase.from('quotes').update(patch).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke endre tilbudet: ${r.error.message}`)
}

/**
 * Markerer tilbudet som sendt. Fra da av er det et DOKUMENT: `kanRedigeres`
 * sier nei, og både kontoret og appen slutter å slippe folk til i linjene.
 * Angrevalget finnes, men det er et valg noen må ta, ikke en gråsone.
 */
export async function markerSendt(id: string): Promise<void> {
  const r = await supabase.from('quotes')
    .update({ status: 'sendt', sent_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'utkast')
  if (r.error) throw new Error(`Kunne ikke markere tilbudet som sendt: ${r.error.message}`)
}

export async function angreSendt(id: string): Promise<void> {
  const r = await supabase.from('quotes')
    .update({ status: 'utkast', sent_at: null })
    .eq('id', id).eq('status', 'sendt')
  if (r.error) throw new Error(`Kunne ikke angre: ${r.error.message}`)
}

export async function slettTilbud(id: string): Promise<void> {
  const r = await supabase.from('quotes').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette tilbudet: ${r.error.message}`)
}

/* ── Dokumentet kunden får ─────────────────────────────────────────────── */

/**
 * Tilbudet som HTML — det samme dokumentet appen lager (`lib/pdf/tilbud.ts`).
 *
 * **Kost, påslag og dekningsbidrag følger IKKE med.** En PDF videresendes og
 * skrives ut; det finnes ingen «intern» versjon av et dokument som har forlatt
 * huset. Derfor bygges innholdet av bare det kunden skal se, og
 * `verify:pdf` står vakt over at ingen legger tilbake et tall.
 */
export async function byggTilbudsutskrift(id: string): Promise<string> {
  const [d, f] = await Promise.all([hentTilbudsdetalj(id), hentFirma()])

  const ut = (l: Tilbudslinje): TilbudslinjeUt => ({
    art: l.art,
    beskrivelse: l.beskrivelse,
    antall: l.antall,
    enhet: l.enhet,
    enhetsprisOre: l.enhetsprisOre,
    rabattProsent: l.rabattProsent,
    nettoOre: l.nettoOre,
    elnummer: l.elnummer ?? null,
    valgfri: l.valgfri,
    valgt: l.valgt,
  })

  return dokumentHtml({
    meta: {
      type: 'Tilbud',
      nummer: d.hode.quote_number != null ? String(d.hode.quote_number) : null,
      tittel: d.hode.title,
      dato: d.hode.sent_at ?? new Date().toISOString(),
    },
    avsender: { navn: f.company?.name ?? 'Ampex', orgnr: f.company?.org_number ?? null },
    mottaker: { navn: d.hode.customer_name, adresse: d.hode.address },
    innhold: tilbudInnholdHtml({
      linjer: d.innhold.utenOmrade.map(ut),
      omrader: d.innhold.omrader.map(o => ({
        navn: o.navn,
        niva: o.niva,
        nettoOre: o.nettoOre,
        linjer: o.linjer.map(ut),
      })),
      sum: {
        nettoOre: d.sum.nettoOre,
        rabattOre: d.sum.rabattOre,
        bruttoOre: d.sum.bruttoOre,
        mvaFordeling: d.sum.mvaFordeling.map(m => ({ mva: m.mva, nettoOre: m.nettoOre, mvaOre: m.mvaOre })),
        tilvalgUtenforOre: d.sum.tilvalgUtenforOre,
      },
      mvaEtikett: (m: string) => mvaLabel[m as keyof typeof mvaLabel] ?? m,
      gyldigTil: d.hode.valid_until,
      beskrivelse: d.hode.description,
    }),
  })
}

/** Åpner tilbudet i et utskriftsvindu — veien fra kalkyle til noe kunden kan få. */
export async function skrivUtTilbud(id: string): Promise<void> {
  const vindu = window.open('', '_blank')
  if (!vindu) throw new Error('Nettleseren blokkerte utskriftsvinduet. Tillat popup for denne siden.')
  vindu.document.write('<!doctype html><meta charset="utf-8"><title>Henter …</title><p>Henter tilbudet …</p>')
  try {
    const html = await byggTilbudsutskrift(id)
    vindu.document.open()
    vindu.document.write(html)
    vindu.document.close()
    vindu.focus()
  } catch (e) {
    vindu.close()
    throw e
  }
}
