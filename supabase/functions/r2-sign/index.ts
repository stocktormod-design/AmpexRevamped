// Signerer R2 PUT/GET for appen. R2-hemmeligheter bor KUN her.
// Bucket = ampex-tiles (tokenet er scoped dit).
//
// ── Hvem får signere hva ─────────────────────────────────────────────────────
//
// Før 2026-09-12 krevde funksjonen bare en gyldig JWT, og anon-nøkkelen ER en
// gyldig JWT. Hvem som helst som pakket opp appen kunne dermed lese og
// overskrive tegninger og skann i alle firmaer. Nå:
//
//   1. `withSupabase({auth:'user'})` krever en innlogget bruker (anon avvises).
//   2. Firmaet leses fra basen (`current_company_id`), aldri fra klienten.
//   3. Objektet i R2 ligger under `firma/<company_id>/<nøkkel>`. Klienten
//      sender og får tilbake nøkkelen UTEN prefiks — den lagres uendret i
//      `drawings.file_path`, `order_scans.scan_path`, `order_archives.r2_key`.
//      Prefikset settes her og bare her, så ett firma kan ikke stave seg inn i
//      et annet uansett hva det ber om.
//
// tale/ er unntaket: talecachen er ferdigrendrede setninger fra assistenten,
// delt på tvers av firma fordi setningene er de samme. Ingen kundedata. Krever
// fortsatt innlogging.
//
// Objekter lagt inn før 2026-09-12 lå uten firmaprefiks og nås ikke lenger.
// Det gjaldt fire seed-tegninger fra 2026-07-04 og ingenting annet i live basen.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? ''
const ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? ''
const SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? ''
const BUCKET = 'ampex-tiles'

// Prefikser klientene bruker i dag (lib/drawings-storage.ts, lib/scan-storage.ts,
// lib/foto.ts, lib/archive/bundle.ts). Alt annet avvises.
const FIRMA_PREFIKS = /^(drawings|room-scans|foto|arkiv)\//
const DELT_PREFIKS = /^tale\//

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function gyldigNokkel(key: string): boolean {
  // Ingen tomme segmenter, ingen «..», ingen kontrolltegn. Prefikset er sjekket før.
  if (key.length > 512) return false
  if (/[\x00-\x1f\x7f]/.test(key)) return false
  return key.split('/').every(seg => seg.length > 0 && seg !== '.' && seg !== '..')
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
      return json({ error: 'R2 ikke konfigurert (mangler R2_ACCOUNT_ID/ACCESS/SECRET)' }, 500)
    }
    let payload: { key?: string; method?: string; expiresIn?: number }
    try { payload = await req.json() } catch { return json({ error: 'ugyldig JSON' }, 400) }

    const key = (payload.key ?? '').replace(/^\/+/, '')
    const method = (payload.method ?? 'get').toLowerCase()
    if (method !== 'put' && method !== 'get') return json({ error: 'method må være put eller get' }, 400)
    if (!key || !gyldigNokkel(key) || !(FIRMA_PREFIKS.test(key) || DELT_PREFIKS.test(key))) {
      return json({ error: 'ugyldig key (må starte med drawings/, room-scans/, foto/, arkiv/ eller tale/)' }, 400)
    }

    // Firmaet kommer fra basen via brukerens egen økt. Ingen firma → ingen signatur.
    const { data: companyId, error: firmaFeil } = await ctx.supabase.rpc('current_company_id')
    if (firmaFeil) return json({ error: firmaFeil.message }, 500)
    if (typeof companyId !== 'string' || !/^[0-9a-f-]{36}$/.test(companyId)) {
      return json({ error: 'Du hører ikke til et firma.' }, 403)
    }

    const objektNokkel = DELT_PREFIKS.test(key) ? key : `firma/${companyId}/${key}`

    const expiresIn = Math.min(Math.max(payload.expiresIn ?? 3600, 60), 86400)
    const aws = new AwsClient({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
    const url = new URL(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${objektNokkel}`)
    url.searchParams.set('X-Amz-Expires', String(expiresIn))
    const signed = await aws.sign(url.toString(), { method: method === 'put' ? 'PUT' : 'GET', aws: { signQuery: true } })
    // `key` er klientens nøkkel, uten prefiks — det er den som lagres i radene.
    return json({ url: signed.url, key, expiresIn })
  }),
}
