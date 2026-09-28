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
// katalog/ er det andre unntaket (2026-09-14): den FELLES varekatalogen —
// én SQLite-fil per grossist bygget av en standard V4-varefil, uten priser
// (docs/GROSSIST_INTEGRASJON.md, «Katalog felles, pris privat»). Alle
// innloggede får LESE den; bare Ampex-administratorer (`ampex_admins`) får
// SKRIVE, for det som ligger der vises for alle firmaer.
const DELT_PREFIKS = /^(tale|katalog)\//
const KUN_AMPEX_SKRIVER = /^katalog\//
// laeretid/ er det tredje unntaket (2026-09-27): lærlingens bilder. Læretid
// eies av LÆRLINGEN, ikke av et firma — en lærling som kjøper produktet alene
// har ikke noe firma i det hele tatt. Objektet ligger under
// `laerling/<auth.uid()>/…`, og brukeren kommer fra økten, aldri fra klienten.
const LAERLING_PREFIKS = /^laeretid\//

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function gyldigNokkel(key: string): boolean {
  // Bare tegn appen faktisk bruker. «%» og «\\» er utelukket med vilje: URL-en
  // under løser opp «%2e%2e» og «\\» som katalogsteg, og da kunne
  // «tale/%2e%2e/firma/<annet>/…» signere et annet firmas filer (funnet 27.09.2026).
  if (key.length > 512) return false
  if (!/^[A-Za-z0-9._\-\/]+$/.test(key)) return false
  return key.split('/').every(seg => seg.length > 0 && seg !== '.' && seg !== '..')
}

/** Belte og bukseseler: stien R2 faktisk får, må ligge under det vi mente. */
function innenfor(url: URL, objektNokkel: string): boolean {
  return url.pathname === `/${BUCKET}/${objektNokkel}`
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
    if (!key || !gyldigNokkel(key) || !(FIRMA_PREFIKS.test(key) || DELT_PREFIKS.test(key) || LAERLING_PREFIKS.test(key))) {
      return json({ error: 'ugyldig key (må starte med drawings/, room-scans/, foto/, arkiv/, tale/, katalog/ eller laeretid/)' }, 400)
    }
    const expiresInL = Math.min(Math.max(payload.expiresIn ?? 3600, 60), 86400)
    const signer = async (objektNokkel: string, utloper: number) => {
      const aws = new AwsClient({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
      const url = new URL(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${objektNokkel}`)
      if (!innenfor(url, objektNokkel)) throw new Error('ugyldig key')
      url.searchParams.set('X-Amz-Expires', String(utloper))
      return (await aws.sign(url.toString(), { method: method === 'put' ? 'PUT' : 'GET', aws: { signQuery: true } })).url
    }

    // Lærlingens egne bilder: prefiks fra økten, uavhengig av firma.
    if (LAERLING_PREFIKS.test(key)) {
      const { data: { user } } = await ctx.supabase.auth.getUser()
      if (!user) return json({ error: 'ikke innlogget' }, 401)
      const { data: laerling } = await ctx.supabase
        .from('laeretid_laerling').select('id').eq('id', user.id).is('deleted_at', null).maybeSingle()
      if (!laerling) return json({ error: 'ikke lærling' }, 403)
      try {
        return json({ url: await signer(`laerling/${user.id}/${key}`, expiresInL), key, expiresIn: expiresInL })
      } catch { return json({ error: 'ugyldig key' }, 400) }
    }

    // Skriving til den felles katalogen: kun Ampex-administratorer. Sjekken
    // går mot basen med brukerens egen økt — `ampex_admins` har én policy,
    // «du ser din egen rad», så et tomt svar er et nei.
    if (method === 'put' && KUN_AMPEX_SKRIVER.test(key)) {
      const { data: admin, error: adminFeil } = await ctx.supabase
        .from('ampex_admins').select('user_id').maybeSingle()
      if (adminFeil) return json({ error: adminFeil.message }, 500)
      if (!admin) return json({ error: 'Bare Ampex kan skrive til katalogen.' }, 403)
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
    if (!innenfor(url, objektNokkel)) return json({ error: 'ugyldig key' }, 400)
    url.searchParams.set('X-Amz-Expires', String(expiresIn))
    const signed = await aws.sign(url.toString(), { method: method === 'put' ? 'PUT' : 'GET', aws: { signQuery: true } })
    // `key` er klientens nøkkel, uten prefiks — det er den som lagres i radene.
    return json({ url: signed.url, key, expiresIn })
  }),
}
