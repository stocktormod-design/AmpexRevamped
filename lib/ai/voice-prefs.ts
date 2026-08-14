import { database } from '../db'

// Personlig stemmevalg for Live-assistenten. Lagres lokalt per enhet
// (database.localStorage) og overstyrer firmastandarden fra serveren
// (GEMINI_LIVE_VOICE-secreten) — se lib/ai/live-session.ts.

const KEY = 'ampex_live_voice'

export type VoiceOption = { id: string; label: string; description: string }

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'Kore', label: 'Kore', description: 'Kvinne — fast og tydelig' },
  { id: 'Aoede', label: 'Aoede', description: 'Kvinne — lett og luftig' },
  { id: 'Leda', label: 'Leda', description: 'Kvinne — ung og energisk' },
  { id: 'Zephyr', label: 'Zephyr', description: 'Kvinne — lys og blid' },
  { id: 'Charon', label: 'Charon', description: 'Mann — dyp og rolig' },
  { id: 'Orus', label: 'Orus', description: 'Mann — nøytral og saklig' },
  { id: 'Fenrir', label: 'Fenrir', description: 'Mann — kraftig' },
  { id: 'Puck', label: 'Puck', description: 'Mann — kvikk og leken' },
]

export async function getPreferredVoice(): Promise<string | null> {
  const v = await database.localStorage.get<string>(KEY)
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** null = følg firmastandarden fra serveren. */
export async function setPreferredVoice(voice: string | null): Promise<void> {
  if (voice) await database.localStorage.set(KEY, voice)
  else await database.localStorage.remove(KEY)
}
