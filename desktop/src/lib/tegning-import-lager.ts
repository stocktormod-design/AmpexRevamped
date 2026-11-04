import { planleggImport, type ImportPlan } from '@delt/tegning-import'
import type { MappeNode } from '@delt/tegning-tre'
import { supabase } from '@/supabase'
import { mittFirma, nyId } from '@/lib/kontor-lager'

/**
 * OneDrive-mappa inn i et prosjekt: les det som ble sluppet, planlegg (ren
 * logikk i `@delt/tegning-import`), og skriv. Kontoret skriver rett mot basen
 * (regel 2), og telefonene får mappene og tegningene ved neste synk.
 *
 * Rekkefølgen per tegning er fil FØR rad: en rad uten PDF er en tegning som
 * sier «ingen PDF ennå» på alle telefonene, mens en PDF uten rad bare er en
 * fil ingen ser. Feiler én opplasting, fortsetter resten — og en ny import av
 * samme mappe tar bare det som mangler.
 */

export type SluppetFil = { sti: string; fil: File }

/**
 * Filene i et slipp, med stien relativt til det som ble sluppet.
 *
 * Oppføringene MÅ hentes ut av `DataTransfer` før første `await` — nettleseren
 * tømmer den når hendelsen er ferdig. `readEntries` gir maks ~100 om gangen,
 * så den kalles til den svarer tomt.
 */
export async function filerFraSlipp(dt: DataTransfer): Promise<SluppetFil[]> {
  const rotter: FileSystemEntry[] = []
  const lose: File[] = []
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue
    const e = item.webkitGetAsEntry?.()
    if (e) rotter.push(e)
    else { const f = item.getAsFile(); if (f) lose.push(f) }
  }
  const ut: SluppetFil[] = lose.map(fil => ({ sti: fil.name, fil }))
  const gaa = async (e: FileSystemEntry, sti: string): Promise<void> => {
    if (e.isFile) {
      const fil = await new Promise<File>((ok, nei) => (e as FileSystemFileEntry).file(ok, nei))
      ut.push({ sti, fil })
      return
    }
    const leser = (e as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const bunke = await new Promise<FileSystemEntry[]>((ok, nei) => leser.readEntries(ok, nei))
      if (!bunke.length) break
      for (const barn of bunke) await gaa(barn, `${sti}/${barn.name}`)
    }
  }
  for (const r of rotter) await gaa(r, r.name)
  return ut
}

/** Filene fra «Velg mappe» (`<input webkitdirectory>`) — stien står på fila. */
export function filerFraVelger(liste: FileList): SluppetFil[] {
  return Array.from(liste).map(fil => ({ sti: fil.webkitRelativePath || fil.name, fil }))
}

export function planlegg(
  filer: SluppetFil[],
  mapper: MappeNode[],
  tegninger: { folderId: string | null; name: string }[],
): ImportPlan {
  return planleggImport(filer.map(f => f.sti), mapper, tegninger, nyId)
}

export type Fremdrift = { ferdig: number; totalt: number }
export type Resultat = { lagtInn: number; feilet: { navn: string; grunn: string }[] }

async function lastOpp(nokkel: string, fil: File): Promise<void> {
  const { data, error } = await supabase.functions.invoke('r2-sign', { body: { key: nokkel, method: 'put' } })
  if (error) throw new Error(error.message)
  if (!data?.url) throw new Error(data?.error ?? 'fikk ikke lov til å laste opp')
  const svar = await fetch(data.url as string, { method: 'PUT', body: fil })
  if (!svar.ok) throw new Error(`opplastingen svarte ${svar.status}`)
}

/** Skriver planen: mappene i én omgang, så tegningene tre om gangen. */
export async function kjorImport(
  projectId: string,
  plan: ImportPlan,
  filer: SluppetFil[],
  vedFremdrift: (f: Fremdrift) => void,
): Promise<Resultat> {
  const companyId = await mittFirma()
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? null

  if (plan.mapper.length) {
    // Én insert: foreldrene står først i lista, og fremmednøkkelen sjekkes når setningen er ferdig.
    const { error } = await supabase.from('drawing_folders').insert(plan.mapper.map(m => ({
      id: m.id, company_id: companyId, project_id: projectId, parent_id: m.parentId,
      name: m.name, sort_order: m.sortOrder, created_by: bruker,
    })))
    if (error) throw new Error(`Kunne ikke lage mappene: ${error.message}`)
  }

  const filFor = new Map(filer.map(f => [f.sti, f.fil]))
  const feilet: Resultat['feilet'] = []
  let ferdig = 0, lagtInn = 0
  vedFremdrift({ ferdig, totalt: plan.tegninger.length })
  const ko = [...plan.tegninger]
  const arbeider = async () => {
    for (let t = ko.shift(); t; t = ko.shift()) {
      try {
        const fil = filFor.get(t.sti)
        if (!fil) throw new Error('fila forsvant')
        const nokkel = `drawings/${t.id}.pdf`
        await lastOpp(nokkel, fil)
        const { error } = await supabase.from('drawings').insert({
          id: t.id, company_id: companyId, project_id: projectId, folder_id: t.folderId,
          name: t.name, plan: '', discipline: t.discipline, file_path: nokkel, created_by: bruker,
        })
        if (error) throw new Error(error.message)
        lagtInn++
      } catch (e) {
        feilet.push({ navn: t.name, grunn: e instanceof Error ? e.message : String(e) })
      }
      vedFremdrift({ ferdig: ++ferdig, totalt: plan.tegninger.length })
    }
  }
  await Promise.all([arbeider(), arbeider(), arbeider()])
  return { lagtInn, feilet }
}
