import { byggTilbudssum, somTilbudStatus, effektivStatus, type TilbudslinjeInn, type TilbudStatus } from '@delt/quoting'
import { supabase } from '@/supabase'

/**
 * Lesing for kontorets registerflater: prosjekter, kunder, tilbud, timer og
 * firmaoppsett.
 *
 * Ingen regning her heller. Tilbudssummen kommer fra `lib/quoting.ts`
 * (`verify:quoting`), ukeinndelingen fra `lib/timesheet-calc.ts`
 * (`verify:timesheet`). Kontoret og montørappen skal aldri kunne komme til to
 * forskjellige svar på det samme tilbudet.
 */

/** Kaster med databasens egen feiltekst i stedet for et generisk «noe gikk galt». */
function sjekk<T>(r: { data: T | null; error: { message: string } | null }, hva: string): T {
  if (r.error) throw new Error(`${hva}: ${r.error.message}`)
  return (r.data ?? []) as T
}

// ── Prosjekter ─────────────────────────────────────────────────────────────

export type Prosjekt = {
  id: string
  name: string
  customer_name: string | null
  address: string | null
  status: string | null
  created_at: string
  /** Utledet: telles opp fra rooms, tasks og project_members. */
  rom: number
  oppgaver: number
  apneOppgaver: number
  deltakere: string[]
}

