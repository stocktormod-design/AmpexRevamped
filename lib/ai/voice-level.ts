// Mikrofonnivå + modell-taler-status fra Live-økten til orb-UI-et — via en
// modul-skopet emitter, IKKE React-state: nivået kommer ~10 ganger i sekundet,
// og som state i VoiceSessionProvider ville det re-rendret hele app-treet like
// ofte. Orben abonnerer direkte og driver Reanimated shared values utenom React.

export type VoiceLevelEvent = { level: number; modelSpeaking: boolean }

type Listener = (e: VoiceLevelEvent) => void

const listeners = new Set<Listener>()

export function emitVoiceLevel(event: VoiceLevelEvent): void {
  for (const l of listeners) l(event)
}

export function subscribeVoiceLevel(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Siste aksellerometer-sample — skrives av rist-detektorens 50Hz-strøm og leses
// av øre-positursjekken. Bor HER (nøytral modul, ingen import-sykler), og finnes
// fordi ingen andre får kalle Accelerometer.setUpdateInterval: innstillingen er
// GLOBAL per sensor, og en 4Hz-posesjekk halshugget rist-deteksjonen (2026-08-12).
let latestAccel: { y: number; at: number } | null = null

export function reportAccelSample(y: number): void {
  latestAccel = { y, at: Date.now() }
}

export function getLatestAccelSample(): { y: number; at: number } | null {
  return latestAccel
}
