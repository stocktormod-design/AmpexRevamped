import * as FileSystem from 'expo-file-system/legacy'

// Lyd-opptak fra AI-assistenten lagres KUN lokalt (aldri synket) til de er
// forfremmet inn i et OrderDocument, eller forkastet. Speiler ../markup-drafts.ts.
// Én mappe per økt under documentDirectory — overlever restart, forlater aldri enheten
// før innholdet er sendt til Edge Function for berikelse.
const draftsDir = FileSystem.documentDirectory + 'ai-voice-drafts/'

export type VoiceDraftStatus = 'recorded' | 'enriching' | 'enriched' | 'enrich_failed'

export type VoiceRouteContext =
  | { screen: 'skjema'; orderId: string; templateId: string }
  | { screen: 'ordre' }
  | { screen: 'prosjekt'; projectId: string }
  | { screen: 'unknown' }

export type VoiceDraftSession = {
  sessionId: string
  routeContext: VoiceRouteContext
  createdAt: string
  audioSegments: string[] // filnavn, relativt til øktmappen, i rekkefølge
  transcript?: string
  extraction?: unknown
  status: VoiceDraftStatus
  lastError?: string
}

function sessionDir(sessionId: string): string {
  return draftsDir + sessionId + '/'
}

function metaPath(sessionId: string): string {
  return sessionDir(sessionId) + 'session.json'
}

async function ensureSessionDir(sessionId: string) {
  const dir = sessionDir(sessionId)
  const info = await FileSystem.getInfoAsync(dir)
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
}

export async function createDraft(sessionId: string, routeContext: VoiceRouteContext): Promise<VoiceDraftSession> {
  await ensureSessionDir(sessionId)
  const session: VoiceDraftSession = {
    sessionId,
    routeContext,
    createdAt: new Date().toISOString(),
    audioSegments: [],
    status: 'recorded',
  }
  await FileSystem.writeAsStringAsync(metaPath(sessionId), JSON.stringify(session))
  return session
}

export async function loadDraft(sessionId: string): Promise<VoiceDraftSession | null> {
  try {
    const info = await FileSystem.getInfoAsync(metaPath(sessionId))
    if (!info.exists) return null
    const raw = await FileSystem.readAsStringAsync(metaPath(sessionId))
    return JSON.parse(raw) as VoiceDraftSession
  } catch {
    return null
  }
}

export async function saveDraftMeta(session: VoiceDraftSession): Promise<void> {
  await ensureSessionDir(session.sessionId)
  await FileSystem.writeAsStringAsync(metaPath(session.sessionId), JSON.stringify(session))
}

/** Flytter en midlertidig opptaksfil (fra expo-audio sin recorder.uri) inn i øktmappen og legger den til segment-listen. */
export async function addAudioSegment(session: VoiceDraftSession, tempUri: string): Promise<VoiceDraftSession> {
  await ensureSessionDir(session.sessionId)
  const filename = `segment-${session.audioSegments.length}.m4a`
  const dest = sessionDir(session.sessionId) + filename
  await FileSystem.copyAsync({ from: tempUri, to: dest })
  const updated: VoiceDraftSession = { ...session, audioSegments: [...session.audioSegments, filename] }
  await saveDraftMeta(updated)
  return updated
}

export function audioSegmentPath(session: VoiceDraftSession, filename: string): string {
  return sessionDir(session.sessionId) + filename
}

/** Alle økter som ikke er ferdig beriket ennå — brukt av retry-triggeren (se lib/ai/retry.ts). */
export async function listPendingDrafts(): Promise<VoiceDraftSession[]> {
  try {
    const info = await FileSystem.getInfoAsync(draftsDir)
    if (!info.exists) return []
    const ids = await FileSystem.readDirectoryAsync(draftsDir)
    const sessions = await Promise.all(ids.map(loadDraft))
    return sessions.filter((s): s is VoiceDraftSession => s !== null && s.status !== 'enriched')
  } catch {
    return []
  }
}

/** Rydder en økt — kalles etter vellykket forfremmelse til OrderDocument, eller ved eksplisitt avbrytelse. */
export async function clearDraft(sessionId: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(sessionDir(sessionId), { idempotent: true })
  } catch {}
}
