/**
 * Assistentens egen logg på telefonen — Documents/ai.log — så en feil i felt kan
 * hentes uten kabel (`devicectl device copy from … Documents/ai.log`), akkurat
 * som skanneloggen. Konsollen er usynlig på en telefon som ikke henger i Xcode.
 * Trunkeres ved 512 kB; skriving er fyr-og-glem og feiler stille.
 */
import * as FileSystem from 'expo-file-system/legacy'

const FIL = (FileSystem.documentDirectory ?? '') + 'ai.log'
const MAKS = 512 * 1024
let ko: Promise<void> = Promise.resolve()

export function aiLogg(...deler: unknown[]): void {
  const linje = new Date().toISOString().slice(11, 23) + ' ' +
    deler.map(d => (typeof d === 'string' ? d : d instanceof Error ? d.message : JSON.stringify(d))).join(' ') + '\n'
  console.log(linje.trimEnd())
  if (!FileSystem.documentDirectory) return
  ko = ko.then(async () => {
    try {
      const info = await FileSystem.getInfoAsync(FIL)
      let eksisterende = info.exists ? await FileSystem.readAsStringAsync(FIL) : ''
      if (eksisterende.length > MAKS) eksisterende = eksisterende.slice(-MAKS / 2)
      await FileSystem.writeAsStringAsync(FIL, eksisterende + linje)
    } catch { /* logg skal aldri velte noe */ }
  })
}
