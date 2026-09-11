// Gjør en nedlastet bilmodell (f.eks. Sketchfab glTF) klar for appen:
//
//   1. flater ut node-hierarkiet (verdensrom-koordinater)
//   2. baker baseColor (tekstur × faktor) inn som COLOR_0 vertex-farger
//      — RN/expo-gl kan ikke laste glTF-teksturer (ingen DOM Blob/Image)
//   3. gir ALT ett felles materiale og sveiser alle meshene til ÉN primitive
//      — én draw call, ingen 15 000-delers lagg
//   4. welder og forenkler ned til ~målantall trekanter (meshoptimizer)
//
// Bruk:  node tools/prep-bilmodell.mjs <inn.glb|inn.gltf> <navn> [målTri]
// Eks:   node tools/prep-bilmodell.mjs ~/Downloads/proace/scene.gltf proace 80000

import { NodeIO } from '@gltf-transform/core'
import { flatten, join, weld, simplify, prune, dequantize, quantize, clearNodeTransform } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { join as stiJoin, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

function execSyncMkdir(sti) { mkdirSync(sti, { recursive: true }) }

const [inn, navn, maalTriArg] = process.argv.slice(2)
if (!inn || !navn) {
  console.error('Bruk: node tools/prep-bilmodell.mjs <inn.glb|inn.gltf> <navn> [målTri]')
  process.exit(1)
}
const maalTri = Number(maalTriArg ?? 80000)
// Kurerte bibliotekmodeller havner i en gitignorert cache — de bor i
// Supabase-bøtta, ikke i repoet. UT_KATALOG=assets/bilmodeller for de
// bundlede karosseri-modellene.
const UT = stiJoin(
  dirname(fileURLToPath(import.meta.url)), '..',
  process.env.UT_KATALOG ?? '.bilmodeller-cache',
  `${navn}.glb`,
)
execSyncMkdir(stiJoin(UT, '..'))

const io = new NodeIO()
const doc = await io.read(inn)
await doc.transform(dequantize(), flatten())

// ── 0: kast studio-rekvisitter ─────────────────────────────────────────────
// Sketchfab-modeller kommer ofte med et gulv/backdrop-plan. Det sluker
// bounding-boksen, og da rammer appen inn gulvet i stedet for bilen.
//
// «plane» og «shadow» er BANNLYST i navneregelen: Blender døper karosseri-
// flater «Plane.0xx», og en slik regel kastet hele karosseriet (sett på enhet
// 2026-08-29 — bare hjul og ramme igjen). Rekvisitter kjennes på GEOMETRIEN:
// en flat flate (én dimensjon ≈ 0) som er stor sammenlignet med modellen.
const SOEPPEL = /(ground|backdrop|cyclorama|studio|shadowcatcher|shadow_catcher)/i
let kastet = 0
const alleDim = doc.getRoot().listNodes()
  .map(n => n.getMesh()?.listPrimitives()?.[0]?.getAttribute('POSITION'))
  .filter(Boolean)
  .map(p => { const mn = p.getMin([]), mx = p.getMax([]); return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) })
const storst = Math.max(0, ...alleDim)

for (const node of doc.getRoot().listNodes()) {
  const navn = `${node.getName()} ${node.getMesh()?.getName() ?? ''}`
  let kast = SOEPPEL.test(navn)
  if (!kast) {
    const pos = node.getMesh()?.listPrimitives()?.[0]?.getAttribute('POSITION')
    if (pos) {
      const mn = pos.getMin([]), mx = pos.getMax([])
      const d = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].sort((a, b) => a - b)
      // helt flat + minst like bred som hele modellen ⇒ gulv/backdrop
      kast = d[0] <= d[2] * 0.02 && d[2] >= storst * 0.95
    }
  }
  if (kast) { node.dispose(); kastet++ }
}
if (kastet) console.log(`kastet ${kastet} rekvisitt-node(r) (gulv/backdrop)`)

// ── 2: bak farger ──────────────────────────────────────────────────────────
const bildeCache = new Map()
function dekod(tekstur) {
  if (!bildeCache.has(tekstur)) {
    const bytes = Buffer.from(tekstur.getImage())
    const erPng = bytes[0] === 0x89 && bytes[1] === 0x50
    bildeCache.set(tekstur, erPng ? PNG.sync.read(bytes) : jpeg.decode(bytes, { maxMemoryUsageInMB: 1024 }))
  }
  return bildeCache.get(tekstur)
}
const srgb = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

