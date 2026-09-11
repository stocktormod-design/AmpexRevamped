// Værvarsel for arbeidsplanlegging (varmekabler ute, takløst arbeid osv.) via
// MET Norge — gratis og uten nøkkel, men KREVER identifiserende User-Agent
// (https://api.met.no/doc/TermsOfService). Geokoding via Nominatim (OSM), samme
// User-Agent-krav. Kun kall-på-forespørsel fra AI-verktøyet — aldri polling
// (batterikrav #8) og null løpende kostnad (kostnadsregelen).

const USER_AGENT = 'AmpexApp/1.0 kontakt@ampex.no'

export type DayForecast = {
  dato: string // YYYY-MM-DD
  minTemp: number
  maxTemp: number
  nedboerMm: number
}

export type WeatherResult =
  | { ok: true; sted: string; dager: DayForecast[] }
  | { ok: false; feil: string }

async function geocode(place: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=no&q=${encodeURIComponent(place)}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const json = (await res.json()) as { lat: string; lon: string; display_name: string }[]
  if (!json?.[0]) return null
  return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon), name: json[0].display_name.split(',')[0] }
}

// ── Nå-tilstanden til Hjem-skjermen ────────────────────────────────────────
// Hjem viser KUN hvordan været er nå: ett farget ikon + grader (spec
// 2026-08-29). Ingen forløpstekst — timevarselet bor hos AI-verktøyet og i
// kalenderen. Cachet per sted i 30 min så forgrunnsretur ikke blir polling.

export type VaerSymbol = 'sol' | 'regn' | 'sno' | 'skyet' | 'natt'

export type VaerNaa =
  | { ok: true; sted: string; temp: number; symbol: VaerSymbol }
  | { ok: false }

const NAA_TTL_MS = 30 * 60 * 1000
const naaCache = new Map<string, { at: number; verdi: VaerNaa }>()

function symbolFraKode(kode: string | undefined): VaerSymbol {
  if (!kode) return 'skyet'
  if (kode.includes('rain') || kode.includes('sleet') || kode.includes('drizzle')) return 'regn'
  if (kode.includes('snow')) return 'sno'
  if (kode.includes('night')) return 'natt'
  if (kode.includes('clearsky') || kode.includes('fair')) return 'sol'
  return 'skyet'
}

export async function getVaerNaa(place: string): Promise<VaerNaa> {
  const cached = naaCache.get(place)
  if (cached && Date.now() - cached.at < NAA_TTL_MS) return cached.verdi
  try {
    const loc = await geocode(place)
    if (!loc) return { ok: false }
    const res = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${loc.lat.toFixed(4)}&lon=${loc.lon.toFixed(4)}`,
      { headers: { 'User-Agent': USER_AGENT } },
    )
    if (!res.ok) return { ok: false }
    const json = await res.json()
    const first = json?.properties?.timeseries?.[0]
    const temp = first?.data?.instant?.details?.air_temperature
    if (typeof temp !== 'number') return { ok: false }
    const kode: string | undefined = first?.data?.next_1_hours?.summary?.symbol_code
      ?? first?.data?.next_6_hours?.summary?.symbol_code
    const verdi: VaerNaa = { ok: true, sted: loc.name, temp: Math.round(temp), symbol: symbolFraKode(kode) }
    naaCache.set(place, { at: Date.now(), verdi })
    return verdi
  } catch {
    return { ok: false }
  }
}

export async function getForecast(place: string, days = 4): Promise<WeatherResult> {
  try {
    const loc = await geocode(place)
    if (!loc) return { ok: false, feil: `Fant ikke stedet «${place}».` }

    const res = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${loc.lat.toFixed(4)}&lon=${loc.lon.toFixed(4)}`,
      { headers: { 'User-Agent': USER_AGENT } },
    )
    if (!res.ok) return { ok: false, feil: `Værtjenesten svarte ${res.status}.` }
    const json = await res.json()
    const series: { time: string; data: any }[] = json?.properties?.timeseries ?? []

    const byDay = new Map<string, { temps: number[]; precip: number }>()
    for (const point of series) {
      const day = point.time.slice(0, 10)
      const entry = byDay.get(day) ?? { temps: [], precip: 0 }
      const temp = point.data?.instant?.details?.air_temperature
      if (typeof temp === 'number') entry.temps.push(temp)
      const p1 = point.data?.next_1_hours?.details?.precipitation_amount
      // 6-timersblokker brukes lenger ut i varselet der timesblokker mangler
      const p6 = p1 === undefined ? point.data?.next_6_hours?.details?.precipitation_amount : undefined
      entry.precip += typeof p1 === 'number' ? p1 : typeof p6 === 'number' ? p6 : 0
      byDay.set(day, entry)
    }

    const dager: DayForecast[] = [...byDay.entries()]
      .slice(0, days)
      .filter(([, v]) => v.temps.length > 0)
      .map(([dato, v]) => ({
        dato,
        minTemp: Math.round(Math.min(...v.temps)),
        maxTemp: Math.round(Math.max(...v.temps)),
        nedboerMm: Math.round(v.precip * 10) / 10,
      }))
    return { ok: true, sted: loc.name, dager }
  } catch (e) {
    return { ok: false, feil: e instanceof Error ? e.message : 'ukjent feil' }
  }
}
