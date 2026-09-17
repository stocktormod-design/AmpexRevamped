import {
  byggTilbudssum, effektivStatus, grupperTilbud, kanRedigeres, somTilbudStatus,
  type Omrade, type TilbudsInnhold, type TilbudslinjeArt, type TilbudslinjeInn,
  type Tilbudssum, type TilbudStatus,
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

function somInn(l: Linjerad): TilbudslinjeInn {
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
  }
}

export async function hentTilbudsdetalj(id: string): Promise<Tilbudsdetalj> {
  const hoder = sjekk(
    await supabase
      .from('quotes')
      .select('id,quote_number,title,description,customer_id,customer_name,customer_phone,address,status,valid_until,sent_at,project_id')
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
      .select('id,section_id,sort_order,kind,description,elnummer,quantity,unit,unit_price,cost_price,discount_percent,vat_type')
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
}

export async function nyLinje(quoteId: string, inn: NyLinje): Promise<string> {
  const eksisterende = sjekk(
    await supabase.from('quote_lines').select('sort_order').eq('quote_id', quoteId).is('deleted_at', null),
    'Kunne ikke lese linjene',
  ) as { sort_order: number }[]

  const id = nyId()
  const r = await supabase.from('quote_lines').insert({
    id,
    company_id: await mittFirma(),
    quote_id: quoteId,
    section_id: inn.sectionId,
    sort_order: eksisterende.reduce((maks, l) => Math.max(maks, l.sort_order), -1) + 1,
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
  })
  if (r.error) throw new Error(`Kunne ikke legge til linja: ${r.error.message}`)
  return id
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
}>

export async function endreLinje(id: string, patch: Linjepatch): Promise<void> {
  if (Object.keys(patch).length === 0) return
  const r = await supabase.from('quote_lines').update(patch).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke endre linja: ${r.error.message}`)
}

export async function slettLinje(id: string): Promise<void> {
  const r = await supabase.from('quote_lines').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette linja: ${r.error.message}`)
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

export async function opprettTilbud(inn: NyttTilbud): Promise<string> {
  const tittel = inn.tittel.trim()
  if (!tittel) throw new Error('Tilbudet må ha en tittel.')

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

  const ut = (l: { art: TilbudslinjeArt; beskrivelse: string; antall: number; enhet: string; enhetsprisOre: number; rabattProsent: number; nettoOre: number; elnummer?: string | null }): TilbudslinjeUt => ({
    art: l.art,
    beskrivelse: l.beskrivelse,
    antall: l.antall,
    enhet: l.enhet,
    enhetsprisOre: l.enhetsprisOre,
    rabattProsent: l.rabattProsent,
    nettoOre: l.nettoOre,
    elnummer: l.elnummer ?? null,
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
