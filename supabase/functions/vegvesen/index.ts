// Vegvesen-oppslag: kjennemerke → merke/modell/farge/karosseri.
//
// Kjører som edge function fordi API-nøkkelen er hemmelig og kjennemerker er
// personopplysninger (skiltet skal ikke i klient-logger). Nøkkelen søkes
// gratis hos Statens vegvesen (Autosys «Enkeltoppslag», 50 000 kall/døgn) og
// settes som secret: `supabase secrets set VEGVESEN_API_KEY=...`
// Uten nøkkel svarer funksjonen 503 og appen viser bilen uten merke/modell.

const ENDPOINT = 'https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return svar({ feil: 'bruk POST' }, 405)

  const key = Deno.env.get('VEGVESEN_API_KEY')
  if (!key) return svar({ feil: 'VEGVESEN_API_KEY er ikke satt' }, 503)

  let kjennemerke = ''
  try {
    const body = await req.json()
    kjennemerke = String(body?.kjennemerke ?? '').replace(/\s+/g, '').toUpperCase()
  } catch {
    return svar({ feil: 'ugyldig body' }, 400)
  }
  if (!/^[A-ZÆØÅ]{2}\d{4,5}$/.test(kjennemerke)) return svar({ feil: 'ugyldig kjennemerke' }, 400)

  const res = await fetch(`${ENDPOINT}?kjennemerke=${encodeURIComponent(kjennemerke)}`, {
    headers: { 'SVV-Authorization': `Apikey ${key}` },
  })
  if (!res.ok) return svar({ feil: `vegvesen svarte ${res.status}` }, 502)

  const json = await res.json()
  const kjoretoy = json?.kjoretoydataListe?.[0]
  const tekniske = kjoretoy?.godkjenning?.tekniskGodkjenning?.tekniskeData
  if (!tekniske) return svar({ feil: 'ukjent kjennemerke' }, 404)

  return svar({
    merke: tekniske?.generelt?.merke?.[0]?.merke ?? null,
    modell: tekniske?.generelt?.handelsbetegnelse?.[0] ?? null,
    farge: tekniske?.karosseriOgLasteplan?.rFarge?.[0]?.kodeNavn ?? null,
    karosseri: tekniske?.karosseriOgLasteplan?.karosseritype?.kodeNavn ?? null,
  }, 200)
})

function svar(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
