import { IK_SKJELETT, maaVaereSkriftlig } from '@delt/ik/skjelett'
import { mittFirma, nyId } from '@/lib/kontor-lager'
import { supabase } from '@/supabase'

/**
 * Internkontroll v2 — PRØVEFLATE. Tre nivåer: overordnet formål → punkt →
 * rutine. En rutine henger alltid på et punkt, aldri rett på formålet.
 *
 * **Alt i v2 er skilt ut for å kunne slettes.** Egne tabeller (`ik2_*`), egen
 * lagerfil, egen rute. Skal den bort: slett de tre tabellene, denne fila,
 * `src/ruter/InternkontrollV2.tsx` og raden i `RUTER`. Internkontrollen som
 * faglig ansvarlig bruker i dag står da nøyaktig som før — den deler ikke en
 * eneste rad med dette.
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
  formal_id: string
  tittel: string
  tekst: string | null
  sort_order: number
  rutiner: Ik2Rutine[]
}

export type Ik2Formal = {
  id: string
  /** «1»–«14» fra forskriften. Null på formål firmaet har laget selv. */
  nummer: string | null
  tittel: string
  hjemmel: string | null
  tekst: string | null
  sort_order: number
  punkter: Ik2Punkt[]
  /** Utledet fra skjelettet, ikke lagret: krever forskriften dette skriftlig? */
  skriftlig: boolean
}

/** Hele treet i tre spørringer — ikke én per punkt. */
export async function hentIk2(): Promise<Ik2Formal[]> {
  const formal = sjekk(
    await supabase.from('ik2_formal').select('id,nummer,tittel,hjemmel,tekst,sort_order')
      .is('deleted_at', null).order('sort_order'),
    'Kunne ikke lese formålene',
  ) as Omit<Ik2Formal, 'punkter' | 'skriftlig'>[]

  if (formal.length === 0) return []

  const punkter = sjekk(
    await supabase.from('ik2_punkter').select('id,formal_id,tittel,tekst,sort_order')
      .is('deleted_at', null).order('sort_order'),
    'Kunne ikke lese punktene',
  ) as Omit<Ik2Punkt, 'rutiner'>[]

  const rutiner = sjekk(
    await supabase.from('ik2_rutiner').select('id,punkt_id,tittel,innhold,tag,sort_order')
      .is('deleted_at', null).order('sort_order'),
    'Kunne ikke lese rutinene',
  ) as Ik2Rutine[]

  const perPunkt = new Map<string, Ik2Rutine[]>()
  for (const r of rutiner) perPunkt.set(r.punkt_id, [...(perPunkt.get(r.punkt_id) ?? []), r])

  const perFormal = new Map<string, Ik2Punkt[]>()
  for (const p of punkter) {
    const med = { ...p, rutiner: perPunkt.get(p.id) ?? [] }
    perFormal.set(p.formal_id, [...(perFormal.get(p.formal_id) ?? []), med])
  }

  return formal.map(f => ({
    ...f,
    skriftlig: f.nummer ? maaVaereSkriftlig(f.nummer) : false,
    punkter: perFormal.get(f.id) ?? [],
  }))
}

/** Taggene som faktisk er i bruk — forslagslista i skrivefeltet. */
export function taggene(tre: Ik2Formal[]): string[] {
  const sett = new Set<string>()
  for (const f of tre) for (const p of f.punkter) for (const r of p.rutiner) {
    if (r.tag?.trim()) sett.add(r.tag.trim())
  }
  return [...sett].sort((a, b) => a.localeCompare(b, 'nb'))
}

async function nesteRekkefolge(tabell: string, kolonne: string | null, verdi: string | null): Promise<number> {
  let q = supabase.from(tabell).select('sort_order').is('deleted_at', null)
  if (kolonne && verdi) q = q.eq(kolonne, verdi)
  const rader = sjekk(await q, 'Kunne ikke lese rekkefølgen') as { sort_order: number }[]
  return rader.reduce((maks, r) => Math.max(maks, r.sort_order), -1) + 1
}

/**
 * Henter de fjorten punktene fra forskriften inn som formål.
 *
 * Rammeverket er det samme i v2 — forskriften har ikke endret seg fordi vi
 * bygget en ny flate. Det som IKKE følger med er tekst: hvert formål står
 * tomt, og flata ber deg skrive det.
 *
 * Unntaket er det firmaet alt har skrevet i v1. Har faglig ansvarlig formulert
 * HMS-målet sitt der, skal han ikke skrive det på nytt for å prøve v2 — det
 * kopieres over på punktet med samme nummer.
 */
