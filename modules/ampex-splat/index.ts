// TS-fasade for den native AmpexSplat-modulen. Fraværende i simulator (ikke bygd
// native) → isAvailable=false, og lib/splat.ts faller tilbake til JS-simulering.
// Splat-motoren (Msplat) er fjernet — kun teksturert mesh-skanning gjenstår.

export type MeshScanResult = {
  glbPath: string; relativePath?: string; framesDir: string; keyframes: number
  /** false → falt tilbake til uteksturert vertex-farge-GLB */
  textured: boolean
  /** andel av UV-atlaset som fikk tekstur (0..1) — null hvis bake ikke ble forsøkt */
  filledFraction: number | null
  /** "fusion-v2" (batch-TSDF-geometri), "anchor-v2" (anchor-mesh-geometri) eller "anchor-fallback" (uteksturert reserve) */
  geometryPath: 'fusion-v2' | 'anchor-v2' | 'anchor-fallback'
}

export type RebakeResult = { glbPath: string; filledFraction: number | null; ms: number }

type NativeModule = {
  presentMeshScan(companyId: string, roomId: string): Promise<MeshScanResult>
  rebakeMeshScan(framesDirPath: string, flags: Record<string, string>): Promise<RebakeResult>
}

let native: NativeModule | null = null
try {
  // Lastes kun når modulen faktisk er bygd inn (device / prebuild).
  const { requireNativeModule } = require('expo-modules-core')
  native = requireNativeModule('AmpexSplat') as NativeModule
} catch {
  native = null
}

export const isNativeSplatAvailable = native !== null

/** 3D-viewer for teksturert mesh (GLB). Props: glbPath, markerMode, markers, onTapPoint, onTapMarker. Null i simulator. */
export function getNativeMeshViewerView(): any | null {
  if (!native) return null
  try {
    const { requireNativeViewManager } = require('expo-modules-core')
    return requireNativeViewManager('AmpexMeshViewer')
  } catch {
    return null
  }
}

/** Juni-mesh-pipelinen: fullskjerm LiDAR-skanner → teksturert GLB (+ nerfstudio-datasett). */
export async function presentMeshScan(companyId: string, roomId: string): Promise<MeshScanResult> {
  if (!native) throw new Error('AmpexSplat native module not available')
  return native.presentMeshScan(companyId, roomId)
}

/**
 * Regresjonssele: re-bake V2-teksturen mot et persistert skann (framesDir) uten å skanne på nytt.
 * `flags` overstyrer meshscan.*-knottene for kun denne baken (settes tilbake etterpå), så A/B
 * kan kjøres fra appen i stedet for via Xcode-launch-argumenter. Tom streng = fjern knotten.
 */
export async function rebakeMeshScan(
  framesDirPath: string,
  flags: Record<string, string> = {},
): Promise<RebakeResult> {
  if (!native) throw new Error('AmpexSplat native module not available')
  return native.rebakeMeshScan(framesDirPath, flags)
}

// ── PDF-side → raster (DrawingPane/multiview eier transformen selv — se
// docs/TEGNING_MULTIVIEW_PLAN.md; 4 × react-native-pdf er en minnefelle) ──

export type PdfPageRaster = { uri: string; width: number; height: number; pageCount: number }

type PdfModule = { renderPage(pdfPath: string, page: number, maxPx: number): Promise<PdfPageRaster> }

let pdf: PdfModule | null = null
try {
  const { requireNativeModule } = require('expo-modules-core')
  pdf = requireNativeModule('AmpexPdf') as PdfModule
} catch {
  pdf = null
}

export const isPdfRasterAvailable = pdf !== null

/** Rasterér én PDF-side til JPEG i caches (cachet på fil+side+størrelse+mtime). */
export async function renderPdfPage(pdfPath: string, page = 0, maxPx = 2048): Promise<PdfPageRaster> {
  if (!pdf) throw new Error('AmpexPdf native module not available')
  return pdf.renderPage(pdfPath.replace('file://', ''), page, maxPx)
}

// ── Nærhetssensor («løft til øret»-aktivering, se lib/ai/raise-listener.ts) ──

type ProximityModule = {
  setEnabled(enabled: boolean): void
  addListener(event: 'onProximity', cb: (e: { near: boolean }) => void): { remove: () => void }
}

let proximity: ProximityModule | null = null
try {
  const { requireNativeModule } = require('expo-modules-core')
  proximity = requireNativeModule('AmpexProximity') as ProximityModule
} catch {
  proximity = null
}

export const isProximityAvailable = proximity !== null

/** Slå nærhetsovervåkning av/på (på = skjermen slukker når sensoren dekkes, som i samtaler). */
export function setProximityEnabled(enabled: boolean): void {
  proximity?.setEnabled(enabled)
}

export function addProximityListener(cb: (near: boolean) => void): { remove: () => void } {
  if (!proximity) return { remove: () => {} }
  return proximity.addListener('onProximity', e => cb(e.near))
}

// ── Ekko-kansellert mikrofon (AVAudioEngine VoiceProcessingIO) for Live-økten ──

type MicModule = {
  start(): Promise<void>
  stop(): void
  addListener(event: 'onAudio', cb: (e: { base64: string; rms: number }) => void): { remove: () => void }
}

let mic: MicModule | null = null
try {
  const { requireNativeModule } = require('expo-modules-core')
  mic = requireNativeModule('AmpexMic') as MicModule
} catch {
  mic = null
}

export const isEchoCancelledMicAvailable = mic !== null

/** Start ekko-kansellert mikrofon: 16kHz mono PCM16 base64-chunks (~100ms) + RMS. */
export async function startEchoCancelledMic(cb: (e: { base64: string; rms: number }) => void): Promise<{ remove: () => void }> {
  if (!mic) throw new Error('AmpexMic native module not available')
  const sub = mic.addListener('onAudio', cb)
  await mic.start()
  return {
    remove: () => {
      sub.remove()
      mic?.stop()
    },
  }
}
