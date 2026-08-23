import {
  byggFakturagrunnlag,
  type Fakturagrunnlag,
  type GrunnlagValg,
  type MateriellInn,
  type TilleggInn,
  type TimeInn,
} from '@delt/invoicing'
import { bolkFor, type Bolk } from '@delt/ordrebolk'
import { mittFirma, nyId } from '@/lib/kontor-lager'
import { supabase } from '@/supabase'

/**
 * Ordredata for kontoret.
 *
 * Fakturagrunnlaget REGNES IKKE HER. `lib/invoicing.ts` gjør det, den er ren,
 * den har selvtest (`npm run verify:invoicing`), og montørappen bruker den
 * samme. To regnestykker på samme faktura er én for mye — de sprikte før eller
 * siden, og da er spørsmålet hvilket av dem kunden fikk.
 *
 * Denne fila henter rader og oversetter dem til inndataformen `invoicing.ts`
 * allerede krever. Ingenting mer.
 */

export type Ordrestatus = 'mottatt' | 'planlagt' | 'pagaar' | 'fakturaklar' | 'fakturert'

export const STATUS_NAVN: Record<Ordrestatus, string> = {
  mottatt: 'Mottatt',
  planlagt: 'Planlagt',
  pagaar: 'Pågår',
  fakturaklar: 'Fakturaklar',
  fakturert: 'Fakturert',
}

/** Rekkefølgen kontoret jobber i: nye øverst, ferdige nederst. */
export const STATUS_REKKEFOLGE: Ordrestatus[] = ['mottatt', 'planlagt', 'pagaar', 'fakturaklar', 'fakturert']

export type Ordrerad = {
  id: string
  order_number: number | null
  title: string
  customer_name: string | null
  address: string | null
  status: Ordrestatus
  assigned_to: string | null
  scheduled_at: string | null
  invoiced_at: string | null
  updated_at: string
  quote_id: string | null
  /** Utledet: hvilken av kontorets tre bunker ordren ligger i. */
  bolk: Bolk
  /** Utledet: finnes det en godkjenning som ikke er avvist? */
  godkjent: boolean
  /** Alias for `order_number`, så raden kan sorteres av `lib/ordrebolk.ts`. */
  nummer: number | null
}

const ORDRE_KOLONNER =
  'id,order_number,title,customer_name,address,status,assigned_to,scheduled_at,invoiced_at,updated_at,quote_id'

export type OrdreFilter = {
  /** Tom liste = alle statuser. */
  statuser?: Ordrestatus[]
  sok?: string
  /** Bare ordrer denne brukeren er tildelt eller medlem av. */
  bareMine?: string | null
}

