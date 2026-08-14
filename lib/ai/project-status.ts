import * as FileSystem from 'expo-file-system/legacy'
import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Room } from '../db/models/room'
import { computeProjectProgress, progressToSpokenContext } from '../project-progress'
import { callAiVoice } from './gemini-client'
import { audioSegmentPath, type VoiceDraftSession } from './voice-drafts'

export type ProjectStatusOutcome =
  | { kind: 'answered'; spokenReply: string; transcript: string }
  | { kind: 'failed' }

/**
 * Aggregeringen skjer HELT lokalt (computeProjectProgress) — kun det ferdige
 * sammendraget (rom-navn, prosent per fagfelt) sendes til Gemini, aldri rå
 * romdata. Modellens jobb er kun å formulere svaret naturlig, ikke regne ut tall.
 */
export async function runProjectStatusQuery(draft: VoiceDraftSession): Promise<ProjectStatusOutcome> {
  if (draft.routeContext.screen !== 'prosjekt' || draft.audioSegments.length === 0) return { kind: 'failed' }
  try {
    const { projectId } = draft.routeContext
    const rooms = await database.get<Room>('rooms').query(Q.where('project_id', projectId)).fetch()
    const progress = computeProjectProgress(rooms)

    const latestSegment = draft.audioSegments[draft.audioSegments.length - 1]
    const base64 = await FileSystem.readAsStringAsync(audioSegmentPath(draft, latestSegment), { encoding: 'base64' })

    const result = await callAiVoice({
      mode: 'project_status',
      routeContext: 'prosjekt',
      audio: { base64, mimeType: 'audio/aac' },
      context: progressToSpokenContext(progress),
    })

    if (!result.ok) return { kind: 'failed' }
    const spokenReply = typeof result.spokenReply === 'string' ? result.spokenReply : ''
    const transcript = typeof result.transcript === 'string' ? result.transcript : ''
    if (!spokenReply) return { kind: 'failed' }
    return { kind: 'answered', spokenReply, transcript }
  } catch {
    return { kind: 'failed' }
  }
}
