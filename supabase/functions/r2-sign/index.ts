// Signerer R2 PUT/GET for appen. R2-hemmeligheter bor KUN her.
// Bucket = ampex-tiles (tokenet er scoped dit); tegninger under drawings/-prefiks,
// skann-GLB-er (+ .jpg-miniatyrer) under room-scans/-prefiks.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? ''
const ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? ''
const SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? ''
const BUCKET = 'ampex-tiles'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    return json({ error: 'R2 ikke konfigurert (mangler R2_ACCOUNT_ID/ACCESS/SECRET)' }, 500)
  }
  let payload: { key?: string; method?: string; expiresIn?: number }
  try { payload = await req.json() } catch { return json({ error: 'ugyldig JSON' }, 400) }

  const key = (payload.key ?? '').replace(/^\/+/, '')
  const method = (payload.method ?? 'get').toLowerCase()
  // tale/ er talecachen (lib/ai/tale-cache.ts): ferdigrendrede setninger, delt
  // på tvers av firma fordi setningene er de samme. Innholdet er assistentens
  // egne bekreftelser — ingen kundedata, ingen personopplysninger.
  if (!key || !/^(drawings|room-scans|tale)\//.test(key)) {
    return json({ error: 'ugyldig key (må starte med drawings/, room-scans/ eller tale/)' }, 400)
  }
  if (method !== 'put' && method !== 'get') return json({ error: 'method må være put eller get' }, 400)

  const expiresIn = Math.min(Math.max(payload.expiresIn ?? 3600, 60), 86400)
  const aws = new AwsClient({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
  const url = new URL(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`)
  url.searchParams.set('X-Amz-Expires', String(expiresIn))
  const signed = await aws.sign(url.toString(), { method: method === 'put' ? 'PUT' : 'GET', aws: { signQuery: true } })
  return json({ url: signed.url, key, expiresIn })
})