export async function hentProsjekter(): Promise<Prosjekt[]> {
  const p = sjekk(
    await supabase
      .from('projects')
      .select('id,name,customer_name,address,status,created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    'Kunne ikke lese prosjektene',
  ) as { id: string; name: string; customer_name: string | null; address: string | null; status: string | null; created_at: string }[]

  if (p.length === 0) return []
  const ider = p.map(x => x.id)

  // Tre oppslag i stedet for tre per prosjekt. Et firma med to hundre
  // prosjekter ville ellers gjort seks hundre spørringer for å tegne én liste.
  const [rom, oppgaver, medlemmer] = await Promise.all([
    supabase.from('rooms').select('project_id').in('project_id', ider).is('deleted_at', null),
    supabase.from('tasks').select('project_id,status').in('project_id', ider).is('deleted_at', null),
    supabase.from('project_members').select('project_id,user_name').in('project_id', ider).is('deleted_at', null),
  ])

  const romPer = new Map<string, number>()
  for (const r of sjekk(rom, 'Kunne ikke lese rom') as { project_id: string }[]) {
    romPer.set(r.project_id, (romPer.get(r.project_id) ?? 0) + 1)
  }

  const oppgPer = new Map<string, { alle: number; apne: number }>()
  for (const t of sjekk(oppgaver, 'Kunne ikke lese oppgaver') as { project_id: string; status: string | null }[]) {
    const rad = oppgPer.get(t.project_id) ?? { alle: 0, apne: 0 }
    rad.alle++
    if (t.status !== 'ferdig') rad.apne++
    oppgPer.set(t.project_id, rad)
  }

  const medlPer = new Map<string, string[]>()
  for (const m of sjekk(medlemmer, 'Kunne ikke lese deltakere') as { project_id: string; user_name: string | null }[]) {
    const liste = medlPer.get(m.project_id) ?? []
    if (m.user_name) liste.push(m.user_name)
    medlPer.set(m.project_id, liste)
  }

  return p.map(x => ({
    ...x,
    rom: romPer.get(x.id) ?? 0,
    oppgaver: oppgPer.get(x.id)?.alle ?? 0,
    apneOppgaver: oppgPer.get(x.id)?.apne ?? 0,
    deltakere: medlPer.get(x.id) ?? [],
  }))
}

// ── Kunder ─────────────────────────────────────────────────────────────────

export type Kunde = {
  id: string
  name: string
  org_nr: string | null
  is_company: boolean | null
  email: string | null
  phone: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  source_system: string | null
  /** Utledet: antall ordrer knyttet til kunden. */
  ordrer: number
}

export async function hentKunder(sok: string): Promise<Kunde[]> {
  const q = supabase
    .from('customers')
    .select('id,name,org_nr,is_company,email,phone,address,postal_code,city,source_system')
    .is('deleted_at', null)
    .order('name')
    .limit(500)
  const s = sok.trim()
  if (s) q.or(`name.ilike.%${s}%,org_nr.ilike.%${s}%,phone.ilike.%${s}%,city.ilike.%${s}%`)

  const kunder = sjekk(await q, 'Kunne ikke lese kunderegisteret') as Omit<Kunde, 'ordrer'>[]
  if (kunder.length === 0) return []

  const ordrer = sjekk(
    await supabase
      .from('orders')
      .select('customer_id')
      .in('customer_id', kunder.map(k => k.id))
      .is('deleted_at', null),
    'Kunne ikke telle ordrer',
  ) as { customer_id: string | null }[]

  const per = new Map<string, number>()
  for (const o of ordrer) if (o.customer_id) per.set(o.customer_id, (per.get(o.customer_id) ?? 0) + 1)

  return kunder.map(k => ({ ...k, ordrer: per.get(k.id) ?? 0 }))
}

// ── Tilbud ─────────────────────────────────────────────────────────────────

export type Tilbud = {
  id: string
  quote_number: number | null
  title: string
  customer_name: string | null
  status: TilbudStatus
  /** Statusen ETTER at gyldighetsdatoen er tatt med. Et sendt tilbud som gikk ut er utløpt. */
  visning: TilbudStatus
  valid_until: string | null
  sent_at: string | null
  decided_at: string | null
  linjer: number
  bruttoOre: number
}

export async function hentTilbud(): Promise<Tilbud[]> {
  const q = sjekk(
    await supabase
      .from('quotes')
      .select('id,quote_number,title,customer_name,status,valid_until,sent_at,decided_at')
      .is('deleted_at', null)
      .order('quote_number', { ascending: false, nullsFirst: false })
      .limit(300),
    'Kunne ikke lese tilbudene',
  ) as {
    id: string; quote_number: number | null; title: string; customer_name: string | null
    status: string | null; valid_until: string | null; sent_at: string | null; decided_at: string | null
  }[]

  if (q.length === 0) return []

  const linjer = sjekk(
    await supabase
      .from('quote_lines')
      .select('id,quote_id,kind,description,elnummer,quantity,unit,unit_price,cost_price,discount_percent,vat_type,sort_order')
      .in('quote_id', q.map(x => x.id))
      .is('deleted_at', null)
      .order('sort_order'),
    'Kunne ikke lese tilbudslinjene',
  ) as {
    id: string; quote_id: string; kind: string | null; description: string | null; elnummer: string | null
    quantity: number | null; unit: string | null; unit_price: number | null; cost_price: number | null
    discount_percent: number | null; vat_type: string | null
  }[]

  const per = new Map<string, TilbudslinjeInn[]>()
  for (const l of linjer) {
    const liste = per.get(l.quote_id) ?? []
    liste.push({
      id: l.id,
      // `kind` er allerede TilbudslinjeArt i basen (se lib/db/models/quote-line.ts).
      // Vakten står likevel: en ukjent verdi skal bli en tekstlinje uten beløp,
      // ikke en materiellinje som stille legger penger til summen.
      art: l.kind === 'materiell' || l.kind === 'arbeid' ? l.kind : 'tekst',
      beskrivelse: l.description ?? '',
      antall: l.quantity,
      enhet: l.unit,
      enhetsprisKr: l.unit_price,
      kostprisKr: l.cost_price,
      rabattProsent: l.discount_percent,
      mvaType: l.vat_type,
      elnummer: l.elnummer,
    })
    per.set(l.quote_id, liste)
  }

  const naa = Date.now()
  return q.map(x => {
    const status = somTilbudStatus(x.status)
    const sum = byggTilbudssum(per.get(x.id) ?? [])
    return {
      id: x.id,
      quote_number: x.quote_number,
      title: x.title,
      customer_name: x.customer_name,
      status,
      visning: effektivStatus(status, x.valid_until ? new Date(x.valid_until).getTime() : null, naa),
      valid_until: x.valid_until,
      sent_at: x.sent_at,
      decided_at: x.decided_at,
      linjer: (per.get(x.id) ?? []).length,
      bruttoOre: sum.bruttoOre,
    }
  })
}

// ── Timer ──────────────────────────────────────────────────────────────────

export type Timerad = {
  id: string
  user_id: string
  user_name: string | null
  date: string
  hours: number
  billable: boolean | null
  activity_id: string | null
  order_id: string | null
}

export async function hentTimerIPerioden(fra: Date, til: Date): Promise<Timerad[]> {
  return sjekk(
    await supabase
      .from('time_entries')
      .select('id,user_id,user_name,date,hours,billable,activity_id,order_id')
      .gte('date', fra.toISOString())
      .lte('date', til.toISOString())
      .is('deleted_at', null)
      .order('date'),
    'Kunne ikke lese timene',
  ) as Timerad[]
}

// ── Firma ──────────────────────────────────────────────────────────────────

/**
 * En ansatt slik firmaflata trenger henne.
 *
 * `har_logget_inn` og `invitert_at` står i `auth.users` og ikke i `profiles`.
 * Uten dem er en som ble invitert i går og en som har jobbet her i to år
 * nøyaktig samme rad, og den som inviterte vet ikke om han skal purre.
 * Hentes med `firmaets_ansatte()` — se migrasjonen 20260822120000.
 */
export type Ansatt = {
  id: string
  full_name: string
  epost: string | null
  role: string
  phone: string | null
  har_logget_inn: boolean
  invitert_at: string | null
}

export type Firmaoppsett = {
  company: { id: string; name: string; org_number: string | null } | null
  innstillinger: {
    retention_years: number
    /** Tillat at skann bakes paa Ampex sine maskiner. Av som standard. */
    ampex_pool: boolean
    faglig_ansvarlig: string | null
    regnskapssystem: string
  } | null
  ansatte: Ansatt[]
  /**
   * Bake-nodene, fra `worker_nodes`.
   *
   * Sto mot `scan_workers` til 22. august. Den tabellen var tom og ingen
   * funksjon skrev til den — hele kjeden fra innmelding til ferdig bake går
   * mot `worker_nodes`. En PC som meldte seg inn ville altså aldri dukket opp
   * på Firma-flata. Se migrasjonen 20260822140000.
   */
  noder: {
    id: string
    name: string
    hostname: string | null
    gpu_name: string | null
    vram_mb: number | null
    /** `idle` | `busy` | `offline`. Se check-constrainten på tabellen. */
    status: string
    /** Med i Ampex-poolen, altså tilgjengelig for andre firmaers overflow. */
    is_public: boolean
    /** Satt når noden er trukket. Da skal den ikke få jobber igjen. */
    revoked_at: string | null
    last_heartbeat_at: string | null
    worker_version: string | null
  }[]
}

export async function hentFirma(): Promise<Firmaoppsett> {
  const [c, s, a, n] = await Promise.all([
    supabase.from('companies').select('id,name,org_number').is('deleted_at', null).limit(1).maybeSingle(),
    supabase.from('company_settings').select('retention_years,faglig_ansvarlig,regnskapssystem,ampex_pool').limit(1).maybeSingle(),
    supabase.rpc('firmaets_ansatte'),
    supabase.from('worker_nodes').select('id,name,hostname,gpu_name,vram_mb,status,is_public,revoked_at,last_heartbeat_at,worker_version').is('deleted_at', null).order('name'),
  ])

  const forste = [c, s, a, n].find(r => r.error)
  if (forste?.error) throw new Error(forste.error.message)

  return {
    company: (c.data ?? null) as Firmaoppsett['company'],
    innstillinger: (s.data ?? null) as Firmaoppsett['innstillinger'],
    ansatte: (a.data ?? []) as Firmaoppsett['ansatte'],
    noder: (n.data ?? []) as Firmaoppsett['noder'],
  }
}
