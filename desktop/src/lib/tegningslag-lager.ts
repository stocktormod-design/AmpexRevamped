import { lesProsjektering, type Prosjektering } from '@delt/prosjektering'
import { supabase } from '@/supabase'
import { nyId } from '@/lib/kontor-lager'

/**
 * Tegningslaget: ett dokument i `tegningslag.data` per ordre ELLER per prosjekttegning,
 * skrevet rett mot basen (regel 2 — kontoret skriver ikke via WatermelonDB). Planbildet ligger i R2 under
 * `drawings/`, signert av `r2-sign` som tegningene. Delingslenka leses av edge-funksjonen
 * `delt-ordre` uten innlogging.
 */

export type Lagret = { id: string; data: Prosjektering; del_token: string | null; updated_at: string }

/** Hvem laget hører til. Aldri begge (CHECK i basen). */
export type Eier = { ordre: string } | { tegning: string }
const kolonne = (e: Eier) => ('ordre' in e ? { order_id: e.ordre } : { drawing_id: e.tegning })

export async function hentTegning(eier: Eier): Promise<Lagret | null> {
  const [k, v] = Object.entries(kolonne(eier))[0]
  const { data, error } = await supabase.from('tegningslag')
    .select('id,data,del_token,updated_at').eq(k, v).is('deleted_at', null).maybeSingle()
  if (error) throw new Error(`Kunne ikke lese tegningen: ${error.message}`)
  if (!data) return null
  return { ...(data as Lagret), data: lesProsjektering((data as { data: unknown }).data) }
}

/** Lagrer hele dokumentet. Første gang lages raden; id-en kommer tilbake og brukes videre. */
export async function lagreTegning(eier: Eier, id: string | null, data: Prosjektering): Promise<string> {
  if (id) {
    const { error } = await supabase.from('tegningslag').update({ data }).eq('id', id)
    if (error) throw new Error(`Kunne ikke lagre: ${error.message}`)
    return id
  }
  const ny = nyId()
  const { error } = await supabase.from('tegningslag').insert({ id: ny, ...kolonne(eier), data })
  if (error) throw new Error(`Kunne ikke lagre: ${error.message}`)
  return ny
}

/** Laster opp planen (bilde eller PDF) og gir nøkkelen som skal stå i dokumentet. */
export async function lastOppPlan(fil: File): Promise<{ key: string; type: 'bilde' | 'pdf' }> {
  const pdf = fil.type === 'application/pdf' || fil.name.toLowerCase().endsWith('.pdf')
  const ending = pdf ? 'pdf' : (fil.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const key = `drawings/ordre-${nyId()}.${ending}`
  const { data, error } = await supabase.functions.invoke('r2-sign', { body: { key, method: 'put' } })
  if (error) throw new Error(error.message)
  if (!data?.url) throw new Error(data?.error ?? 'Fikk ikke lov til å laste opp')
  const svar = await fetch(data.url as string, { method: 'PUT', body: fil })
    .catch(() => { throw new Error('Lagringen avviste opplastingen (CORS på R2-bøtta)') })
  if (!svar.ok) throw new Error(`Opplastingen svarte ${svar.status}`)
  return { key, type: pdf ? 'pdf' : 'bilde' }
}

export async function planUrl(key: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('r2-sign', { body: { key, method: 'get' } })
  if (error) throw new Error(`Fikk ikke hentet planen: ${error.message}`)
  if (!data?.url) throw new Error(data?.error ?? 'Fikk ikke hentet planen')
  return data.url as string
}

/** Lager (eller gjenbruker) delingsnøkkelen. 32 tilfeldige byte, base64url: kan ikke gjettes. */
export async function delTegning(id: string, eksisterende: string | null): Promise<string> {
  if (eksisterende) return eksisterende
  const b = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const { error } = await supabase.from('tegningslag').update({ del_token: token, delt_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(`Kunne ikke dele: ${error.message}`)
  return token
}

/** Trekker lenka tilbake: den gamle nøkkelen slutter å virke med en gang. */
export async function stoppDeling(id: string): Promise<void> {
  const { error } = await supabase.from('tegningslag').update({ del_token: null, delt_at: null }).eq('id', id)
  if (error) throw new Error(`Kunne ikke stoppe delingen: ${error.message}`)
}

export function delLenke(token: string): string {
  return `${window.location.origin}/#/del/${token}`
}

export type Delt = {
  data: Prosjektering
  ordre: { title: string; order_number: number | null; customer_name: string | null; address: string | null }
  firma: { name: string; org_number: string | null }
  planUrl: string | null
  oppdatert: string
}

/** Uten innlogging: edge-funksjonen slår opp nøkkelen og signerer planbildet. */
export async function hentDelt(token: string): Promise<Delt> {
  const { data, error } = await supabase.functions.invoke('delt-ordre', { body: { token } })
  if (error) throw new Error('Lenka virker ikke lenger, eller den er skrevet feil.')
  if (!data?.data) throw new Error(data?.error ?? 'Fant ikke ordren.')
  return { ...(data as Delt), data: lesProsjektering(data.data) }
}
