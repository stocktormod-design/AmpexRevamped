import { useCallback, useRef } from 'react'
import { PanResponder, View } from 'react-native'
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl'
import { Renderer } from 'expo-three'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * 3D-visning av bilen — dra for å spinne den rundt.
 *
 * Kenney Car Kit (CC0, assets/bilmodeller/) mappet på karosseritypen fra
 * Vegvesen-registeret. Karosseriet tintes i registerfargen med en multiply
 * på body-meshens klonede materiale: modellene deler ett atlas-materiale
 * («colormap»), så lyse karosseriflater tar fargen mens glass og detaljer,
 * som er mørke i atlasen, beholder roen.
 *
 * REGEL 10: ingen stående render-loop. Scenen tegnes ved lasting, under
 * fingerdrag, og i en kort treghetsutløp etter slipp — så står GPU-en stille.
 */

const MODELLER = {
  varebil: require('../assets/bilmodeller/van.glb'),
  personbil: require('../assets/bilmodeller/suv.glb'),
  pickup: require('../assets/bilmodeller/truck.glb'),
} as const

/**
 * Laster glb manuelt: Asset → base64 → ArrayBuffer → GLTFLoader.parse.
 * expo-threes loadAsync leste binær-glb som JSON på enhet, og glTF-teksturer
 * krever DOM (Blob/Image) som RN ikke har — derfor er fargene BAKT inn som
 * vertex-farger på forhånd (tools/bake-bilfarger.mjs) og modellene helt
 * teksturfrie.
 */
async function lastModell(modulEllerUri: number | string): Promise<THREE.Object3D> {
  let uri: string
  if (typeof modulEllerUri === 'number') {
    const asset = Asset.fromModule(modulEllerUri)
    await asset.downloadAsync()
    uri = asset.localUri ?? asset.uri
  } else {
    uri = modulEllerUri // ferdig prosessert modell fra biblioteket, alt cachet
  }
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  const buf = base64TilArrayBuffer(b64)
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buf, '', g => resolve(g.scene), reject)
  })
}

const B64TEGN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64OPPSLAG = (() => {
  const t = new Uint8Array(128)
  for (let i = 0; i < B64TEGN.length; i++) t[B64TEGN.charCodeAt(i)] = i
  return t
})()

function base64TilArrayBuffer(s: string): ArrayBuffer {
  let lengde = (s.length / 4) * 3
  if (s.endsWith('==')) lengde -= 2
  else if (s.endsWith('=')) lengde -= 1
  const ut = new Uint8Array(lengde)
  let u = 0
  for (let i = 0; i < s.length; i += 4) {
    const a = B64OPPSLAG[s.charCodeAt(i)]
    const b = B64OPPSLAG[s.charCodeAt(i + 1)]
    const c = B64OPPSLAG[s.charCodeAt(i + 2)]
    const d = B64OPPSLAG[s.charCodeAt(i + 3)]
    ut[u++] = (a << 2) | (b >> 4)
    if (u < lengde) ut[u++] = ((b & 15) << 4) | (c >> 2)
    if (u < lengde) ut[u++] = ((c & 3) << 6) | d
  }
  return ut.buffer
}

export type BilModell = keyof typeof MODELLER