let bakt = 0
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const mat = prim.getMaterial()
    const faktor = mat?.getBaseColorFactor() ?? [1, 1, 1, 1]
    const tekstur = mat?.getBaseColorTexture()
    const uv = prim.getAttribute('TEXCOORD_0')
    const antall = pos.getCount()
    const farger = new Float32Array(antall * 3)
    const punkt = [0, 0]
    for (let i = 0; i < antall; i++) {
      let r = faktor[0], g = faktor[1], b = faktor[2]
      if (tekstur && uv) {
        const img = dekod(tekstur)
        uv.getElement(i, punkt)
        // glTF-UV-er kan repetere — wrap til [0,1)
        const u = ((punkt[0] % 1) + 1) % 1
        const v = ((punkt[1] % 1) + 1) % 1
        const x = Math.min(img.width - 1, Math.floor(u * img.width))
        const y = Math.min(img.height - 1, Math.floor(v * img.height))
        const p = (y * img.width + x) * 4
        r *= srgb(img.data[p] / 255)
        g *= srgb(img.data[p + 1] / 255)
        b *= srgb(img.data[p + 2] / 255)
      }
      farger[i * 3] = r; farger[i * 3 + 1] = g; farger[i * 3 + 2] = b
    }
    const buffer = doc.getRoot().listBuffers()[0]
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(farger).setBuffer(buffer))
    prim.setAttribute('TEXCOORD_0', null)
    prim.setAttribute('TEXCOORD_1', null)
    bakt++
  }
}
console.log(`bakte farger i ${bakt} primitiver`)

// MERK: orientering fikses IKKE her. Vertex-dataene kan se Z-opp ut mens
// nodene bærer en Z-opp→Y-opp-rotasjon fra Blender-eksporten — da blir en
// rotasjon her nummer to i rekken, og modellen sprenges i biter (sett på
// enhet 2026-08-29). Appen måler i stedet den ferdige boksen i VERDENSROM og
// snur riggen om nødvendig.

// ── 3: ett materiale for alt → join kan sveise til én mesh ─────────────────
const felles = doc.createMaterial('bil')
  .setBaseColorFactor([1, 1, 1, 1])
  .setMetallicFactor(0.2)
  .setRoughnessFactor(0.5)
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) prim.setMaterial(felles)
for (const t of doc.getRoot().listTextures()) t.dispose()

await doc.transform(join({ keepNamed: false, keepMeshes: false }))

// Bak node-transformasjonene inn i geometrien. Blender-eksporter legger en
// Z-opp→Y-opp-kvaternion på nodene som ikke er en ren 90°-vending; blir den
// stående, står bilen litt på skrå i visningen (sett på enhet 2026-08-29).
// `flatten()` fjerner bare hierarkiet og BEHOLDER rotasjonen på noden —
// `clearNodeTransform` er den som faktisk skriver den inn i vertex-dataene.
for (const node of doc.getRoot().listNodes()) clearNodeTransform(node)
console.log('bakte node-transformasjoner inn i geometrien')

// ── 4: weld + forenkling ───────────────────────────────────────────────────
await MeshoptSimplifier.ready
const triFoer = telleTri(doc)
const ratio = Math.min(1, maalTri / triFoer)
// Forenklingen kjøres ITERATIVT med økende error-tak. Et fast tak er feil
// verktøy: meshopt stopper når taket nås, og på tunge modeller (ID.Buzz kom
// inn på 1,7 millioner trekanter) skjer det lenge før målet. Da får appen en
// 118 MB fil å laste ned. Vi presser heller til antallet er nede, og en bil
// sett på et kort tåler mer avvik enn silhuetten røper.
await doc.transform(weld({ tolerance: 0.0005 }))
for (const tak of [0.02, 0.05, 0.1, 0.2]) {
  if (telleTri(doc) <= maalTri * 1.15) break
  const r = Math.min(1, maalTri / telleTri(doc))
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: r, error: tak }))
}
await doc.transform(
  prune(),
  // Kvantisering: halverer filstørrelsen. three's GLTFLoader leser
  // KHR_mesh_quantization nativt — ingen ekstra dekoder i appen.
  quantize({ pattern: /^(POSITION|NORMAL|COLOR_0)$/ }),
)
const triEtter = telleTri(doc)

await io.write(UT, doc)
const prims = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0)
console.log(`${navn}.glb: ${triFoer} → ${triEtter} trekanter, ${prims} primitive(r)`)

function boks(d) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const prim of d.getRoot().listMeshes().flatMap(m => m.listPrimitives())) {
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const pmin = pos.getMin([]), pmax = pos.getMax([])
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], pmin[i]); max[i] = Math.max(max[i], pmax[i]) }
  }
  return { min, max }
}

function telleTri(d) {
  let n = 0
  for (const mesh of d.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices()
      n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3
    }
  return Math.round(n)
}
