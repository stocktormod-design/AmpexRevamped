import { supabase } from '@/supabase'
import { kanFlyttesTil, slettePlan } from '@delt/tegning-tre'

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


// ── Hierarkiet: mapper i mapper, som i en OneDrive-mappe ────────────────────
// Alle skrivinger er myke (deleted_at, regel 5) og auditeres av databasetriggeren
// `audit_row`. Slettp lanen flytter innholdet ett hakk opp i SAMME operasjon, så
// en tegning aldri blir foreldreløs og usynlig.

function krev(error: { message: string } | null, hva: string) {
  if (error) throw new Error(`${hva}: ${error.message}`)
}

export async function opprettMappe(
  projectId: string, parentId: string | null, name: string, createdBy: string | null, companyId: string | null,
): Promise<string> {
  if (!companyId) throw new Error('Du hører ikke til et firma.')
  // `drawing_folders.id` har ingen database-default (i motsetning til de fleste
  // tabellene), så kontoret må lage uuid-en selv — samme form som appen.
  const id = crypto.randomUUID()
  const { error } = await supabase.from('drawing_folders').insert({
    id, company_id: companyId, project_id: projectId, parent_id: parentId,
    name: name.trim(), sort_order: 0, created_by: createdBy,
  })
  krev(error, 'Kunne ikke opprette mappa')
  return id
}

export async function omdopMappe(id: string, name: string): Promise<void> {
  const nytt = name.trim()
  if (!nytt) return
  krev((await supabase.from('drawing_folders').update({ name: nytt }).eq('id', id)).error, 'Kunne ikke gi nytt navn')
}

export async function flyttMappe(id: string, nyForelder: string | null, mapper: PlanMappe[]): Promise<void> {
  const noder = mapper.map(m => ({ id: m.id, parentId: m.parent_id, name: m.name }))
  if (!kanFlyttesTil(id, nyForelder, noder)) throw new Error('Ei mappe kan ikke flyttes inn i seg selv eller en undermappe.')
  krev((await supabase.from('drawing_folders').update({ parent_id: nyForelder }).eq('id', id)).error, 'Kunne ikke flytte mappa')
}

export async function flyttTegning(id: string, folderId: string | null): Promise<void> {
  krev((await supabase.from('drawings').update({ folder_id: folderId }).eq('id', id)).error, 'Kunne ikke flytte tegningen')
}

export async function slettMappe(mappe: PlanMappe, mapper: PlanMappe[], tegninger: PlanTegning[]): Promise<void> {
  const plan = slettePlan(
    { id: mappe.id, parentId: mappe.parent_id, name: mappe.name },
    mapper.map(m => ({ id: m.id, parentId: m.parent_id, name: m.name })),
    tegninger.map(t => ({ ...t, folderId: t.folder_id })),
  )
  const barn = plan.barn.map(b => b.id)
  const teg = plan.tegninger.map(t => t.id)
  if (barn.length) {
    krev((await supabase.from('drawing_folders').update({ parent_id: plan.nyForelder }).in('id', barn)).error, 'Kunne ikke flytte undermappene opp')
  }
  if (teg.length) {
    krev((await supabase.from('drawings').update({ folder_id: plan.nyForelder }).in('id', teg)).error, 'Kunne ikke flytte tegningene opp')
  }
  krev((await supabase.from('drawing_folders').update({ deleted_at: new Date().toISOString() }).eq('id', mappe.id)).error, 'Kunne ikke slette mappa')
}
