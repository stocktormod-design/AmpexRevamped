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
 * **Alt v2 eier ligger i `ik2_`-tabellene.** Skal flata bort: slett tabellene,
 * denne fila, `src/ruter/InternkontrollV2.tsx` og raden i `RUTER`.
 * Internkontrollen i drift står da nøyaktig som før — den har aldri lest en
 * eneste `ik2_`-rad.
 *
 * Taggene er et REGISTER (19.09), ikke fritekst på rutinen: taggen lages én
 * gang, settes på så mange rutiner man vil, og filteret er registeret. Før sto
 * «Måling, FSE, HMS» som ett felt, og filteret ble bygget av det som tilfeldig-
 * vis var skrevet.
 */

function sjekk<T>(r: { data: T | null; error: { message: string } | null }, hva: string): T {
  if (r.error) throw new Error(`${hva}: ${r.error.message}`)
  return (r.data ?? []) as T
}

export type Ik2Tag = {
  id: string
  navn: string
  sort_order: number
}

export type Ik2Rutine = {
  id: string
  punkt_id: string
  tittel: string
  innhold: string | null
  /** Taggene fra registeret, i navnerekkefølge. */
  tagger: Ik2Tag[]
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

/** Registeret, i navnerekkefølge. Alle taggene — også de ingen rutine har fått. */
export async function hentTagger(): Promise<Ik2Tag[]> {
  const rader = sjekk(
    await supabase.from('ik2_tagger').select('id,navn,sort_order').is('deleted_at', null),
    'Kunne ikke lese taggene',
  ) as Ik2Tag[]
  return rader.sort((a, b) => a.sort_order - b.sort_order || a.navn.localeCompare(b.navn, 'nb'))
}

/** Punktene for hele firmaet, samlet per kapittel — fire spørringer, ikke fire per kapittel. */
export async function hentPunkterMedRutiner(): Promise<Map<string, Ik2Punkt[]>> {
  const punkter = sjekk(
    await supabase.from('ik2_punkter').select('id,kapittel_id,tittel,tekst,sort_order')
      .is('deleted_at', null).order('sort_order'),
    'Kunne ikke lese punktene',
  ) as Omit<Ik2Punkt, 'rutiner'>[]

  if (punkter.length === 0) return new Map()

  const [rutiner, koblinger, tagger] = await Promise.all([
    supabase.from('ik2_rutiner').select('id,punkt_id,tittel,innhold,sort_order')
      .is('deleted_at', null).order('sort_order'),
    supabase.from('ik2_rutine_tagger').select('rutine_id,tag_id'),
    hentTagger(),
  ])
  const rutinerader = sjekk(rutiner, 'Kunne ikke lese rutinene') as Omit<Ik2Rutine, 'tagger'>[]
  const koblingsrader = sjekk(koblinger, 'Kunne ikke lese taggene på rutinene') as { rutine_id: string; tag_id: string }[]

  const tagAvId = new Map(tagger.map(t => [t.id, t]))
  const taggerPerRutine = new Map<string, Ik2Tag[]>()
  for (const k of koblingsrader) {
    const t = tagAvId.get(k.tag_id)
    if (!t) continue // slettet tagg — koblingen henger igjen, men vises ikke
    taggerPerRutine.set(k.rutine_id, [...(taggerPerRutine.get(k.rutine_id) ?? []), t])
  }

  const perPunkt = new Map<string, Ik2Rutine[]>()
  for (const r of rutinerader) {
    const med: Ik2Rutine = {
      ...r,
      tagger: (taggerPerRutine.get(r.id) ?? []).sort((a, b) => a.navn.localeCompare(b.navn, 'nb')),
    }
    perPunkt.set(r.punkt_id, [...(perPunkt.get(r.punkt_id) ?? []), med])
  }

  const perKapittel = new Map<string, Ik2Punkt[]>()
  for (const p of punkter) {
    const med = { ...p, rutiner: perPunkt.get(p.id) ?? [] }
    perKapittel.set(p.kapittel_id, [...(perKapittel.get(p.kapittel_id) ?? []), med])
  }
  return perKapittel
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
export async function nyRutine(punktId: string, tittel: string, tagIds: string[], innhold: string | null = null): Promise<string> {
  const rene = tittel.trim()
  if (!rene) throw new Error('Rutinen må ha en overskrift.')
  const id = nyId()
  const r = await supabase.from('ik2_rutiner').insert({
    id,
    company_id: await mittFirma(),
    punkt_id: punktId,
    tittel: rene,
    innhold: innhold?.trim() || null,
    sort_order: await nesteRekkefolge('ik2_rutiner', 'punkt_id', punktId),
  })
  if (r.error) throw new Error(`Kunne ikke opprette rutinen: ${r.error.message}`)
  await settRutineTagger(id, tagIds)
  return id
}

/* ── Tagger ────────────────────────────────────────────────────────────── */

export async function nyTag(navn: string): Promise<string> {
  const rene = navn.trim()
  if (!rene) throw new Error('Taggen må ha et navn.')
  const id = nyId()
  const r = await supabase.from('ik2_tagger').insert({ id, company_id: await mittFirma(), navn: rene, sort_order: 0 })
  if (r.error) {
    // Unik indeks på navnet: samme tagg to ganger er én tagg.
    if (r.error.code === '23505') throw new Error(`«${rene}» finnes alt.`)
    throw new Error(`Kunne ikke lage taggen: ${r.error.message}`)
  }
  return id
}

export async function endreTagnavn(id: string, navn: string): Promise<void> {
  const rene = navn.trim()
  if (!rene) throw new Error('Taggen må ha et navn.')
  const r = await supabase.from('ik2_tagger').update({ navn: rene }).eq('id', id)
  if (r.error) throw new Error(r.error.code === '23505' ? `«${rene}» finnes alt.` : `Kunne ikke endre taggen: ${r.error.message}`)
}

/** Taggen slettes mykt; koblingene til rutinene tas bort — de er et forhold, ikke data. */
export async function slettTag(id: string): Promise<void> {
  const k = await supabase.from('ik2_rutine_tagger').delete().eq('tag_id', id)
  if (k.error) throw new Error(`Kunne ikke ta taggen av rutinene: ${k.error.message}`)
  const r = await supabase.from('ik2_tagger').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette taggen: ${r.error.message}`)
}

/** Setter rutinens tagger til nøyaktig denne lista. */
export async function settRutineTagger(rutineId: string, tagIds: string[]): Promise<void> {
  const bort = await supabase.from('ik2_rutine_tagger').delete().eq('rutine_id', rutineId)
  if (bort.error) throw new Error(`Kunne ikke endre taggene: ${bort.error.message}`)
  const unike = [...new Set(tagIds)]
  if (unike.length === 0) return
  const firma = await mittFirma()
  const inn = await supabase.from('ik2_rutine_tagger').insert(unike.map(tag_id => ({ rutine_id: rutineId, tag_id, company_id: firma })))
  if (inn.error) throw new Error(`Kunne ikke sette taggene: ${inn.error.message}`)
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
