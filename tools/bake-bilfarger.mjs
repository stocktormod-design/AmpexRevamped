// Baker fargeatlasen i Kenney-bilmodellene inn som vertex-farger (COLOR_0)
// og fjerner teksturen. Hvorfor: React Native/expo-gl kan ikke dekode
// glb-innbakte PNG-er uten DOM (Blob/Image), så teksturerte modeller er en
// felle på enhet. Kenney-atlasen er flate palettfelter, så ett UV-oppslag per
// punkt er eksakt — resultatet er mindre filer som laster uten tekstursti.
//
// Kjøres på forhånd, aldri i appen:  node tools/bake-bilfarger.mjs

import { NodeIO } from '@gltf-transform/core'
import { PNG } from 'pngjs'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const KATALOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'bilmodeller')
const io = new NodeIO()

for (const fil of readdirSync(KATALOG).filter(f => f.endsWith('.glb'))) {
  const sti = join(KATALOG, fil)
  const doc = await io.read(sti)

  // Pass 1: bak farger i ALLE primitivene før noe strippes — materialet er
  // delt, så å fjerne teksturen underveis ville hoppet over resten.
  const primitiver = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())
  for (const prim of primitiver) {
      const material = prim.getMaterial()
      const tekstur = material?.getBaseColorTexture()
      const uv = prim.getAttribute('TEXCOORD_0')
      if (!tekstur || !uv) continue

      const png = PNG.sync.read(Buffer.from(tekstur.getImage()))
      const antall = uv.getCount()
      const farger = new Float32Array(antall * 3)
      const punkt = [0, 0]
      for (let i = 0; i < antall; i++) {
        uv.getElement(i, punkt)
        const x = Math.min(png.width - 1, Math.max(0, Math.floor(punkt[0] * png.width)))
        const y = Math.min(png.height - 1, Math.max(0, Math.floor(punkt[1] * png.height)))
        const p = (y * png.width + x) * 4
        // sRGB → lineær, slik glTF-spesifikasjonen krever for COLOR_0
        farger[i * 3] = srgbTilLinear(png.data[p] / 255)
        farger[i * 3 + 1] = srgbTilLinear(png.data[p + 1] / 255)
        farger[i * 3 + 2] = srgbTilLinear(png.data[p + 2] / 255)
      }

      const buffer = doc.getRoot().listBuffers()[0]
      const color = doc.createAccessor().setType('VEC3').setArray(farger).setBuffer(buffer)
      prim.setAttribute('COLOR_0', color)
  }

  // Pass 2: stripp UV-er og teksturreferanser.
  for (const prim of primitiver) {
    if (prim.getAttribute('COLOR_0')) prim.setAttribute('TEXCOORD_0', null)
    prim.getMaterial()?.setBaseColorTexture(null)
  }

  // Fjern nå ubrukte teksturer/UV-accessorer fra fila.
  for (const t of doc.getRoot().listTextures()) if (t.listParents().length <= 1) t.dispose()
  for (const a of doc.getRoot().listAccessors()) if (a.listParents().length <= 1) a.dispose()

  await io.write(sti, doc)
  console.log(`${fil}: vertex-farger bakt, tekstur fjernet`)
}

function srgbTilLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
