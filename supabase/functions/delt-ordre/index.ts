// Delingslenka for et tegningslag (`ampex.no/#/del/<nøkkel>`) — det kunden åpner uten
// innlogging. Laget hører til en ordre ELLER en prosjekttegning; se
// supabase/migrations/20261030120000_tegningslag.sql.
//
// ── Hvorfor en egen funksjon og ikke r2-sign ────────────────────────────────
//
// r2-sign krever en innlogget bruker og finner firmaet fra økta. Kunden har ingen økt. Her
// er nøkkelen selve tilgangen: 32 tilfeldige byte laget av kontoret, slått opp med
// service-rollen. Funksjonen gir ut NØYAKTIG det ene dokumentet, ordrens tittel/kunde/
// adresse, firmaets navn og en kortlevd GET-lenke til planbildet — aldri noe annet, og
// aldri en nøkkel klienten har valgt. Ingen anon-policy på tabellen.
//
// Planens R2-sti bygges av firmaet raden tilhører (`firma/<company_id>/<nøkkel>`). For en
// ordre står nøkkelen i dokumentet og må være en ordretegning under drawings/; for en
// prosjekttegning hentes den fra `drawings.file_path`, og tegningen må tilhøre samme firma. Er lenka trukket tilbake
// (`del_token` null) eller raden slettet, svarer den 404.
import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? ''
const ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? ''
const SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? ''
const BUCKET = 'ampex-tiles'
const PLAN = /^drawings\/(ordre-)?[0-9a-f-]{36}\.(png|jpg|jpeg|pdf)$/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'bare POST' }, 405)
  let token = ''
  try { token = String((await req.json())?.token ?? '') } catch { return json({ error: 'ugyldig JSON' }, 400) }
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) return json({ error: 'ugyldig lenke' }, 404)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: rad, error } = await db.from('tegningslag')
    .select('data, company_id, order_id, drawing_id, updated_at').eq('del_token', token).is('deleted_at', null).maybeSingle()
  if (error) return json({ error: 'kunne ikke lese' }, 500)
  if (!rad) return json({ error: 'Lenka er trukket tilbake eller finnes ikke.' }, 404)

  const { data: firma } = await db.from('companies').select('name, org_number').eq('id', rad.company_id).maybeSingle()
  let ordre: { title: string; order_number: number | null; customer_name: string | null; address: string | null } | null = null
  let key: unknown = (rad.data as { plan?: { key?: unknown } })?.plan?.key
  if (rad.order_id) {
    const { data } = await db.from('orders').select('title, order_number, customer_name, address').eq('id', rad.order_id).maybeSingle()
    ordre = data
    if (typeof key === 'string' && !key.startsWith('drawings/ordre-')) key = null
  } else {
    // Prosjekttegning: planen er tegningen selv, og hodet er prosjektet.
    const { data: t } = await db.from('drawings').select('name, file_path, company_id, project_id').eq('id', rad.drawing_id).is('deleted_at', null).maybeSingle()
    key = t && t.company_id === rad.company_id ? t.file_path : null
    const { data: p } = t ? await db.from('projects').select('name, customer_name, address').eq('id', t.project_id).maybeSingle() : { data: null }
    ordre = { title: [p?.name, t?.name].filter(Boolean).join(' · ') || 'Tegning', order_number: null, customer_name: p?.customer_name ?? null, address: p?.address ?? null }
  }

  let planUrl: string | null = null
  if (typeof key === 'string' && PLAN.test(key) && ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY) {
    const objekt = `firma/${rad.company_id}/${key}`
    const aws = new AwsClient({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
    const url = new URL(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${objekt}`)
    if (url.pathname === `/${BUCKET}/${objekt}`) {
      url.searchParams.set('X-Amz-Expires', '3600')
      planUrl = (await aws.sign(url.toString(), { method: 'GET', aws: { signQuery: true } })).url
    }
  }

  return json({
    data: rad.data,
    ordre: ordre ?? { title: 'Ordre', order_number: null, customer_name: null, address: null },
    firma: firma ?? { name: '', org_number: null },
    planUrl,
    oppdatert: rad.updated_at,
  })
})
