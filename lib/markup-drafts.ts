import * as FileSystem from 'expo-file-system/legacy'
import type { Stroke } from './db/models/drawing-markup'

// Kladd-streker lagres KUN lokalt (aldri synket) til de publiseres.
// Én fil per tegning under documentDirectory — overlever restart, forlater aldri enheten.
const draftDir = FileSystem.documentDirectory + 'markup-drafts/'

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(draftDir)
  if (!info.exists) await FileSystem.makeDirectoryAsync(draftDir, { intermediates: true })
}

function draftPath(drawingId: string): string {
  return draftDir + drawingId + '.json'
}

export async function loadDraft(drawingId: string): Promise<Stroke[]> {
  try {
    const info = await FileSystem.getInfoAsync(draftPath(drawingId))
    if (!info.exists) return []
    const raw = await FileSystem.readAsStringAsync(draftPath(drawingId))
    return JSON.parse(raw) as Stroke[]
  } catch {
    return []
  }
}

export async function saveDraft(drawingId: string, strokes: Stroke[]): Promise<void> {
  await ensureDir()
  await FileSystem.writeAsStringAsync(draftPath(drawingId), JSON.stringify(strokes))
}

export async function clearDraft(drawingId: string): Promise<void> {
  try { await FileSystem.deleteAsync(draftPath(drawingId), { idempotent: true }) } catch {}
}
