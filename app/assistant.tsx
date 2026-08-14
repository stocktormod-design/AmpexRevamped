import { useEffect } from 'react'
import { router } from 'expo-router'
import { useVoiceSession } from '../lib/ai/voice-session'

/**
 * Deep link-inngang for AI-assistenten: ampex://assistant
 * Trigges av iOS Back Tap (Innstillinger → Tilgjengelighet → Trykk → Trykk på
 * baksiden → dobbelttrykk → Snarvei som åpner denne URL-en). Apples egen
 * back-tap-deteksjon er ML-basert og fri for falske utløsninger — derfor byttet
 * vi bort fra rist-aktivering (å reise seg med telefonen i lomma så ut som en
 * flick for akselerometeret).
 *
 * Ruta er en usynlig veksler: åpner økt hvis ingen kjører, legger på ellers —
 * så dobbelttrykk fungerer som både start og stopp.
 */
export default function AssistantLauncher() {
  const { stage, beginSession, endSession } = useVoiceSession()

  useEffect(() => {
    const toggle = stage === 'idle' ? beginSession : () => endSession()
    router.replace('/(app)')
    toggle()
    // Kun ved mount — deep link åpner ruta på nytt for hvert dobbelttrykk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
