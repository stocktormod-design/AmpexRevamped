import * as Location from 'expo-location'
import { database } from './db'

/**
 * Adresse → koordinater via plattform-geokoderen (Apple CLGeocoder på iOS —
 * gratis, ingen nøkkel). Resultater caches lokalt så samme adresse aldri
 * slås opp to ganger (batteri/nett-regel #8). Null caches også («fant ikke»),
 * men exceptions (offline o.l.) caches ikke — de kan lykkes senere.
 */
const KEY = 'geocode_cache_v1'

let cache: Record<string, { lat: number; lng: number } | null> = {}
let loaded = false

async function load() {
  if (loaded) return
  loaded = true
  cache = ((await database.localStorage.get(KEY)) as typeof cache | undefined) ?? {}
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  await load()
  if (address in cache) return cache[address]
  try {
    const [hit] = await Location.geocodeAsync(address)
    const coords = hit ? { lat: hit.latitude, lng: hit.longitude } : null
    cache = { ...cache, [address]: coords }
    database.localStorage.set(KEY, cache)
    return coords
  } catch {
    return null
  }
}
