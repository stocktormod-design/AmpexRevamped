import * as Speech from 'expo-speech'

// Norsk tekst-til-tale on-device via expo-speech. Dette er FALLBACKEN — den gode
// stemmen kommer fra talecachen (lib/ai/tale-cache.ts). Denne brukes kun når en
// setning ikke er rendret ennå.
const LANGUAGE = 'nb-NO'

// Standardraten på iOS leser saktere enn folk snakker, og det er halve grunnen
// til at systemstemmer høres ut som talende bruksanvisninger. Litt over normalen
// treffer tempoet en kollega bruker.
const RATE = 1.08

/**
 * Uten eksplisitt stemme velger iOS den DÅRLIGSTE nb-NO-stemmen som finnes —
 * den komprimerte standardstemmen fra 2012. De gode («Enhanced»/«Premium») ligger
 * på enheten kun hvis brukeren har lastet dem ned, men når de finnes må vi be om
 * dem ved identifier; systemet tilbyr dem ikke selv.
 *
 * Slås opp én gang og huskes — listen endrer seg ikke mens appen kjører.
 */
let valgtStemme: string | null | undefined

async function finnBesteStemme(): Promise<string | null> {
  if (valgtStemme !== undefined) return valgtStemme
  try {
    const alle = await Speech.getAvailableVoicesAsync()
    const norske = alle.filter(v => v.language?.toLowerCase().startsWith('nb'))
    const best =
      norske.find(v => v.quality === Speech.VoiceQuality.Enhanced) ?? norske[0] ?? null
    valgtStemme = best?.identifier ?? null
    // Hele lista logges, ikke bare valget: om iOS i det hele tatt TILBYR en
    // forbedret norsk stemme er ikke dokumentert noe sted, og på iOS 26 finnes
    // det i tillegg en kjent regresjon der brukerens valgte stemme ikke kommer
    // gjennom API-et. Da er enhetens egen liste eneste pålitelige kilde.
    console.log(`Tale: norske stemmer → ${norske.map(v => `${v.name}/${v.quality}`).join(', ') || 'ingen'}`)
    if (best) console.log(`Tale: valgte ${best.name} (${best.quality})`)
    else console.warn('Tale: ingen nb-NO-stemme på enheten')
  } catch (e) {
    console.warn('Tale: klarte ikke liste stemmer:', e)
    valgtStemme = null
  }
  return valgtStemme
}

export function speak(text: string, opts?: { onDone?: () => void; onError?: (e: Error) => void }): void {
  void finnBesteStemme().then(voice => {
    Speech.speak(text, {
      language: LANGUAGE,
      rate: RATE,
      volume: 1.0,
      ...(voice ? { voice } : {}),
      onDone: opts?.onDone,
      onError: opts?.onError,
    })
  })
}

export async function stopSpeaking(): Promise<void> {
  await Speech.stop()
}

export async function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync()
}