export function Bil3D({
  modell, uri, tint, hoyde = 150, onFeil, onKlar,
}: {
  modell: BilModell
  /** Kurert modell fra biblioteket (lokal filsti) — trumfer karosseri-modellen. */
  uri?: string | null
  tint: string | null
  hoyde?: number
  onFeil: (feil?: string) => void
  /** Første ramme er tegnet — silhuetten under kan slippe. */
  onKlar?: () => void
}) {
  // Refs, ikke state: gesturen og GL-loopen lever utenfor React-renderen.
  const rot = useRef({ vinkel: 0.6, fart: 0 })
  const tegn = useRef<(() => void) | null>(null)
  const spinner = useRef<number | null>(null)

  /** Kort treghetsutløp etter slipp — stopper selv, ingen evig loop. */
  const slippMedTreghet = useCallback(() => {
    if (spinner.current != null) return
    const steg = () => {
      rot.current.vinkel += rot.current.fart
      rot.current.fart *= 0.94
      tegn.current?.()
      if (Math.abs(rot.current.fart) > 0.002) {
        spinner.current = requestAnimationFrame(steg)
      } else {
        rot.current.fart = 0
        spinner.current = null
      }
    }
    spinner.current = requestAnimationFrame(steg)
  }, [])

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
      onPanResponderGrant: () => {
        if (spinner.current != null) { cancelAnimationFrame(spinner.current); spinner.current = null }
        rot.current.fart = 0
      },
      onPanResponderMove: (_e, g) => {
        rot.current.vinkel += g.vx * 0.06
        rot.current.fart = g.vx * 0.045
        tegn.current?.()
      },
      onPanResponderRelease: slippMedTreghet,
      onPanResponderTerminate: slippMedTreghet,
    }),
  ).current

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    try {
      const bredde = gl.drawingBufferWidth
      const hoydePx = gl.drawingBufferHeight

      const renderer = new Renderer({ gl, alpha: true })
      renderer.setSize(bredde, hoydePx)
      renderer.setClearColor(0x000000, 0) // kortets papir skinner gjennom
      // Tesla-følelsen sitter i lyset, ikke i polygonantallet: filmisk tone
      // mapping + et mykt rom-miljø som lakken kan speile.
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.15
      renderer.outputColorSpace = THREE.SRGBColorSpace

      const scene = new THREE.Scene()
      const kamera = new THREE.PerspectiveCamera(24, bredde / hoydePx, 0.1, 100)

      // ROTÅRSAKEN (funnet 2026-09-06 med feillogg): expo-gl er WebGL 1 uten
      // EXT_color_buffer_float. PMREM kastet ikke alltid — noen ganger laget den
      // et miljøkart som gjorde at MATERIAL-shaderen ikke kompilerte, og three
      // krasjet i `onFirstUse` med «Cannot read property 'trim' of undefined»
      // (getShaderInfoLog gir undefined i expo-gl). Da falt hele bilen til
      // silhuett. Miljøkart brukes derfor KUN på WebGL 2; på WebGL 1 gjør
      // lysene jobben, og shaderfeil-sjekken slås av så en manglende logg
      // aldri blir en TypeError.
      renderer.debug.checkShaderErrors = false
      if (renderer.capabilities.isWebGL2) {
        try {
          const pmrem = new THREE.PMREMGenerator(renderer)
          scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
        } catch (e) {
          if (__DEV__) console.log('[bil3d] uten miljøkart:', (e as Error)?.message ?? e)
        }
      }

      // Varmt nøkkellys + kjølig kantlys — studio, ikke laboratorium.
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d9de, 0.9))
      const sol = new THREE.DirectionalLight(0xffffff, 1.4)
      sol.position.set(3, 5, 2)
      scene.add(sol)
      const kant = new THREE.DirectionalLight(0xdce6f0, 0.5)
      kant.position.set(-4, 2, -3)
      scene.add(kant)

      const bil = await lastModell(uri ?? MODELLER[modell])
      const kurert = !!uri

      const kroppFarge = tint ? new THREE.Color(tint) : null
      bil.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        // Karosseri-modellene (lavpoly) leser «chopped» pga. split-normaler:
        // sveis punktene og regn glatte normaler i runtime. Bibliotekmodellene
        // er welded/forenklet OFFLINE — runtime-sveising av 80k tri ville
        // hengt JS-tråden.
        if (!kurert) {
          try {
            const g = mergeVertices(mesh.geometry as THREE.BufferGeometry, 1e-4)
            g.computeVertexNormals()
            mesh.geometry = g
          } catch { /* behold originalgeometrien */ }
        }
        const m = (mesh.material as THREE.MeshStandardMaterial).clone()
        m.flatShading = false
        m.metalness = 0.15
        m.roughness = 0.55
        // Registerfargen: multipliseres inn — lys lakk tar fargen, mørkt
        // glass forblir mørkt. Bibliotekmodellen er ÉN mesh, så den tintes
        // hel; Kenney-modellene tintes kun på body-meshen.
        if (kroppFarge && (kurert || /body/i.test(mesh.name))) m.color = kroppFarge
        m.needsUpdate = true
        mesh.material = m
      })

      // Sentrer og skaler. MÅLINGEN må skje etter at bilen står i riggen med
      // identitetstransform: kvantiserte modeller (KHR_mesh_quantization) har
      // en dekode-skalering på rot-noden, så et verdensrom-senter trukket fra
      // en lokal posisjon bommer — bilen havner utenfor bildet.
      const rigg = new THREE.Group()
      rigg.add(bil)
      scene.add(rigg)
      rigg.updateMatrixWorld(true)

      // Alt måles og korrigeres på RIGGEN i verdensrom: modellene bærer både
      // node-transformasjoner (Blender-orientering) og dekode-skalering fra
      // kvantiseringen, så regning i bilens lokalrom bommer på begge.
      const mål = () => {
        rigg.updateMatrixWorld(true)
        const b = new THREE.Box3().setFromObject(rigg)
        return { senter: b.getCenter(new THREE.Vector3()), storrelse: b.getSize(new THREE.Vector3()) }
      }
      let storrelse = mål().storrelse
      // En bil er lavest i høyden: er Y største akse, står modellen på høykant
      // (Blender-eksport uten Y-opp-konvertering). Snu hele riggen.
      if (storrelse.y > storrelse.x && storrelse.y > storrelse.z) {
        rigg.rotation.x = -Math.PI / 2
        storrelse = mål().storrelse
      }
      // Modellene peker ikke samme vei: noen har lengden langs Z, andre langs X
      // (Sprinteren gjør det). Uten dette starter én bil i 3/4-front og en
      // annen rett fra siden, og visningen leser som tilfeldig.
      if (storrelse.x > storrelse.z) rot.current.vinkel = 0.6 + Math.PI / 2

      const skala = 2.1 / Math.max(storrelse.x, storrelse.y, storrelse.z)
      rigg.scale.setScalar(skala)
      storrelse.multiplyScalar(skala)
      // Sentrering til slutt: rigg.position ligger i scenens rom — samme rom
      // som det målte senteret — så dette treffer uansett rotasjon og skala.
      rigg.position.sub(mål().senter)

      // Innramming fra bounding-sfæren MED margin — hjulene skal aldri kappes.
      const radius = Math.max(storrelse.x, storrelse.y, storrelse.z) / 2
      // 0.82: bilen skal fylle kortet, ikke svømme i det. Tallet er halve
      // bredden kameraet må dekke, målt i radiuser — under 0.8 begynner
      // hjulene å kappes når modellen dreies til hjørnevisning.
      const avstand = (radius * 0.82) / Math.tan((kamera.fov * Math.PI) / 360)
      const bunnY = -storrelse.y / 2

      // Myk «gulvskygge»: en flat, mørk sirkel med radiell utfading.
      const skyggeTekstur = lagSkyggeTekstur()
      if (skyggeTekstur) {
        const skygge = new THREE.Mesh(
          new THREE.PlaneGeometry(radius * 3, radius * 3),
          new THREE.MeshBasicMaterial({ map: skyggeTekstur, transparent: true, depthWrite: false }),
        )
        skygge.rotation.x = -Math.PI / 2
        skygge.position.y = bunnY - 0.01
        scene.add(skygge)
      }

      // Tesla-vinkelen: lavt kamera, litt over midjen, ser svakt ned.
      kamera.position.set(0, radius * 0.34, avstand)
      kamera.lookAt(0, 0, 0)

      tegn.current = () => {
        rigg.rotation.y = rot.current.vinkel
        renderer.render(scene, kamera)
        gl.endFrameEXP()
      }
      tegn.current()
      onKlar?.()
    } catch (e) {
      if (__DEV__) {
        const err = e as { name?: string; message?: string; stack?: string; constructor?: { name?: string } } | null
        console.log(`[bil3d] FEIL type=${typeof e} ctor=${err?.constructor?.name} name=${err?.name} msg=${err?.message} uri=${uri ?? 'bundlet'} stack=${(err?.stack ?? '').split('\n').slice(0, 3).join(' | ')}`)
      }
      // silhuetten tar over — 3D er pynt, aldri en blokkering
      onFeil(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    }
  }, [modell, uri, tint, onFeil, onKlar])

  return (
    <View style={{ height: hoyde }} {...pan.panHandlers}>
      <GLView style={{ flex: 1 }} onContextCreate={onContextCreate} />
    </View>
  )
}

/** Radiell skygge tegnet i minnet — ingen asset, ingen ekstra request. */
function lagSkyggeTekstur(): THREE.Texture | null {
  const N = 64
  const data = new Uint8Array(N * N * 4)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x - N / 2) / (N / 2)
      const dy = (y - N / 2) / (N / 2)
      const d = Math.sqrt(dx * dx + dy * dy * 4) // flatklemt ellipse
      const a = Math.max(0, 1 - d) ** 2 * 70
      const i = (y * N + x) * 4
      data[i] = 46; data[i + 1] = 40; data[i + 2] = 31; data[i + 3] = a
    }
  }
  const tex = new THREE.DataTexture(data, N, N)
  tex.needsUpdate = true
  return tex
}
