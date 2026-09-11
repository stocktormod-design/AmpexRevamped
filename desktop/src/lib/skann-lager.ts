import { supabase } from '@/supabase'

/**
 * Skannekøen sett fra kontoret, og bakepoolen bak den.
 *
 * Den viktigste raden her er den som ikke er lastet opp ennå. Et skann som
 * ligger på en telefon i status `venter` er usynlig for alle andre enn den som
 * tok det — og det er nettopp derfor jobben opprettes FØR opplasting, med
 * `venter_paa` som sier hvorfor den venter. Uten den raden vet ikke kontoret at
 * dokumentasjonen finnes, bare at den ikke har kommet.
 *
 * Ingen regning her. Køposisjon og anslag kommer fra `scan_job_queue_position`
 * i databasen, som regner ut fra faktisk brukt tid på fullførte jobber.
 */

function sjekk<T>(r: { data: T | null; error: { message: string } | null }, hva: string): T {
  if (r.error) throw new Error(`${hva}: ${r.error.message}`)
  return (r.data ?? []) as T
}

export type Skannstatus =
  | 'venter'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'done'
  | 'failed'
  | 'canceled'

/** Radene slik de ligger i basen. Ikke bruk denne i UI — se `Skannjobb`. */
export type SkannjobbRad = {
  id: string
  status: Skannstatus
  /** Bare satt når status er `venter`. Hvorfor den ikke er lastet opp. */
  venter_paa: string | null
  pool: 'firm' | 'ampex'
  allow_ampex_pool: boolean
  kind: 'mesh' | 'splat' | 'begge'
  bundle_bytes: number | null
  uploaded_bytes: number | null
  frame_count: number | null
  progress: number
  error: string | null
  output_key: string | null
  splat_key: string | null
  gpu_ms: number | null
  filled_fraction: number | null
  created_at: string
  uploaded_at: string | null
  frames_deleted_at: string | null
  requested_by: string | null
  order_scan_id: string | null
}

/**
 * Raden pluss det som slås opp ved siden av.
 *
 * Navnet ligger ikke i `scan_jobs` med vilje: en jobb peker på `requested_by`,
 * og navnet hentes fra profiles. Skilt fra radtypen fordi TypeScript ellers
 * later som databasen returnerer felter den ikke har.
 */
export type Skannjobb = SkannjobbRad & {
  tatt_av: string | null
  ordrenummer: number | null
  ordretittel: string | null
}

export type Node = {
  id: string
  name: string
  gpu_name: string | null
  worker_version: string | null
  status: string
  is_public: boolean
  last_heartbeat_at: string | null
  revoked_at: string | null
  created_at: string
}

export type Poolstatus = {
  jobber: Skannjobb[]
  noder: Node[]
  /** Forbruk siste 30 dager, i bytes. */
  forbruk: number
  tak_per_jobb: number
  tak_per_mnd: number
  ampex_pool_pa: boolean
}