export async function hentOrdrer(filter: OrdreFilter = {}, grense = 500): Promise<Ordrerad[]> {
  let mine: Set<string> | null = null
  if (filter.bareMine) {
    // Medlemskap ligger i order_members; tildeling ligger på ordren. Begge
    // teller som «min ordre», samme regel som lib/order-access.ts bruker.
    const { data, error } = await supabase
      .from('order_members')
      .select('order_id')
      .eq('user_id', filter.bareMine)
      .is('deleted_at', null)
    if (error) throw new Error(error.message)
    mine = new Set((data ?? []).map(r => r.order_id as string))
  }

  const q = supabase
    .from('orders')
    .select(ORDRE_KOLONNER)
    .is('deleted_at', null)
    .order('order_number', { ascending: false, nullsFirst: false })
    .limit(grense)

  if (filter.statuser?.length) q.in('status', filter.statuser)

  const sok = filter.sok?.trim()
  if (sok) {
    // Ett tall skrevet inn er nesten alltid et ordrenummer. Ellers er det navn.
    const somTall = Number(sok)
    if (Number.isInteger(somTall) && somTall > 0) q.eq('order_number', somTall)
    else q.or(`title.ilike.%${sok}%,customer_name.ilike.%${sok}%,address.ilike.%${sok}%`)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  let raa = (data ?? []) as unknown as Omit<Ordrerad, 'bolk' | 'godkjent' | 'nummer'>[]
  if (mine) raa = raa.filter(o => o.assigned_to === filter.bareMine || mine.has(o.id))
  if (raa.length === 0) return []

  // Godkjenningene i ETT oppslag. En ordre som er fakturaklar uten godkjenning
  // er den som venter på et menneske, og det skal synes i lista — ikke først
  // når noen åpner ordren og lurer på hvorfor faktureringen stopper.
  const { data: g, error: gFeil } = await supabase
    .from('order_approvals')
    .select('order_id,beslutning,besluttet_at')
    .in('order_id', raa.map(o => o.id))
    .is('deleted_at', null)
    .order('besluttet_at', { ascending: false })
  if (gFeil) throw new Error(`Kunne ikke lese godkjenningene: ${gFeil.message}`)

  // Nyeste beslutning per ordre vinner. Lista er allerede sortert synkende, så
  // den FØRSTE vi ser for en ordre er den gjeldende.
  const siste = new Map<string, string>()
  for (const r of (g ?? []) as { order_id: string; beslutning: string }[]) {
    if (!siste.has(r.order_id)) siste.set(r.order_id, r.beslutning)
  }

  return raa.map(o => ({
    ...o,
    bolk: bolkFor(o.status),
    godkjent: siste.get(o.id) === 'godkjent',
    nummer: o.order_number,
  }))
}

export type NyOrdre = {
  tittel: string
  kundeId: string | null
  kundeNavn: string
  adresse: string
  beskrivelse: string
}

/**
 * Ny ordre fra kontoret.
 *
 * `order_number` oppgis ikke — den kan ikke oppgis. `assign_order_number()`
 * (migrasjonen 20260823140000) overskriver alltid feltet med neste tall fra
 * firmaets egen serie, uansett hva som sendes. Det er poenget med at nummeret
 * er en fasit: klienten foreslår aldri, den ber om et.
 *
 * `customer_id` er valgfri. Registeret er ferskt — mange ordrer vil peke på en
 * kunde som ikke finnes ennå, og adressen jobben skal utføres på er ofte en
 * annen enn kundens fakturaadresse uansett. Derfor fylles `customer_name` og
 * `address` inn hver for seg og aldri fra hverandre.
 *
 * Ordren opprettes som «mottatt», samme startpunkt som en ordre som kommer inn
 * fra appen. Tildeling, tidspunkt og materiell settes etterpå — dette lager
 * bare selve ordren.
 */
export async function opprettOrdre(inn: NyOrdre, opprettetAv: string): Promise<string> {
  const tittel = inn.tittel.trim()
  if (!tittel) throw new Error('Ordren må ha en tittel.')

  const id = nyId()
  const r = await supabase.from('orders').insert({
    id,
    company_id: await mittFirma(),
    title: tittel,
    customer_id: inn.kundeId,
    customer_name: inn.kundeNavn.trim() || null,
    address: inn.adresse.trim() || null,
    description: inn.beskrivelse.trim() || null,
    created_by: opprettetAv,
  })
  if (r.error) throw new Error(`Kunne ikke opprette ordren: ${r.error.message}`)
  return id
}

export type Materiellrad = {
  id: string
  elnummer: string | null
  description: string
  quantity: number
  unit: string
  unit_price: number | null
  cost_price: number | null
  vat_type: string | null
  billable: boolean | null
  invoiced_at: string | null
  discount_percent: number | null
}

export type Timerad = {
  id: string
  user_id: string
  user_name: string | null
  date: string
  hours: number
  note: string | null
  internal_note: string | null
  activity_id: string | null
  billable: boolean | null
  invoiced_at: string | null
}

export type Tilleggsrad = {
  id: string
  title: string
  description: string | null
  pricing: string
  price: number | null
  vat_type: string | null
  status: string
  approved_by: string | null
  approved_at: string | null
  invoiced_at: string | null
}

export type Dokumentrad = {
  id: string
  template_id: string
  status: string
  completed_at: string | null
  completed_by: string | null
  updated_at: string
}

export type Godkjenningsrad = {
  id: string
  beslutning: string
  godkjenner_navn: string | null
  begrunnelse: string | null
  sum_ore: number | null
  timer: number | null
  antall_materiell: number | null
  antall_dokumenter: number | null
  antall_signaturer: number | null
  besluttet_at: string
}

export type Aktivitet = {
  id: string
  name: string
  hourly_rate: number | null
  billable: boolean | null
  vat_type: string | null
}

export type Deltaker = { user_id: string; user_name: string | null }

export type Ordredetalj = {
  ordre: Omit<Ordrerad, 'bolk' | 'godkjent' | 'nummer'> & { description: string | null; customer_phone: string | null; created_at: string }
  materiell: Materiellrad[]
  timer: Timerad[]
  tillegg: Tilleggsrad[]
  dokumenter: Dokumentrad[]
  godkjenninger: Godkjenningsrad[]
  deltakere: Deltaker[]
  aktiviteter: Map<string, Aktivitet>
}

export async function hentOrdredetalj(orderId: string): Promise<Ordredetalj> {
  const [o, m, t, e, d, g, dl, ak] = await Promise.all([
    supabase.from('orders').select(`${ORDRE_KOLONNER},description,customer_phone,created_at`).eq('id', orderId).is('deleted_at', null).single(),
    supabase.from('order_materials').select('id,elnummer,description,quantity,unit,unit_price,cost_price,vat_type,billable,invoiced_at,discount_percent').eq('order_id', orderId).is('deleted_at', null).order('created_at'),
    supabase.from('time_entries').select('id,user_id,user_name,date,hours,note,internal_note,activity_id,billable,invoiced_at').eq('order_id', orderId).is('deleted_at', null).order('date'),
    supabase.from('order_extras').select('id,title,description,pricing,price,vat_type,status,approved_by,approved_at,invoiced_at').eq('order_id', orderId).is('deleted_at', null).order('created_at'),
    supabase.from('order_documents').select('id,template_id,status,completed_at,completed_by,updated_at').eq('order_id', orderId).is('deleted_at', null).order('updated_at'),
    supabase.from('order_approvals').select('id,beslutning,godkjenner_navn,begrunnelse,sum_ore,timer,antall_materiell,antall_dokumenter,antall_signaturer,besluttet_at').eq('order_id', orderId).is('deleted_at', null).order('besluttet_at', { ascending: false }),
    supabase.from('order_members').select('user_id,user_name').eq('order_id', orderId).is('deleted_at', null),
    supabase.from('activities').select('id,name,hourly_rate,billable,vat_type').is('deleted_at', null),
  ])

  const forste = [o, m, t, e, d, g, dl, ak].find(r => r.error)
  if (forste?.error) throw new Error(forste.error.message)
  if (!o.data) throw new Error('Fant ikke ordren')

  return {
    ordre: o.data as unknown as Ordredetalj['ordre'],
    materiell: (m.data ?? []) as unknown as Materiellrad[],
    timer: (t.data ?? []) as unknown as Timerad[],
    tillegg: (e.data ?? []) as unknown as Tilleggsrad[],
    dokumenter: (d.data ?? []) as unknown as Dokumentrad[],
    godkjenninger: (g.data ?? []) as unknown as Godkjenningsrad[],
    deltakere: (dl.data ?? []) as unknown as Deltaker[],
    aktiviteter: new Map(((ak.data ?? []) as unknown as Aktivitet[]).map(a => [a.id, a])),
  }
}

/**
 * Oversetter radene til inndataformen `lib/invoicing.ts` krever, og lar den
 * regne. Timeprisen og fakturerbarheten ARVES fra aktiviteten når timeraden
 * ikke har satt noe selv — det er samme arv som ukelista i appen bruker, og
 * den er selvtestet i `verify:timesheet`.
 */
export function grunnlagFra(detalj: Ordredetalj, valg: GrunnlagValg = {}): Fakturagrunnlag {
  const materiell: MateriellInn[] = detalj.materiell.map(r => ({
    id: r.id,
    beskrivelse: r.description,
    antall: r.quantity,
    enhet: r.unit,
    elnummer: r.elnummer,
    enhetsprisKr: r.unit_price,
    kostprisKr: r.cost_price,
    mvaType: r.vat_type,
    fakturerbar: r.billable,
    fakturertTid: r.invoiced_at ? new Date(r.invoiced_at).getTime() : null,
    rabattProsent: r.discount_percent,
  }))

  const timer: TimeInn[] = detalj.timer.map(r => {
    const a = r.activity_id ? detalj.aktiviteter.get(r.activity_id) : undefined
    return {
      id: r.id,
      aktivitetId: r.activity_id,
      aktivitetNavn: a?.name ?? null,
      aktivitetTimepris: a?.hourly_rate ?? null,
      aktivitetFakturerbar: a?.billable ?? null,
      aktivitetMva: a?.vat_type ?? null,
      personId: r.user_id,
      personNavn: r.user_name ?? '',
      dato: new Date(r.date).getTime(),
      timer: r.hours,
      notat: r.note,
      fakturerbar: r.billable,
      fakturertTid: r.invoiced_at ? new Date(r.invoiced_at).getTime() : null,
    }
  })

  const tillegg: TilleggInn[] = detalj.tillegg.map(r => ({
    id: r.id,
    tittel: r.title,
    beskrivelse: r.description,
    prising: r.pricing === 'fastpris' ? 'fastpris' : 'medgatt',
    prisKr: r.price,
    mvaType: r.vat_type,
    status: r.status === 'godkjent' || r.status === 'avvist' ? r.status : 'foreslatt',
    godkjentAv: r.approved_by,
    fakturertTid: r.invoiced_at ? new Date(r.invoiced_at).getTime() : null,
  }))

  return byggFakturagrunnlag(materiell, timer, valg, tillegg)
}

/**
 * Får den innloggede lov til å godkjenne faglig?
 *
 * Spør databasen, som er den eneste som vet: `company_settings.faglig_ansvarlig`
 * peker på én person, og `kan_godkjenne_faglig()` er den samme funksjonen
 * montørappen bruker. Rollematrisen i `lib/kontor-tilgang.ts` svarer IKKE på
 * dette — en installatør er ikke automatisk firmaets faglig ansvarlige.
 */
export async function kanGodkjenneFaglig(): Promise<boolean> {
  const { data, error } = await supabase.rpc('kan_godkjenne_faglig')
  if (error || typeof data !== 'boolean') return false
  return data
}

// ── Fakturering ────────────────────────────────────────────────────────────

export class ManglerGodkjenning extends Error {
  constructor() {
    super('Ordren må godkjennes av faglig ansvarlig før den kan faktureres.')
    this.name = 'ManglerGodkjenning'
  }
}

/**
 * Marker som fakturert.
 *
 * Speiler `lib/order-billing.ts` sin `markerFakturert()` linje for linje, fordi
 * de to må gjøre nøyaktig det samme: LINJENE merkes, ikke bare ordren.
 *
 * Grunnen står i den fila og er verdt å gjenta: en ordre kan faktureres flere
 * ganger etter hvert som det kommer på mer arbeid, og neste fakturagrunnlag
 * utelater linjer som alt har `invoiced_at`. Merkes bare ordren, havner de
 * samme linjene på neste faktura, og kunden betaler to ganger for samme jobb.
 *
 * Godkjenningen sjekkes her OG i databasen (`krev_faglig_godkjenning`). Den her
 * finnes for å gi en lesbar feilmelding; den i basen er den som gjelder.
 */
export async function markerFakturert(
  orderId: string,
  grunnlag: Fakturagrunnlag,
  eksternId: string | null,
): Promise<void> {
  const { count, error: gFeil } = await supabase
    .from('order_approvals')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .eq('beslutning', 'godkjent')
    .is('deleted_at', null)
  if (gFeil) throw new Error(`Kunne ikke sjekke godkjenningen: ${gFeil.message}`)
  if (!count) throw new ManglerGodkjenning()

  const naa = new Date().toISOString()
  const ider = (kilde: 'materiell' | 'timer' | 'tillegg') =>
    grunnlag.linjer.filter(l => l.kilde === kilde).flatMap(l => l.kildeIder)

  const tabeller: [string, string[]][] = [
    ['order_materials', ider('materiell')],
    ['time_entries', ider('timer')],
    ['order_extras', ider('tillegg')],
  ]

  // Linjene FØRST. Ryker nettet mellom skrivingene, står ordren igjen som
  // ufakturert med noen merkede linjer — irriterende, men trygt. Motsatt
  // rekkefølge ville gitt en fakturert ordre med ufakturerte linjer, og DE
  // havner på neste faktura.
  for (const [tabell, liste] of tabeller) {
    if (liste.length === 0) continue
    const { error } = await supabase.from(tabell).update({ invoiced_at: naa }).in('id', liste)
    if (error) throw new Error(`Kunne ikke merke linjene i ${tabell}: ${error.message}`)
  }

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'fakturert',
      invoiced_at: naa,
      ...(eksternId ? { invoice_external_id: eksternId } : {}),
    })
    .eq('id', orderId)
  if (error) throw new Error(`Linjene ble merket, men ordren ble ikke oppdatert: ${error.message}`)
}

/**
 * Kan ordren fryses til arkiv?
 *
 * `kan_fryses()` i databasen er fasit. Den vet hva oppbevaringsplikten krever
 * og hva som mangler, og svaret skal ikke gjettes på klienten.
 */
export async function kanFryses(orderId: string): Promise<{ ok: boolean; grunn: string | null }> {
  const { data, error } = await supabase.rpc('kan_fryses', { p_order_id: orderId })
  if (error) return { ok: false, grunn: error.message }
  if (typeof data === 'boolean') return { ok: data, grunn: data ? null : 'Ordren er ikke klar til arkivering.' }
  return { ok: false, grunn: null }
}

export type Arkivrad = {
  id: string
  r2_key: string
  sha256: string
  bytes: number
  frosset_at: string
  oppbevares_til: string | null
}

/** Finnes det allerede et arkiv for ordren? */
export async function hentArkiv(orderId: string): Promise<Arkivrad | null> {
  const { data, error } = await supabase
    .from('order_archives')
    .select('id,r2_key,sha256,bytes,frosset_at,oppbevares_til')
    .eq('order_id', orderId)
    .is('deleted_at', null)
    .order('frosset_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as Arkivrad | null
}
