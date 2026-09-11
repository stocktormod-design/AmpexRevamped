// AUTOMATISK KURERING av bilmodeller (2026-09-06, Tormod: «download av bil modell
// skal være automatisk»).
//
// Appen laster ned modellen selv når den finnes i biblioteket. Det som IKKE var
// automatisk, var å få den DIT: hver ny bilmodell måtte kureres for hånd. Dette
// verktøyet tar hele runden uten tilsyn:
//
//   missing_vehicle_models  →  søk Sketchfab  →  velg beste CC-kandidat
//                           →  hent-bilmodell.mjs (last ned, prosesser, last opp)
//                           →  merk raden kurert
//
// Bruk (kan stå i cron/CI):
//   SKETCHFAB_TOKEN=xxx node tools/auto-kurer-bilmodeller.mjs
//   SKETCHFAB_TOKEN=xxx node tools/auto-kurer-bilmodeller.mjs --torrkjor
//
// Valget er en HEURISTIKK, ikke en smaksdom: riktig lisens, merket må stå i
// navnet, og trekantantallet må være i et brukbart spenn. Treffer den feil,
// kurér over med `node tools/hent-bilmodell.mjs "<søk>" <uid>` — samme sluggen
// overskrives.

import { execSync } from 'node:child_process'

const TOKEN = process.env.SKETCHFAB_TOKEN
const PROSJEKT = process.env.SUPABASE_PROSJEKT ?? 'vymgogzcicbaizjlaurr'
const TORR = process.argv.includes('--torrkjor')
if (!TOKEN && !TORR) {
  console.error('SKETCHFAB_TOKEN mangler (sketchfab.com → Settings → Password & API)')
  process.exit(1)
}

const OK_LISENSER = new Set(['CC0', 'CC Attribution', 'CC Attribution-ShareAlike'])
const MIN_TRI = 3_000      // under dette er bilen en kloss
const MAKS_TRI = 600_000   // over dette bruker prep-steget for lang tid

// service_role hentes fra Supabase CLI (samme vei som hent-bilmodell.mjs), og
// tabellen leses/skrives over PostgREST — ingen psql-avhengighet.
const raa = JSON.parse(execSync(`supabase projects api-keys --project-ref ${PROSJEKT} --output json`, { encoding: 'utf8' }))
const noekler = Array.isArray(raa) ? raa : raa.keys ?? []
const SERVICE = noekler.find(k => k.id === 'service_role' || /service_role/i.test(k.description ?? ''))?.api_key
if (!SERVICE) { console.error('Fant ikke service_role-nøkkel via supabase CLI'); process.exit(1) }
const REST = `https://${PROSJEKT}.supabase.co/rest/v1`
const HODER = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

async function lesSavnede() {
  const res = await fetch(`${REST}/missing_vehicle_models?kurert_at=is.null&order=antall.desc`, { headers: HODER })
  if (!res.ok) throw new Error(`kunne ikke lese savnede modeller: HTTP ${res.status}`)
  return res.json()
}

async function merkKurert(slug) {
  await fetch(`${REST}/missing_vehicle_models?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH', headers: HODER, body: JSON.stringify({ kurert_at: new Date().toISOString() }),
  })
}

/** Sketchfab-søk → beste kandidat, eller null. */
async function finnKandidat(sok, merke) {
  const url = `https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(sok)}`
    + '&downloadable=true&count=24&sort_by=-likeCount'
  const { results = [] } = await (await fetch(url)).json()
  const merkeOrd = (merke ?? '').toLowerCase().split(/\s+/).filter(Boolean)[0]
  const aktuelle = results.filter(r => {
    if (!OK_LISENSER.has(r.license?.label ?? '')) return false
    const tri = r.faceCount ?? 0
    if (tri < MIN_TRI || tri > MAKS_TRI) return false
    // Merket MÅ stå i navnet — ellers ender en Ford Focus som en tilfeldig sportsbil.
    if (merkeOrd && !String(r.name).toLowerCase().includes(merkeOrd)) return false
    return true
  })
  return aktuelle[0] ?? null
}

const savnede = await lesSavnede()
if (savnede.length === 0) {
  console.log('Ingen savnede bilmodeller. Ferdig.')
  process.exit(0)
}
console.log(`${savnede.length} savnede modell(er):\n`)

for (const rad of savnede) {
  const sok = [rad.merke, rad.modell].filter(Boolean).join(' ') || rad.slug.replace(/-/g, ' ')
  process.stdout.write(`• ${rad.slug} (sett ${rad.antall}×) … `)
  let kandidat = null
  try {
    kandidat = await finnKandidat(sok, rad.merke)
  } catch (e) {
    console.log(`søk feilet: ${e.message}`)
    continue
  }
  if (!kandidat) {
    console.log('ingen brukbar CC-modell funnet — hopper over')
    continue
  }
  console.log(`velger «${kandidat.name}» (${kandidat.faceCount} tri, ${kandidat.license?.label})`)
  if (TORR) continue
  try {
    execSync(`node tools/hent-bilmodell.mjs ${JSON.stringify(sok)} ${kandidat.uid}`, {
      stdio: 'inherit',
      env: { ...process.env, SKETCHFAB_TOKEN: TOKEN },
    })
    await merkKurert(rad.slug)
    console.log(`  ✓ ${rad.slug} er i biblioteket\n`)
  } catch (e) {
    console.log(`  ✗ kurering feilet: ${e.message}\n`)
  }
}
console.log('Ferdig. Appen henter nye modeller ved neste manifest-oppslag (≤10 min).')
