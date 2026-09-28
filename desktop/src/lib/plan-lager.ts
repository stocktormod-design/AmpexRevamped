import { supabase } from '@/supabase'

/**
 * Ett prosjekt på kontoret: mappetreet, tegningene, brannkomponentene på dem og
 * oppgavene som er festet til et punkt. Samme rader som telefonen synker —
 * kontoret leser dem rett fra basen (regel 2), og regner fremdriften med
 * `@delt/prosjekt-fremdrift` så PC og telefon aldri viser to tall.
 */

function sjekk<T>(r: { data: T | null; error: { message: string } | null }, hva: string): T {
  if (r.error) throw new Error(`${hva}: ${r.error.message}`)
  return (r.data ?? []) as T
}

export type PlanTegning = { id: string; name: string; plan: string | null; file_path: string | null; discipline: string | null; folder_id: string | null }
export type PlanMappe = { id: string; name: string; parent_id: string | null; sort_order: number | null }
export type PlanEnhet = { id: string; drawing_id: string | null; x: number; y: number; kind: string; tag: string; placed_at: string | null; model: string | null; serial: string | null; note: string | null }
export type PlanOppgave = { id: string; title: string; status: string; drawing_id: string | null; pin_x: number | null; pin_y: number | null; assigned_to: string | null; frist_at: string | null; created_at: string }
export type PlanMedlem = { user_id: string; user_name: string | null }

export type ProsjektPlan = {
  prosjekt: { id: string; name: string; customer_name: string | null; address: string | null; status: string | null }
  tegninger: PlanTegning[]
  mapper: PlanMappe[]
  enheter: PlanEnhet[]
  oppgaver: PlanOppgave[]
  medlemmer: PlanMedlem[]
}

export async function hentProsjektPlan(projectId: string): Promise<ProsjektPlan> {
  const [p, t, e, o, m, f] = await Promise.all([
    supabase.from('projects').select('id,name,customer_name,address,status').eq('id', projectId).single(),
    supabase.from('drawings').select('id,name,plan,file_path,discipline,folder_id').eq('project_id', projectId).is('deleted_at', null).order('plan').order('name'),
    supabase.from('fire_devices').select('id,drawing_id,x,y,kind,tag,placed_at,model,serial,note').eq('project_id', projectId).is('deleted_at', null).order('tag'),
    supabase.from('tasks').select('id,title,status,drawing_id,pin_x,pin_y,assigned_to,frist_at,created_at').eq('project_id', projectId).is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('project_members').select('user_id,user_name').eq('project_id', projectId).is('deleted_at', null),
    supabase.from('drawing_folders').select('id,name,parent_id,sort_order').eq('project_id', projectId).is('deleted_at', null).order('sort_order').order('name'),
  ])
  if (p.error) throw new Error(`Kunne ikke lese prosjektet: ${p.error.message}`)
  return {
    prosjekt: p.data as ProsjektPlan['prosjekt'],
    tegninger: sjekk(t, 'Kunne ikke lese tegningene') as PlanTegning[],
    enheter: sjekk(e, 'Kunne ikke lese brannkomponentene') as PlanEnhet[],
    oppgaver: sjekk(o, 'Kunne ikke lese oppgavene') as PlanOppgave[],
    medlemmer: sjekk(m, 'Kunne ikke lese deltakerne') as PlanMedlem[],
    mapper: sjekk(f, 'Kunne ikke lese mappene') as PlanMappe[],
  }
}

/** Signert lese-URL til tegningens PDF i R2 — samme kanal (`r2-sign`) som appen. */
export async function tegningUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('r2-sign', { body: { key: filePath, method: 'get' } })
  if (error) throw new Error(`Fikk ikke hentet tegningen: ${error.message}`)
  if (!data?.url) throw new Error(data?.error ?? 'Fikk ikke hentet tegningen')
  return data.url as string
}
