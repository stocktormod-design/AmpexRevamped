import { supabase } from '@/supabase'
import { nyId } from '@/lib/kontor-lager'

/**
 * Opplæringsregisteret: én rad per kurs per ansatt, med gyldig-til.
 *
 * Det DLE spør om først ved systemrevisjon er «hvem har gyldig FSE i år»,
 * med deltakerliste. Kapittel 7 i internkontrollen sier HVORDAN opplæring
 * skjer; dette registeret sier HVEM som har hva, og når det går ut.
 */

export type KompetanseType = 'fse' | 'forstehjelp' | 'kurs' | 'sertifikat' | 'annet'

export const KOMPETANSE_TYPER: { verdi: KompetanseType; navn: string; /** Måneder til utløp, null = går ikke ut. */ varighetMnd: number | null }[] = [
  { verdi: 'fse', navn: 'FSE', varighetMnd: 12 },
  { verdi: 'forstehjelp', navn: 'Førstehjelp', varighetMnd: 12 },
  { verdi: 'kurs', navn: 'Kurs', varighetMnd: null },
  { verdi: 'sertifikat', navn: 'Sertifikat', varighetMnd: null },
  { verdi: 'annet', navn: 'Annet', varighetMnd: null },
]
export const KOMPETANSE_NAVN: Record<KompetanseType, string> =
  Object.fromEntries(KOMPETANSE_TYPER.map(t => [t.verdi, t.navn])) as Record<KompetanseType, string>

export type Kompetanse = {
  id: string
  user_id: string
  type: KompetanseType
  tittel: string
  /** ISO-dato (YYYY-MM-DD). */
  dato: string
  gyldig_til: string | null
  notat: string | null
}

function sjekk<T>(r: { data: T | null; error: { message: string } | null }, hva: string): T {
  if (r.error) throw new Error(`${hva}: ${r.error.message}`)
  return (r.data ?? []) as T
}

/** Hele registeret for firmaet, nyeste først. */
export async function hentKompetanse(): Promise<Kompetanse[]> {
  return sjekk(
    await supabase.from('kompetanse').select('id,user_id,type,tittel,dato,gyldig_til,notat')
      .is('deleted_at', null).order('dato', { ascending: false }),
    'Kunne ikke lese opplæringsregisteret',
  ) as Kompetanse[]
}

/** Legger `mnd` måneder til en ISO-dato. */
export function plussMaaneder(iso: string, mnd: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setMonth(d.getMonth() + mnd)
  return d.toISOString().slice(0, 10)
}

export async function nyKompetanse(inn: {
  user_id: string
  type: KompetanseType
  tittel: string
  dato: string
  gyldig_til?: string | null
  notat?: string | null
}): Promise<string> {
  const tittel = inn.tittel.trim()
  if (!tittel) throw new Error('Kurset må ha et navn.')
  if (!inn.dato) throw new Error('Kurset må ha en dato.')
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? null
  const id = nyId()
  const r = await supabase.from('kompetanse').insert({
    id,
    user_id: inn.user_id,
    type: inn.type,
    tittel,
    dato: inn.dato,
    gyldig_til: inn.gyldig_til || null,
    notat: inn.notat?.trim() || null,
    created_by: bruker,
  })
  if (r.error) throw new Error(`Kunne ikke registrere kurset: ${r.error.message}`)
  return id
}

export async function slettKompetanse(id: string): Promise<void> {
  const r = await supabase.from('kompetanse').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (r.error) throw new Error(`Kunne ikke slette: ${r.error.message}`)
}

/* ── Utledet ─────────────────────────────────────────────────────────────── */

export type Gyldighet = 'gyldig' | 'utgaar' | 'utgatt' | 'mangler'

/** Dager fra i dag til en ISO-dato. Negativt = passert. */
export function dagerTil(iso: string, naa: Date): number {
  const d = new Date(iso + 'T00:00:00')
  const n = new Date(naa.getFullYear(), naa.getMonth(), naa.getDate())
  return Math.round((d.getTime() - n.getTime()) / 86_400_000)
}

/**
 * Status for én ansatt på én type: den nyeste raden teller. «Utgår» er innen
 * 60 dager — nok til å få folk på kurs før det er for sent.
 */
export function gyldighet(rader: Kompetanse[], userId: string, type: KompetanseType, naa: Date): { status: Gyldighet; rad: Kompetanse | null } {
  const mine = rader.filter(r => r.user_id === userId && r.type === type)
  if (mine.length === 0) return { status: 'mangler', rad: null }
  const nyeste = mine.reduce((a, b) => (a.dato >= b.dato ? a : b))
  if (!nyeste.gyldig_til) return { status: 'gyldig', rad: nyeste }
  const dager = dagerTil(nyeste.gyldig_til, naa)
  if (dager < 0) return { status: 'utgatt', rad: nyeste }
  if (dager <= 60) return { status: 'utgaar', rad: nyeste }
  return { status: 'gyldig', rad: nyeste }
}
