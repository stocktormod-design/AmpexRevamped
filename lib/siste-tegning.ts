import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Tegningene montøren har åpnet sist, per prosjekt, nyeste først. Prosjektet
 * viser dem øverst — den du så på i går er nesten alltid den du leter etter i
 * dag (Dalux-klagen: «ingen funksjon for å favorisere tegninger man bruker
 * ofte»). Lokalt på telefonen; det er en vane, ikke data.
 */
const nokkel = (projectId: string) => `siste-tegninger:${projectId}`
const MAKS = 8

export async function hentSisteTegninger(projectId: string): Promise<string[]> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(nokkel(projectId))) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

export async function lagreSisteTegning(projectId: string, drawingId: string) {
  const liste = await hentSisteTegninger(projectId)
  const ny = [drawingId, ...liste.filter(x => x !== drawingId)].slice(0, MAKS)
  AsyncStorage.setItem(nokkel(projectId), JSON.stringify(ny)).catch(() => {})
}
