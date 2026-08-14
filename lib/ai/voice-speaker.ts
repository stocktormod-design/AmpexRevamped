import * as Speech from 'expo-speech'

// Norsk tekst-til-tale, on-device via expo-speech — gratis, ingen nettverksavhengighet
// for selve stemmeutgangen. Dette er det som gjør assistenten til en voicebot og
// ikke en chatbot: svar leses opp, tekst på skjerm er støtte, ikke hovedkanalen.
const LANGUAGE = 'nb-NO'

export function speak(text: string, opts?: { onDone?: () => void; onError?: (e: Error) => void }): void {
  Speech.speak(text, {
    language: LANGUAGE,
    onDone: opts?.onDone,
    onError: opts?.onError,
  })
}

export async function stopSpeaking(): Promise<void> {
  await Speech.stop()
}

export async function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync()
}
