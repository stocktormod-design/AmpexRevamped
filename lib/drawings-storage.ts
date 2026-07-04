import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from './supabase'

const cacheDir = FileSystem.documentDirectory + 'drawings/'

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(cacheDir)
  if (!info.exists) await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true })
}

/** Signert R2-URL via edge-funksjonen (R2-hemmeligheter bor kun server-side). */
async function signedUrl(key: string, method: 'put' | 'get'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('r2-sign', { body: { key, method } })
  if (error) throw error
  if (!data?.url) throw new Error(data?.error ?? 'Kunne ikke signere R2-URL')
  return data.url as string
}

/** Last opp en PDF til R2. Returnerer R2-nøkkelen (→ drawing.file_path). */
export async function uploadDrawingPdf(drawingId: string, localUri: string): Promise<string> {
  const key = `drawings/${drawingId}.pdf`
  const url = await signedUrl(key, 'put')
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
  if (info.exists && info.size > 0) return local
  const url = await signedUrl(filePath, 'get')
  const dl = await FileSystem.downloadAsync(url, local)
  return dl.uri
}
