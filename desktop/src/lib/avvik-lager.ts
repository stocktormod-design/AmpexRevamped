import { supabase } from '@/supabase'
import { nyId } from '@/lib/kontor-lager'

/**
 * Avvik på kontoret. Samme tabell som montørappen skriver til via
 * `lib/avvik.ts` (`deviations`), men rett mot Supabase — kontoret er ikke
 * offline (regel 2). Livssyklusen er den samme: funnet → lukket med tiltak.
 * Databasen krever tiltaket (`deviations_lukking_ck`), ikke bare UI-et.
 */

export type Alvorlighet = 'lav' | 'middels' | 'hoy' | 'kritisk'
export type AvvikStatus = 'apent' | 'lukket'

export const ALVORLIGHET: { verdi: Alvorlighet; navn: string }[] = [
  { verdi: 'kritisk', navn: 'Kritisk' },
  { verdi: 'hoy', navn: 'Høy' },
  { verdi: 'middels', navn: 'Middels' },
  { verdi: 'lav', navn: 'Lav' },
]
export const ALVORLIGHET_NAVN: Record<Alvorlighet, string> =
  Object.fromEntries(ALVORLIGHET.map(a => [a.verdi, a.navn])) as Record<Alvorlighet, string>
const VEKT: Record<Alvorlighet, number> = { kritisk: 0, hoy: 1, middels: 2, lav: 3 }

export type Avvik = {
  id: string
  tittel: string
  beskrivelse: string | null
  alvorlighet: Alvorlighet
  status: AvvikStatus
  sted: string | null
  frist_at: string | null
  funnet_av: string | null
  funnet_at: string
  tiltak: string | null
  lukket_av: string | null
  lukket_at: string | null
  order_id: string | null
  project_id: string | null
}

function sjekk<T>(r: { data: T | null; error: { message: string } | null }, hva: string): T {
  if (r.error) throw new Error(`${hva}: ${r.error.message}`)
  return (r.data ?? []) as T
}

/** Alle avvik i firmaet. Det farligste først, så det som forfaller først, så nyeste. */
export async function hentAvvik(): Promise<Avvik[]> {
  const rader = sjekk(
    await supabase.from('deviations')
      .select('id,tittel,beskrivelse,alvorlighet,status,sted,frist_at,funnet_av,funnet_at,tiltak,lukket_av,lukket_at,order_id,project_id')
      .is('deleted_at', null),
    'Kunne ikke lese avvikene',
  ) as Avvik[]
  return rader.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'apent' ? -1 : 1
    const v = VEKT[a.alvorlighet] - VEKT[b.alvorlighet]
    if (v !== 0) return v
    const af = a.frist_at ? Date.parse(a.frist_at) : Number.MAX_SAFE_INTEGER
    const bf = b.frist_at ? Date.parse(b.frist_at) : Number.MAX_SAFE_INTEGER
    if (af !== bf) return af - bf
    return Date.parse(b.funnet_at) - Date.parse(a.funnet_at)
  })
}

export async function meldAvvik(inn: {
  tittel: string
  beskrivelse?: string | null
  alvorlighet?: Alvorlighet
  sted?: string | null
  frist?: string | null
}): Promise<string> {
  const tittel = inn.tittel.trim()
  if (!tittel) throw new Error('Avviket må ha en overskrift.')
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? null
  const id = nyId()
  const r = await supabase.from('deviations').insert({
    id,
    tittel,
    beskrivelse: inn.beskrivelse?.trim() || null,
    alvorlighet: inn.alvorlighet ?? 'middels',
    status: 'apent',
    sted: inn.sted?.trim() || null,
    frist_at: inn.frist || null,
    funnet_av: bruker,
    funnet_at: new Date().toISOString(),
  })
  if (r.error) throw new Error(`Kunne ikke melde avviket: ${r.error.message}`)
  return id
}

/** Lukker med tiltak. Tomt tiltak stoppes her OG i basen. */
export async function lukkAvvik(id: string, tiltak: string): Promise<void> {
  const rent = tiltak.trim()
  if (!rent) throw new Error('Et avvik lukkes med et tiltak — skriv hva som ble gjort.')
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? null
  const r = await supabase.from('deviations')
    .update({ tiltak: rent, status: 'lukket', lukket_av: bruker, lukket_at: new Date().toISOString() })
    .eq('id', id)
  if (r.error) throw new Error(`Kunne ikke lukke avviket: ${r.error.message}`)
}

/** Gjenåpner. Tiltaket blir stående — det er historikken. */
export async function gjenapneAvvik(id: string): Promise<void> {
  const r = await supabase.from('deviations')
    .update({ status: 'apent', lukket_av: null, lukket_at: null })
    .eq('id', id)
  if (r.error) throw new Error(`Kunne ikke gjenåpne avviket: ${r.error.message}`)
}

export async function endreAvvik(id: string, patch: Partial<Pick<Avvik, 'tittel' | 'beskrivelse' | 'alvorlighet' | 'sted' | 'frist_at'>>): Promise<void> {
  const r = await supabase.from('deviations').update(patch).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke lagre avviket: ${r.error.message}`)
}

/** Soft delete — for feilmeldte avvik, ikke for lukking. */
export async function slettAvvik(id: string): Promise<void> {
  const r = await supabase.from('deviations').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette avviket: ${r.error.message}`)
}
