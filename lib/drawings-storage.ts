import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from './supabase'

const cacheDir = FileSystem.documentDirectory + 'drawings/'

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(cacheDir)
  if (!info.exists) await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true })
}

/**
 * Signert R2-URL via edge-funksjonen (R2-hemmeligheter bor kun server-side).
 * Eksportert fordi arkivet (lib/archive/freeze.ts) trenger samme kanal — det
 * skal finnes ÉN plass som vet om `r2-sign`.
 */
export async function signedR2Url(key: string, method: 'put' | 'get'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('r2-sign', { body: { key, method } })
  if (error) throw error
  if (!data?.url) throw new Error(data?.error ?? 'Kunne ikke signere R2-URL')
  return data.url as string
}

/** Last opp en PDF til R2. Returnerer R2-nøkkelen (→ drawing.file_path). */
export async function uploadDrawingPdf(drawingId: string, localUri: string): Promise<string> {
  const key = `drawings/${drawingId}.pdf`
  const url = await signedR2Url(key, 'put')
  const res = await FileSystem.uploadAsync(url, localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  })
  if (res.status >= 300) throw new Error(`Opplasting feilet (${res.status})`)
  return key
}

/**
 * Hent PDF lokalt (offline-cache). Laster ned via signert R2-URL kun hvis den
 * ikke alt ligger cachet — så en åpnet tegning rendrer uten nett.
 */
export async function getLocalPdf(filePath: string): Promise<string> {
  await ensureDir()
  const local = cacheDir + filePath.replace(/\//g, '_')
  const info = await FileSystem.getInfoAsync(local)
  // En fil er bare gyldig cache hvis den faktisk ER en PDF. Før 2026-09-13 ble
  // et 403-svar (XML fra R2) lagret som «tegningen» og aldri prøvd på nytt —
  // «Kunne ikke vise tegningen» for alltid, også etter at fila kom på plass.
  if (info.exists && info.size > 0 && (await erPdf(local))) return local
  if (info.exists) await FileSystem.deleteAsync(local, { idempotent: true })
  const url = await signedR2Url(filePath, 'get')
  const dl = await FileSystem.downloadAsync(url, local)
  if (dl.status >= 300 || !(await erPdf(dl.uri))) {
    await FileSystem.deleteAsync(dl.uri, { idempotent: true })
    throw new Error(`Kunne ikke hente tegningen (${dl.status})`)
  }
  return dl.uri
}

/** «%PDF» i de første fire bytene. */
async function erPdf(uri: string): Promise<boolean> {
  try {
    const hode = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 4 })
    return hode === 'JVBERg==' // base64('%PDF')
  } catch {
    return false
  }
}
