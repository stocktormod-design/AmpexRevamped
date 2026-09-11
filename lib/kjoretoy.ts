// Kjøretøyinfo fra regnummer — Vegvesen-oppslag via edge function, cachet
// lokalt for alltid (merke/modell/farge på en bil endrer seg ikke). Offline
// eller uten API-nøkkel: null, og bilen vises med lokasjonsnavnet i stedet.

import { database } from './db'
import { supabase } from './supabase'

export type KjoretoyInfo = {
  merke: string | null
  modell: string | null
  farge: string | null
  karosseri: string | null
}

const NOKKEL = (regNr: string) => `kjoretoy:${regNr.replace(/\s+/g, '').toUpperCase()}`

export async function hentKjoretoy(regNr: string): Promise<KjoretoyInfo | null> {
  const nokkel = NOKKEL(regNr)
  const cached = await database.localStorage.get<string>(nokkel)
  if (cached) {
    try { return JSON.parse(cached) as KjoretoyInfo } catch { /* korrupt cache — slå opp på nytt */ }
  }
  try {
    const { data, error } = await supabase.functions.invoke('vegvesen', {
      body: { kjennemerke: regNr },
    })
    if (error || !data || data.feil) return null
    const info: KjoretoyInfo = {
      merke: data.merke ?? null,
      modell: data.modell ?? null,
      farge: data.farge ?? null,
      karosseri: data.karosseri ?? null,
    }
    // Kun vellykkede oppslag caches — 503 (mangler nøkkel) skal prøves igjen.
    await database.localStorage.set(nokkel, JSON.stringify(info))
    return info
  } catch {
    return null
  }
}

/** Registerfarge → silhuett-tint. Dempet mot papir; ukjent farge = stille blekk. */
export function fargeTilHex(farge: string | null | undefined): string | null {
  if (!farge) return null
  const f = farge.toLowerCase()
  if (f.includes('hvit') || f.includes('kvit')) return '#DDD8CE'
  if (f.includes('sort') || f.includes('svart')) return '#2B2723'
  if (f.includes('sølv') || f.includes('solv')) return '#C0BCB4'
  if (f.includes('grå') || f.includes('graa') || f.includes('gra')) return '#8E8A82'
  if (f.includes('blå') || f.includes('blaa') || f.includes('bla')) return '#3E5A78'
  if (f.includes('rød') || f.includes('rod')) return '#9E3B32'
  if (f.includes('grønn') || f.includes('gronn')) return '#3F6B4F'
  if (f.includes('gul')) return '#C9A13B'
  if (f.includes('oransje')) return '#B4530A'
  if (f.includes('brun')) return '#5C4634'
  return null
}
