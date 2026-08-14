import { Platform } from 'react-native'
import type VoiceAssistantActivityType from './voice-live-activity'
import type { VoiceAssistantStage } from './voice-session'

// Ekstra vaktbikkje i tillegg til hasDynamicIsland-sjekken i voice-session.tsx sin
// kaller — denne funksjonen skal aldri gjøre noe på en enhet uten ekte Dynamic
// Island, selv om den skulle bli kalt feil fra et annet sted i fremtiden.
const IS_LIVE_ACTIVITY_PLATFORM = Platform.OS === 'ios'

const LABELS: Record<Exclude<VoiceAssistantStage, 'idle'>, { compactLabel: string; fullLabel: string }> = {
  confirming: { compactLabel: 'Lytter', fullLabel: 'Lytter...' },
  recording: { compactLabel: 'Opptak', fullLabel: 'Tar opp — snakk fritt' },
  checking: { compactLabel: 'Alt?', fullLabel: 'Er det alt?' },
}

// Lazy + feiltolerant: voice-live-activity kaller createLiveActivity ved
// modul-evaluering, som konstruerer en native LiveActivityFactory. Importeres den
// eagerly her, kjører det på ALLE plattformer (Android/web mangler native-modulen)
// og en native-feil ville drept hele root-layouten via import-kjeden
// app/_layout → voice-session → denne filen. Derfor require() først ved bruk,
// og null ved feil så Live Activity degraderer stille i stedet for å krasje appen.
let factory: typeof VoiceAssistantActivityType | null | undefined
function getFactory(): typeof VoiceAssistantActivityType | null {
  if (factory === undefined) {
    try {
      factory = (require('./voice-live-activity') as { default: typeof VoiceAssistantActivityType }).default
    } catch (e) {
      console.warn('Live Activity utilgjengelig:', e)
      factory = null
    }
  }
  return factory
}

let activeInstance: ReturnType<typeof VoiceAssistantActivityType.start> | null = null

/** Kalt ved hver stage-endring i lib/ai/voice-session.tsx — starter, oppdaterer eller avslutter Live Activity. */
export function syncLiveActivity(stage: VoiceAssistantStage) {
  if (!IS_LIVE_ACTIVITY_PLATFORM) return

  try {
    if (stage === 'idle') {
      if (activeInstance) {
        activeInstance.end('immediate', { compactLabel: '', fullLabel: 'Ferdig' })
        activeInstance = null
      }
      return
    }

    const props = LABELS[stage]
    if (!activeInstance) {
      activeInstance = getFactory()?.start(props) ?? null
      return
    }
    activeInstance.update(props)
  } catch (e) {
    console.warn('Live Activity-feil (ignorert):', e)
    activeInstance = null
  }
}
