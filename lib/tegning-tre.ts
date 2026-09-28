/**
 * Ren trelogikk for tegningsmapper: bygg → fag → tegninger, nestet via parentId.
 * Ingen React, ingen WatermelonDB — så `npm run verify:tegning-tre` kan kjøre
 * den i Node. Komponenten (`components/tegning-mapper.tsx`) bruker disse.
 *
 * Feilen som koster her er en tegning som blir usynlig: flyttes en mappe inn i
 * seg selv, blir hele grenen en sirkel ingen skjerm når. Sletter du en mappe
 * uten å flytte innholdet opp, peker tegningene på en mappe som ikke finnes.
 */

export type MappeNode = { id: string; parentId: string | null; name: string }
export type TegningNode = { folderId: string | null }

/** Antall tegninger i mappa OG alle undermapper. */
export function tellRekursivt(mappeId: string, mapper: MappeNode[], tegninger: TegningNode[]): number {
  let n = tegninger.filter(d => d.folderId === mappeId).length
  for (const m of mapper) if (m.parentId === mappeId) n += tellRekursivt(m.id, mapper, tegninger)
  return n
}

/** Sti fra rot: «Bygg A / Elkraft». Stopper ved 20 nivåer så en sirkel aldri henger appen. */
export function mappeSti(mappeId: string | null, mapper: MappeNode[]): string[] {
  const ut: string[] = []
  let id = mappeId
  let vakt = 0
  while (id && vakt++ < 20) {
    const m = mapper.find(x => x.id === id)
    if (!m) break
    ut.unshift(m.name)
    id = m.parentId
  }
  return ut
}

/** Mappa selv og alt under den — det en mappe IKKE kan flyttes inn i. */
export function etterkommere(mappeId: string, mapper: MappeNode[]): Set<string> {
  const ut = new Set<string>([mappeId])
  let vokste = true
  while (vokste) {
    vokste = false
    for (const m of mapper) {
      if (m.parentId && ut.has(m.parentId) && !ut.has(m.id)) { ut.add(m.id); vokste = true }
    }
  }
  return ut
}

/** Kan mappa flyttes hit? Aldri inn i seg selv eller egne etterkommere. */
export function kanFlyttesTil(mappeId: string, nyForelder: string | null, mapper: MappeNode[]): boolean {
  if (nyForelder === null) return true
  return !etterkommere(mappeId, mapper).has(nyForelder)
}

/** Mappene i treets rekkefølge (dybde først), så en flyttmeny leser som et tre. */
export function mapperITreRekkefolge<M extends MappeNode>(mapper: M[], parentId: string | null = null, dybde = 0): { mappe: M; dybde: number }[] {
  const ut: { mappe: M; dybde: number }[] = []
  for (const m of mapper.filter(x => x.parentId === parentId)) {
    ut.push({ mappe: m, dybde })
    ut.push(...mapperITreRekkefolge(mapper, m.id, dybde + 1))
  }
  return ut
}

/**
 * Hva som må skje når en mappe slettes: barn og tegninger flyttes ett hakk
 * opp (forelderen, eller rota). Returnerer planen; skrivingen gjør komponenten.
 */
export function slettePlan<M extends MappeNode, D extends TegningNode>(mappe: M, mapper: M[], tegninger: D[]): {
  nyForelder: string | null; barn: M[]; tegninger: D[]
} {
  return {
    nyForelder: mappe.parentId ?? null,
    barn: mapper.filter(m => m.parentId === mappe.id),
    tegninger: tegninger.filter(d => d.folderId === mappe.id),
  }
}
