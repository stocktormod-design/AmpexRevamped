import * as FileSystem from 'expo-file-system/legacy'
import { resolveScanPath } from './splat'

// Lokal revisjonshistorikk for LiDAR-skann. GLB-filene bor kun på enheten i dag
// (R2-upload kommer), så historikken gjør det også: én JSON-fil under Documents,
// nøklet på scanId/roomId. Når et skann erstattes arkiveres den gamle stien her
// i stedet for å slettes — «Skann på nytt» blir aldri destruktivt.

export type ScanRevision = { path: string; ts: number }

const DIR = FileSystem.documentDirectory + 'room-scans/'
const FILE = DIR + 'revisions.json'
const MAX_REVISIONS = 10

async function readAll(): Promise<Record<string, ScanRevision[]>> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(FILE))
  } catch {
    return {}
  }
}

async function writeAll(all: Record<string, ScanRevision[]>) {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  await FileSystem.writeAsStringAsync(FILE, JSON.stringify(all))
}

/** Arkivér forrige skann-sti før den overskrives (nyeste først, cap på antall). */
export async function archiveRevision(key: string, path: string) {
  const all = await readAll()
  const list = all[key] ?? []
  if (list.some(r => r.path === path)) return
  list.unshift({ path, ts: Date.now() })
  // Eldste utover taket slettes fra disk også
  for (const dropped of list.splice(MAX_REVISIONS)) await deleteScanFiles(dropped.path)
  all[key] = list
  await writeAll(all)
}

export async function listRevisions(key: string): Promise<ScanRevision[]> {
  const all = await readAll()
  // Vis bare revisjoner der GLB-en fortsatt finnes på disk
  const alive: ScanRevision[] = []
  for (const r of all[key] ?? []) {
    const info = await FileSystem.getInfoAsync('file://' + resolveScanPath(r.path)).catch(() => null)
    if (info?.exists) alive.push(r)
  }
  return alive
}

/** Slett GLB + thumbnail fra disk (tåler at filene alt er borte). */
export async function deleteScanFiles(path: string) {
  const abs = 'file://' + resolveScanPath(path)
  await FileSystem.deleteAsync(abs, { idempotent: true }).catch(() => {})
  await FileSystem.deleteAsync(abs + '.jpg', { idempotent: true }).catch(() => {})
}

/** Slett hele historikken for en nøkkel (inkl. filer). Brukes når skannet slettes. */
export async function clearRevisions(key: string) {
  const all = await readAll()
  for (const r of all[key] ?? []) await deleteScanFiles(r.path)
  delete all[key]
  await writeAll(all)
}

/** Thumbnail-URI for et lagret skann (native skriver `<glb>.jpg` ved eksport). */
export function scanThumbUri(path: string): string {
  return 'file://' + resolveScanPath(path) + '.jpg'
}
