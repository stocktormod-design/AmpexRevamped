// Skann-GLB-er til/fra R2. GLB-ene har hittil KUN levd på enheten (mistet
// telefon = mistet dokumentasjon); rooms.scan_path/order_scans.scan_path synker
// allerede som TEKST, så en kollega har stien men ikke fila. R2-nøkkelen er
// identisk med den lagrede relative stien («room-scans/<fil>.glb») — dermed
// trengs ingen ny kolonne: ensureScanUploaded etter skann, ensureScanLocal før
// visning. Miniatyren (<glb>.jpg) følger med for skann-kortene.
import * as FileSystem from 'expo-file-system/legacy'
import { signedR2Url } from './drawings-storage'
import { resolveScanPath } from './splat'

// Opplastings-status per nøkkel (lokal JSON, samme mønster som scan-revisions):
// GLB-er er 4–20 MB — uten dette lastes de opp på nytt ved hver visning.
const stateFile = FileSystem.documentDirectory + 'room-scans/uploads.json'

async function loadUploaded(): Promise<Record<string, number>> {
  try {
    const raw = await FileSystem.readAsStringAsync(stateFile)
    return JSON.parse(raw)
  } catch { return {} }
}

async function saveUploaded(map: Record<string, number>) {
  try { await FileSystem.writeAsStringAsync(stateFile, JSON.stringify(map)) } catch {}
}

function isScanKey(path: string | null | undefined): path is string {
  // Kun relative stier under room-scans/ kan speiles til R2 (gamle rader kan ha
  // absolutte container-stier — de forblir lokale til neste skann).
  return !!path && path.startsWith('room-scans/')
}

/**
 * Last opp GLB (+ miniatyr) hvis den ikke alt er speilet. Fire-and-forget fra
 * skjermene — feil (offline) er stille; neste kall prøver igjen.
 */
export async function ensureScanUploaded(path: string | null | undefined): Promise<void> {
  if (!isScanKey(path)) return
  const uploaded = await loadUploaded()
  if (uploaded[path]) return
  const abs = 'file://' + resolveScanPath(path)
  const info = await FileSystem.getInfoAsync(abs)
  if (!info.exists) return
  const url = await signedR2Url(path, 'put')
  const res = await FileSystem.uploadAsync(url, abs, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  })
  if (res.status >= 300) throw new Error(`GLB-opplasting feilet (${res.status})`)
  // Miniatyr er kjekk-å-ha — manglende/feilet thumb skal ikke velte GLB-statusen.
  try {
    const thumbAbs = abs + '.jpg'
    const thumbInfo = await FileSystem.getInfoAsync(thumbAbs)
    if (thumbInfo.exists) {
      const turl = await signedR2Url(path + '.jpg', 'put')
      await FileSystem.uploadAsync(turl, thumbAbs, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      })
    }
  } catch {}
  uploaded[path] = Date.now()
  await saveUploaded(uploaded)
}

/**
 * Sørg for at GLB-en finnes lokalt — last ned fra R2 hvis ikke (kollegas skann,
 * eller reinstallert app). Returnerer absolutt sti (uten file://-prefiks, som
 * NativeMeshViewer forventer), eller null hvis den verken finnes eller kan hentes.
 */
export async function ensureScanLocal(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  const abs = resolveScanPath(path)
  const info = await FileSystem.getInfoAsync('file://' + abs)
  if (info.exists && (info.size ?? 0) > 0) return abs
  if (!isScanKey(path)) return null
  try {
    const dir = 'file://' + abs.slice(0, abs.lastIndexOf('/'))
    const dirInfo = await FileSystem.getInfoAsync(dir)
    if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
    const url = await signedR2Url(path, 'get')
    const dl = await FileSystem.downloadAsync(url, 'file://' + abs)
    if (dl.status >= 300) { await FileSystem.deleteAsync('file://' + abs, { idempotent: true }); return null }
    try {
      const turl = await signedR2Url(path + '.jpg', 'get')
      await FileSystem.downloadAsync(turl, 'file://' + abs + '.jpg')
    } catch {}
    return abs
  } catch { return null }
}
