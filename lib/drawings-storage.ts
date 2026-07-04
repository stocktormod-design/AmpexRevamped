import * as FileSystem from 'expo-file-system/legacy'
import { supabase, supabaseUrl } from './supabase'

const BUCKET = 'drawings'
const cacheDir = FileSystem.documentDirectory + 'drawings/'

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(cacheDir)
  if (!info.exists) await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true })
}

/** Last opp en PDF til Supabase Storage. Returnerer storage-nøkkelen (→ drawing.file_path). */
export async function uploadDrawingPdf(drawingId: string, localUri: string): Promise<string> {
  const key = `${drawingId}.pdf`
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Ikke innlogget')
  const res = await FileSystem.uploadAsync(
    `${supabaseUrl}/storage/v1/object/${BUCKET}/${key}`,
    localUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/pdf',
        'x-upsert': 'true',
      },
    },
  )
  if (res.status >= 300) throw new Error(`Opplasting feilet (${res.status})`)
  return key
}

/**
 * Hent PDF lokalt (offline-cache). Laster ned via signert URL kun hvis den ikke
 * alt ligger cachet — så en tegning man har åpnet rendrer uten nett.
 */
export async function getLocalPdf(filePath: string): Promise<string> {
  await ensureDir()
  const local = cacheDir + filePath.replace(/\//g, '_')
  const info = await FileSystem.getInfoAsync(local)
  if (info.exists && info.size > 0) return local
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 3600)
  if (error || !data) throw error ?? new Error('Kunne ikke signere nedlasting')
  const dl = await FileSystem.downloadAsync(data.signedUrl, local)
  return dl.uri
}
