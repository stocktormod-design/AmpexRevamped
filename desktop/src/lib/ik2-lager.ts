import { supabase } from '@/supabase'
import { mittFirma, nyId } from '@/lib/kontor-lager'

/**
 * Internkontroll v2 — PRØVEFLATE.
 *
 * Forskjellen fra v1 er ETT nivå: kapittel → **punkt** → rutine. «Kartlegging
 * av farer» er ikke én ting; det er tavle, høyden, AUS og graving, og hver av
 * dem har sine egne rutiner.
 *
 * Kapitlene er de SAMME radene som v1 bruker (`ik_punkter`). Rammeverket,
 * versjonene, vedtakene og historikken finnes allerede der, og en kopi ville
 * blitt to systemer som sier hver sin ting om det samme kravet. v2 legger bare
 * til nivået under.
 *
 * **Alt v2 eier ligger i `ik2_`-tabellene.** Skal flata bort: slett de to
 * tabellene, denne fila, `src/ruter/InternkontrollV2.tsx` og raden i `RUTER`.
 * Internkontrollen i drift står da nøyaktig som før — den har aldri lest en
 * eneste `ik2_`-rad.
 */

function sjekk<T>(r: { data: T | null; error: { message: string } | null }, hva: string): T {
  if (r.error) throw new Error(`${hva}: ${r.error.message}`)
  return (r.data ?? []) as T
}

export type Ik2Rutine = {
  id: string
  punkt_id: string
  tittel: string
  innhold: string | null
  /** Én tagg, fritekst: «HMS», «AUS», «tavle». Det som gjør søket verdt noe. */
  tag: string | null
  sort_order: number
}

export type Ik2Punkt = {
  id: string
  /** Kapittelet i `ik_punkter` dette punktet hører under. */
  kapittel_id: string
  tittel: string
  tekst: string | null
  sort_order: number
  rutiner: Ik2Rutine[]
}

/** Punktene for hele firmaet, samlet per kapittel — to spørringer, ikke to per kapittel. */
export async function hentPunkterMedRutiner(): Promise<Map<string, Ik2Punkt[]>> {
  const punkter = sjekk(
    await supabase.from('ik2_punkter').select('id,kapittel_id,tittel,tekst,sort_order')
      .is('deleted_at', null).order('sort_order'),
    'Kunne ikke lese punktene',
  ) as Omit<Ik2Punkt, 'rutiner'>[]

  if (punkter.length === 0) return new Map()

  const rutiner = sjekk(
    await supabase.from('ik2_rutiner').select('id,punkt_id,tittel,innhold,tag,sort_order')
      .is('deleted_at', null).order('sort_order'),
    'Kunne ikke lese rutinene',
  ) as Ik2Rutine[]

  const perPunkt = new Map<string, Ik2Rutine[]>()
  for (const r of rutiner) perPunkt.set(r.punkt_id, [...(perPunkt.get(r.punkt_id) ?? []), r])

  const perKapittel = new Map<string, Ik2Punkt[]>()
  for (const p of punkter) {
    const med = { ...p, rutiner: perPunkt.get(p.id) ?? [] }
    perKapittel.set(p.kapittel_id, [...(perKapittel.get(p.kapittel_id) ?? []), med])
  }
  return perKapittel
}

/** Taggene som faktisk er i bruk — forslagslista i skrivefeltet. */
export function taggene(perKapittel: Map<string, Ik2Punkt[]>): string[] {
  const sett = new Set<string>()
  for (const punkter of perKapittel.values()) {
    for (const p of punkter) for (const r of p.rutiner) if (r.tag?.trim()) sett.add(r.tag.trim())
  }
  return [...sett].sort((a, b) => a.localeCompare(b, 'nb'))
}

async function nesteRekkefolge(tabell: string, kolonne: string, verdi: string): Promise<number> {
  const rader = sjekk(
    await supabase.from(tabell).select('sort_order').eq(kolonne, verdi).is('deleted_at', null),
    'Kunne ikke lese rekkefølgen',
  ) as { sort_order: number }[]
  return rader.reduce((maks, r) => Math.max(maks, r.sort_order), -1) + 1
}

export async function nyttPunkt(kapittelId: string, tittel: string): Promise<string> {
  const rene = tittel.trim()
  if (!rene) throw new Error('Punktet må ha en overskrift.')
  const id = nyId()
  const r = await supabase.from('ik2_punkter').insert({
    id,
    company_id: await mittFirma(),
    kapittel_id: kapittelId,
    tittel: rene,
    sort_order: await nesteRekkefolge('ik2_punkter', 'kapittel_id', kapittelId),
  })
  if (r.error) throw new Error(`Kunne ikke opprette punktet: ${r.error.message}`)
  return id
}

/** Teksten kan følge med fra start: ny rutine skrives på én side, så den lagres aldri tom først. */
export async function nyRutine(punktId: string, tittel: string, tag: string | null, innhold: string | null = null): Promise<string> {
  const rene = tittel.trim()
  if (!rene) throw new Error('Rutinen må ha en overskrift.')
  const id = nyId()
  const r = await supabase.from('ik2_rutiner').insert({
    id,
    company_id: await mittFirma(),
    punkt_id: punktId,
    tittel: rene,
    tag: tag?.trim() || null,
    innhold: innhold?.trim() || null,
    sort_order: await nesteRekkefolge('ik2_rutiner', 'punkt_id', punktId),
  })
  if (r.error) throw new Error(`Kunne ikke opprette rutinen: ${r.error.message}`)
  return id
}

export async function endre(
  tabell: 'ik2_punkter' | 'ik2_rutiner',
  id: string,
  patch: Record<string, string | null>,
): Promise<void> {
  const r = await supabase.from(tabell).update(patch).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke lagre: ${r.error.message}`)
}

/**
 * Soft delete (regel 5). Sletter du et punkt, følger rutinene med i samme
 * slengen — en rutine som peker på et punkt som er borte er en rutine ingen
 * finner igjen.
 */
export async function slett(nivaa: 'punkt' | 'rutine', id: string): Promise<void> {
  const naa = new Date().toISOString()

  if (nivaa === 'punkt') {
    const r1 = await supabase.from('ik2_rutiner').update({ deleted_at: naa })
      .eq('punkt_id', id).is('deleted_at', null)
    if (r1.error) throw new Error(`Kunne ikke slette rutinene: ${r1.error.message}`)
    const r2 = await supabase.from('ik2_punkter').update({ deleted_at: naa }).eq('id', id)
    if (r2.error) throw new Error(`Kunne ikke slette punktet: ${r2.error.message}`)
    return
  }

  const r = await supabase.from('ik2_rutiner').update({ deleted_at: naa }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette rutinen: ${r.error.message}`)
}
