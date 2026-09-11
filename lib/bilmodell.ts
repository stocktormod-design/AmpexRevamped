// Bilmodell-BIBLIOTEKET: regnr → Vegvesen sier merke/modell → appen finner
// den kurerte 3D-modellen (én mesh, vertex-farger, forenklet) i den
// offentlige `bilmodeller`-bøtta og cacher den lokalt for alltid.
//
// Finnes ingen match → null, og bil-kortet faller tilbake til karosseri-
// modellen. Nye modeller kureres inn med `tools/hent-bilmodell.mjs`.

import * as FileSystem from 'expo-file-system/legacy'
import { supabase, supabaseUrl } from './supabase'

const KATALOG = `${FileSystem.cacheDirectory}bilmodeller/`
const BASE = `${supabaseUrl}/storage/v1/object/public/bilmodeller`

/**
 * «TOYOTA» + «PROACE» → «toyota-proace».
 *
 * Vegvesen gjentar ofte merket i handelsbetegnelsen («AUDI» + «Audi e-tron»),
 * så duplikatet fjernes — ellers blir slugen «audi-audi-e-tron».
 */
export function bilmodellSlug(merke: string | null | undefined, modell: string | null | undefined): string | null {
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const m = merke ? norm(merke) : ''
  let mo = modell ? norm(modell) : ''
  if (m && mo.startsWith(`${m}-`)) mo = mo.slice(m.length + 1)
  const slug = [m, mo].filter(Boolean).join('-')
  return slug || null
}

/**
 * Manifestet er bøttas egen liste over kurerte modeller. Uten det måtte
 * appen gjette filnavn og få 404 på hver bil som ikke er kurert; med det
 * gjøres matchingen lokalt — og «toyota-proace» finner «toyota-proace-verso».
 */
let manifestCache: string[] | null = null
let manifestHentet = 0
/** Manifestet friskes opp hvert 10. minutt: kureres en bil mens appen står åpen,
 *  skal den dukke opp av seg selv — ikke ved neste omstart. */
const MANIFEST_TTL = 10 * 60 * 1000

async function hentManifest(): Promise<string[]> {
  if (manifestCache && Date.now() - manifestHentet < MANIFEST_TTL) return manifestCache
  try {
    // Cache-buster: bøttas CDN serverer ellers et utdatert manifest i opptil
    // en time etter at en ny modell er kurert inn.
    const res = await fetch(`${BASE}/manifest.json?v=${Math.floor(Date.now() / 60000)}`)
    manifestCache = res.ok ? ((await res.json()) as string[]) : (manifestCache ?? [])
    manifestHentet = Date.now()
  } catch {
    // Uten nett beholder vi forrige liste — en tom liste ville «glemt» modeller
    // som alt ligger i cachen på disk.
    manifestCache = manifestCache ?? []
  }
  return manifestCache
}

/** Beste treff: eksakt, ellers den som deler prefiks (lengst vinner). */
export function finnSlug(kandidat: string, tilgjengelige: string[]): string | null {
  if (tilgjengelige.includes(kandidat)) return kandidat
  const treff = tilgjengelige
    .filter(s => s.startsWith(`${kandidat}-`) || kandidat.startsWith(`${s}-`))
    .sort((a, b) => b.length - a.length)
  return treff[0] ?? null
}

export async function hentBilmodell(
  kandidat: string,
  /** Brukes kun til å melde fra når modellen mangler. */
  info?: { merke?: string | null; modell?: string | null },
): Promise<string | null> {
  const slug = finnSlug(kandidat, await hentManifest())
  if (!slug) {
    // Appen kan ikke kurere selv (token, minne, og valget av RIKTIG modell er
    // et kvalitetsvalg). Den melder i stedet fra, så lista over hva som
    // faktisk mangler bygger seg selv i stedet for å bli gjettet.
    void meldSavnet(kandidat, info)
    return null
  }
  const lokal = `${KATALOG}${slug}.glb`
  try {
    const fil = await FileSystem.getInfoAsync(lokal)
    if (fil.exists) return lokal
    await FileSystem.makeDirectoryAsync(KATALOG, { intermediates: true }).catch(() => {})
    const res = await FileSystem.downloadAsync(`${BASE}/${slug}.glb`, lokal)
    if (res.status !== 200) {
      // downloadAsync skriver også feilkroppen til fila — rydd, ellers cacher
      // vi en 404-side som «modell».
      await FileSystem.deleteAsync(lokal, { idempotent: true })
      return null
    }
    return lokal
  } catch {
    return null
  }
}

/** Melder fra at en bil manglet modell. Feiler stille — dette er statistikk. */
async function meldSavnet(slug: string, info?: { merke?: string | null; modell?: string | null }) {
  try {
    await supabase.rpc('meld_savnet_bilmodell', {
      p_slug: slug,
      p_merke: info?.merke ?? null,
      p_modell: info?.modell ?? null,
    })
  } catch {
    // Uten nett er dette uinteressant. Bilen vises med karosseri-modellen.
  }
}
