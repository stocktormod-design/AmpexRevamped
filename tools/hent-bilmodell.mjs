// Kurerer én bilmodell inn i biblioteket:
//
//   søk Sketchfab (kun nedlastbare CC-modeller) → last ned glTF →
//   prosesser (bake vertex-farger, ÉN mesh, forenklet) → last opp til
//   Supabase-bøtta `bilmodeller` → skriv attribusjon (CC-BY-kravet).
//
// Bruk:
//   SKETCHFAB_TOKEN=xxx node tools/hent-bilmodell.mjs "toyota proace verso"            # list kandidater
//   SKETCHFAB_TOKEN=xxx node tools/hent-bilmodell.mjs "toyota proace verso" <uid>      # kurér valgt modell
//
// Slug-en blir «toyota-proace-verso» — den MÅ matche bilmodellSlug() i
// lib/bilmodell.ts (Vegvesens «merke handelsbetegnelse» kjørt gjennom samme
// regel), ellers finner ikke appen den.

import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = process.env.SKETCHFAB_TOKEN
const [sok, uid] = process.argv.slice(2)
if (!sok) { console.error('Bruk: SKETCHFAB_TOKEN=xxx node tools/hent-bilmodell.mjs "<søk>" [uid]'); process.exit(1) }

const OK_LISENSER = new Set(['CC0', 'CC Attribution', 'CC Attribution-ShareAlike'])
const PROSJEKT = process.env.SUPABASE_PROSJEKT ?? 'vymgogzcicbaizjlaurr'
const slug = sok.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

if (!uid) {
  const res = await fetch(`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(sok)}&downloadable=true&count=10&sort_by=-likeCount`)
  const { results = [] } = await res.json()
  console.log(`Kandidater for «${sok}» (slug: ${slug}):\n`)
  for (const r of results) {
    const lisens = r.license?.label ?? '?'
    const ok = OK_LISENSER.has(lisens) ? '✓' : '✗'
    console.log(`${ok} ${r.uid}  ${String(r.faceCount).padStart(8)} tri  ${lisens.padEnd(24)} ${r.name}`)
    console.log(`   ${r.viewerUrl}`)
  }
  console.log('\nKurér med: SKETCHFAB_TOKEN=xxx node tools/hent-bilmodell.mjs "' + sok + '" <uid>')
  process.exit(0)
}

if (!TOKEN) { console.error('SKETCHFAB_TOKEN mangler (sketchfab.com → Settings → Password & API)'); process.exit(1) }

// Lisens- og attribusjonsdata FØR nedlasting — vi kurerer ikke uklare lisenser.
const meta = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).json()
const lisens = meta.license?.label ?? '?'
if (!OK_LISENSER.has(lisens)) {
  console.error(`Avbryter: lisensen «${lisens}» er ikke i OK-lista (${[...OK_LISENSER].join(', ')})`)
  process.exit(1)
}

const dl = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, {
  headers: { Authorization: `Token ${TOKEN}` },
})).json()
const url = dl.gltf?.url ?? dl.glb?.url
if (!url) { console.error('Fikk ingen nedlastings-URL — er tokenet gyldig?', JSON.stringify(dl).slice(0, 200)); process.exit(1) }

const dir = mkdtempSync(join(tmpdir(), 'bilmodell-'))
const zip = join(dir, 'modell.zip')
writeFileSync(zip, Buffer.from(await (await fetch(url)).arrayBuffer()))
execSync(`unzip -o -q "${zip}" -d "${dir}"`)
const gltf = readdirSync(dir).find(f => f.endsWith('.gltf') || f.endsWith('.glb'))
if (!gltf) { console.error('Fant ingen .gltf/.glb i arkivet:', readdirSync(dir).join(', ')); process.exit(1) }
console.log(`lastet ned «${meta.name}» av ${meta.user?.displayName} (${lisens})`)

// Prosesser → assets/bilmodeller/<slug>.glb (gjenbruker pipeline-verktøyet)
execSync(`node tools/prep-bilmodell.mjs "${join(dir, gltf)}" "${slug}" 80000`, { stdio: 'inherit' })

// Last opp til biblioteket. Storage-API direkte med service_role (hentet fra
// CLI-en) — `supabase storage cp` kan ikke overskrive, og `rm` er en no-op i
// denne CLI-versjonen, så en re-kurering ville stoppet på «KeyAlreadyExists».
// --output json gir en flat liste (uten id-felt); default-formatet gir
// {keys:[{id,…}]}. Ta imot begge, og kjenn igjen nøkkelen på beskrivelsen.
const raa = JSON.parse(execSync(`supabase projects api-keys --project-ref ${PROSJEKT}`, { encoding: 'utf8' }))
const noekler = Array.isArray(raa) ? raa : raa.keys ?? []
const service = noekler.find(k => k.id === 'service_role' || /service_role/i.test(k.description ?? ''))?.api_key
if (!service) { console.error('Fant ikke service_role-nøkkel via supabase CLI'); process.exit(1) }
execSync(
  `curl -sS -X POST "https://${PROSJEKT}.supabase.co/storage/v1/object/bilmodeller/${slug}.glb" ` +
  `-H "Authorization: Bearer ${service}" -H "x-upsert: true" -H "Content-Type: model/gltf-binary" ` +
  `--data-binary "@.bilmodeller-cache/${slug}.glb" -o /dev/null -w "opplasting: HTTP %{http_code}\\n"`,
  { stdio: 'inherit' },
)

// Manifest: bøttas egen liste over kurerte modeller. Appen matcher mot den
// i stedet for å gjette filnavn (så «toyota-proace» finner «…-verso»).
const liste = JSON.parse(execSync(`supabase storage --experimental ls "ss:///bilmodeller/"`, { encoding: 'utf8' }))
const slugger = (liste.paths ?? []).filter(p => p.endsWith('.glb')).map(p => p.replace(/\.glb$/, ''))
writeFileSync('.bilmodeller-cache/manifest.json', JSON.stringify(slugger))
execSync(
  `curl -sS -X POST "https://${PROSJEKT}.supabase.co/storage/v1/object/bilmodeller/manifest.json" ` +
  `-H "Authorization: Bearer ${service}" -H "x-upsert: true" -H "Content-Type: application/json" -H "Cache-Control: max-age=60" ` +
  `--data-binary "@.bilmodeller-cache/manifest.json" -o /dev/null -w "manifest: HTTP %{http_code}\\n"`,
  { stdio: 'inherit' },
)

// Attribusjon — CC-BY krever kreditering; loggen er kilden til «Om»-skjermen.
appendFileSync('assets/bilmodeller/ATTRIBUTION.md',
  `- **${slug}**: «${meta.name}» av ${meta.user?.displayName} (@${meta.user?.username}), ${lisens} — ${meta.viewerUrl}\n`)
console.log(`\nferdig: ${slug}.glb ligger i biblioteket. Attribusjon lagt i assets/bilmodeller/ATTRIBUTION.md`)