export async function hentSkannkoe(): Promise<Poolstatus> {
  const [jobbSvar, nodeSvar, innst, firma] = await Promise.all([
    supabase
      .from('scan_jobs')
      // ÉN literal, ikke satt sammen med +: typeparseren i supabase-js leser
      // select-strengen på typenivå, og gir opp på et uttrykk.
      .select('id,status,venter_paa,pool,allow_ampex_pool,kind,bundle_bytes,uploaded_bytes,frame_count,progress,error,output_key,splat_key,gpu_ms,filled_fraction,created_at,uploaded_at,frames_deleted_at,requested_by,order_scan_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('worker_nodes')
      .select('id,name,gpu_name,worker_version,status,is_public,last_heartbeat_at,revoked_at,created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    supabase.from('pool_settings').select('maks_bytes_per_jobb,maks_bytes_per_firma_mnd').maybeSingle(),
    supabase.from('company_settings').select('ampex_pool').maybeSingle(),
  ])

  const raa = sjekk(jobbSvar, 'skannekø') as SkannjobbRad[]
  const noder = sjekk(nodeSvar, 'noder') as Node[]

  // Navn på den som skannet. Eget oppslag framfor en join, fordi RLS på
  // profiles og scan_jobs er to forskjellige policyer og en join som feiler
  // delvis er verre enn to kall som feiler tydelig.
  const ider = [...new Set(raa.map(j => j.requested_by).filter(Boolean))] as string[]
  const navn = new Map<string, string>()
  if (ider.length > 0) {
    const p = await supabase.from('profiles').select('id,full_name').in('id', ider)
    for (const rad of p.data ?? []) navn.set(rad.id, rad.full_name ?? '')
  }

  const jobber: Skannjobb[] = raa.map(j => ({
    ...j,
    tatt_av: j.requested_by ? (navn.get(j.requested_by) || null) : null,
    ordrenummer: null,
    ordretittel: null,
  }))

  const forbruk = jobber
    .filter(j => j.status !== 'canceled' && Date.parse(j.created_at) > Date.now() - 30 * 864e5)
    .reduce((sum, j) => sum + (j.uploaded_bytes ?? j.bundle_bytes ?? 0), 0)

  return {
    jobber,
    noder,
    forbruk,
    tak_per_jobb: innst.data?.maks_bytes_per_jobb ?? 0,
    tak_per_mnd: innst.data?.maks_bytes_per_firma_mnd ?? 0,
    ampex_pool_pa: firma.data?.ampex_pool ?? false,
  }
}

/**
 * Slå Ampex-poolen av eller på.
 *
 * Dette er ikke en ytelsesinnstilling. Slått på betyr at et skann — LiDAR av
 * kundens bolig — kan pakkes ut på en maskin firmaet ikke eier. Basen håndhever
 * det uansett (`krev_ampex_pool_samtykke`), men brukeren skal forstå hva han
 * krysser av for, ikke oppdage det etterpå.
 */
export async function settAmpexPool(pa: boolean): Promise<void> {
  const { data: firma } = await supabase.rpc('current_company_id')
  if (!firma) throw new Error('Ingen firmakontekst.')
  const { error } = await supabase
    .from('company_settings')
    .upsert({ company_id: firma, ampex_pool: pa }, { onConflict: 'company_id' })
  if (error) throw new Error(`Kunne ikke lagre: ${error.message}`)
}

/** Engangskode til innmelding av en PC. Vises ÉN gang. */
export async function lagInnmeldingskode(minutter = 30): Promise<string> {
  const { data, error } = await supabase.rpc('create_worker_enrollment', { ttl_minutes: minutter })
  if (error) throw new Error(`Kunne ikke lage kode: ${error.message}`)
  return data as string
}

// ── Presentasjon ───────────────────────────────────────────────────────────

export function bytes(n: number | null | undefined): string {
  // null er ukjent, 0 er kjent. Et forbruk på null bytes skal stå som 0 MB —
  // en tankestrek der ville lest som «vi vet ikke hvor mye du har brukt».
  if (n == null) return '–'
  if (n === 0) return '0 MB'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1048576)} MB`
  return `${(n / 1073741824).toFixed(1)} GB`
}

export const STATUSNAVN: Record<Skannstatus, string> = {
  venter: 'På telefonen',
  queued: 'I kø',
  claimed: 'Tildelt',
  running: 'Bakes',
  done: 'Ferdig',
  failed: 'Feilet',
  canceled: 'Avbrutt',
}

export const VENTER_PAA_NAVN: Record<string, string> = {
  wifi: 'venter på wifi',
  lading: 'venter på lading',
  plass: 'venter på lagringsplass',
  bruker: 'venter på at montøren starter den',
}

/** Er noden i live? To minutter uten hjerteslag regnes som nede. */
export function nodeOppe(n: Node): boolean {
  if (n.revoked_at) return false
  if (!n.last_heartbeat_at) return false
  return Date.parse(n.last_heartbeat_at) > Date.now() - 120_000
}
