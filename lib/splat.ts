// Skann-API: juni-mesh-pipelinen (presentMeshScan) er den eneste skanne-veien.
// (Splat-simuleringen som lå her er slettet 2026-08-11 — den var kun en demo-
// fallback for Expo Go, og ga et falskt «bake»-forløp uten ekte 3D-modell.)
import {
  isNativeSplatAvailable, getNativeMeshViewerView, presentMeshScan, rebakeMeshScan, buildSplat,
  subscribeRebakeProgress,
  type MeshScanResult,
} from '../modules/ampex-splat'

export { presentMeshScan, rebakeMeshScan, buildSplat, subscribeRebakeProgress }
export type { MeshScanResult }

import * as FileSystem from 'expo-file-system/legacy'

/**
 * Løs en lagret skann-sti til absolutt sti for native vieweren. Nye rader lagrer
 * relativ sti under Documents (overlever reinstall); gamle rader har absolutt sti
 * inn i en (muligens utdatert) app-container — remappes via /Documents/-suffikset.
 */
export function resolveScanPath(stored: string): string {
  const docs = (FileSystem.documentDirectory ?? '').replace('file://', '')
  if (stored.startsWith('/')) {
    const i = stored.indexOf('/Documents/')
    return i >= 0 ? docs.replace(/\/$/, '') + stored.slice(i + '/Documents'.length) : stored
  }
  return docs + stored
}

export const nativeSplatAvailable = isNativeSplatAvailable
// Native GLB-viewer for teksturert mesh (SceneKit m/ innebygd orbit/pinch + 3D-punktmerking).
export const NativeMeshViewer = getNativeMeshViewerView()