export async function hentRammeverket(): Promise<number> {
  const finnes = await hentIk2()
  if (finnes.length > 0) throw new Error('Rammeverket er allerede hentet inn.')

  const gamle = sjekk(
    await supabase.from('ik_punkter').select('nummer,formal').is('deleted_at', null),
    'Kunne ikke lese internkontrollen',
  ) as { nummer: string; formal: string | null }[]
  const skrevet = new Map(gamle.filter(p => p.formal?.trim()).map(p => [p.nummer, p.formal]))

  const firma = await mittFirma()
  const rader = IK_SKJELETT.map((p, i) => ({
    id: nyId(),
    company_id: firma,
    nummer: p.nummer,
    tittel: p.tittel,
    hjemmel: p.hjemmel || null,
    tekst: skrevet.get(p.nummer) ?? null,
    sort_order: i,
  }))

  const r = await supabase.from('ik2_formal').insert(rader)
  if (r.error) throw new Error(`Kunne ikke hente rammeverket: ${r.error.message}`)
  return rader.length
}

export async function nyttFormal(tittel: string): Promise<string> {
  const rene = tittel.trim()
  if (!rene) throw new Error('Formålet må ha en overskrift.')
  const id = nyId()
  const r = await supabase.from('ik2_formal').insert({
    id,
    company_id: await mittFirma(),
    tittel: rene,
    sort_order: await nesteRekkefolge('ik2_formal', null, null),
  })
  if (r.error) throw new Error(`Kunne ikke opprette formålet: ${r.error.message}`)
  return id
}

export async function nyttPunkt(formalId: string, tittel: string): Promise<string> {
  const rene = tittel.trim()
  if (!rene) throw new Error('Punktet må ha en overskrift.')
  const id = nyId()
  const r = await supabase.from('ik2_punkter').insert({
    id,
    company_id: await mittFirma(),
    formal_id: formalId,
    tittel: rene,
    sort_order: await nesteRekkefolge('ik2_punkter', 'formal_id', formalId),
  })
  if (r.error) throw new Error(`Kunne ikke opprette punktet: ${r.error.message}`)
  return id
}

export async function nyRutine(punktId: string, tittel: string, tag: string | null): Promise<string> {
  const rene = tittel.trim()
  if (!rene) throw new Error('Rutinen må ha en overskrift.')
  const id = nyId()
  const r = await supabase.from('ik2_rutiner').insert({
    id,
    company_id: await mittFirma(),
    punkt_id: punktId,
    tittel: rene,
    tag: tag?.trim() || null,
    sort_order: await nesteRekkefolge('ik2_rutiner', 'punkt_id', punktId),
  })
  if (r.error) throw new Error(`Kunne ikke opprette rutinen: ${r.error.message}`)
  return id
}

export async function endre(
  tabell: 'ik2_formal' | 'ik2_punkter' | 'ik2_rutiner',
  id: string,
  patch: Record<string, string | null>,
): Promise<void> {
  const r = await supabase.from(tabell).update(patch).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke lagre: ${r.error.message}`)
}

/**
 * Soft delete (regel 5). Sletter du et formål eller et punkt, følger det som
 * ligger under med — men bare i samme slengen, aldri halvveis: et punkt som
 * peker på et formål som er borte er en rutine ingen finner igjen.
 */
export async function slett(
  nivaa: 'formal' | 'punkt' | 'rutine',
  id: string,
): Promise<void> {
  const naa = new Date().toISOString()

  if (nivaa === 'formal') {
    const punkter = sjekk(
      await supabase.from('ik2_punkter').select('id').eq('formal_id', id).is('deleted_at', null),
      'Kunne ikke lese punktene',
    ) as { id: string }[]
    for (const p of punkter) await slett('punkt', p.id)
    const r = await supabase.from('ik2_formal').update({ deleted_at: naa }).eq('id', id)
    if (r.error) throw new Error(`Kunne ikke slette formålet: ${r.error.message}`)
    return
  }

  if (nivaa === 'punkt') {
    const r1 = await supabase.from('ik2_rutiner').update({ deleted_at: naa }).eq('punkt_id', id).is('deleted_at', null)
    if (r1.error) throw new Error(`Kunne ikke slette rutinene: ${r1.error.message}`)
    const r2 = await supabase.from('ik2_punkter').update({ deleted_at: naa }).eq('id', id)
    if (r2.error) throw new Error(`Kunne ikke slette punktet: ${r2.error.message}`)
    return
  }

  const r = await supabase.from('ik2_rutiner').update({ deleted_at: naa }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette rutinen: ${r.error.message}`)
}
