/**
 * Når ble bildet tatt? — ren logikk, selvtestet i `npm run verify:laeretid`.
 *
 * Bildene er ryggraden i loggen: tidene gir dagens rekkefølge gratis, og
 * modellen får «10:14 kryperom, stripsa kabel på bjelke» i stedet for et bilde
 * uten sammenheng. Tatt i appen vet vi tiden. Hentet fra kamerarullen må den
 * leses fra EXIF — og det er BARE tiden som leses. Posisjonen i EXIF er en
 * personopplysning vi ikke har bruk for, og den lagres aldri.
 *
 * EXIF ryker stille gjennom Messenger, skjermbilder og videresending. Da er
 * svaret null, og tidslinja faller tilbake på rekkefølgen han valgte dem i —
 * det er bedre enn å late som opplastingstidspunktet er når bildet ble tatt.
 */

type Exif = Record<string, unknown>

/** «2026:09:24 10:14:03» (+ ev. «+02:00») → Date. Uten offset: telefonens lokaltid. */
export function lesExifTid(verdi: unknown, offset?: unknown): Date | null {
  if (typeof verdi !== 'string') return null
  const m = verdi.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const [, a, mnd, d, t, min, sek] = m
  const off = typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : null
  const dato = off
    ? new Date(`${a}-${mnd}-${d}T${t}:${min}:${sek ?? '00'}${off}`)
    : new Date(Number(a), Number(mnd) - 1, Number(d), Number(t), Number(min), Number(sek ?? 0))
  if (Number.isNaN(dato.getTime())) return null
  // Kameraer uten klokke skriver 0000:00:00 eller 1970 — det er ingen tid.
  if (dato.getFullYear() < 2000) return null
  return dato
}

/**
 * Tiden fra en EXIF-blokk slik expo-image-picker gir den. iOS legger feltene
 * under «{Exif}», Android flatt — begge leses. Rekkefølge: når bildet ble
 * TATT, så når det ble digitalisert, så filens egen tid.
 */
export function tidFraExif(exif: Exif | null | undefined): Date | null {
  if (!exif || typeof exif !== 'object') return null
  const kilder: Exif[] = [exif]
  const nested = exif['{Exif}']
  if (nested && typeof nested === 'object') kilder.unshift(nested as Exif)
  const tiff = exif['{TIFF}']
  if (tiff && typeof tiff === 'object') kilder.push(tiff as Exif)
  for (const felt of ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime']) {
    for (const k of kilder) {
      const off = k[felt === 'DateTimeOriginal' ? 'OffsetTimeOriginal' : felt === 'DateTimeDigitized' ? 'OffsetTimeDigitized' : 'OffsetTime']
      const tid = lesExifTid(k[felt], off)
      if (tid) return tid
    }
  }
  return null
}

/**
 * Arbeidsdatoen bildene peker på: dagen de fleste bildene er fra. Henter han
 * bilder fra tirsdag på torsdag kveld, skal loggen gjelde tirsdag.
 */
export function arbeidsdatoFraBilder(tider: (Date | null)[]): string | null {
  const dager = new Map<string, number>()
  for (const t of tider) {
    if (!t) continue
    const p = (n: number) => String(n).padStart(2, '0')
    const dag = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
    dager.set(dag, (dager.get(dag) ?? 0) + 1)
  }
  let best: string | null = null
  let flest = 0
  for (const [dag, n] of dager) if (n > flest || (n === flest && best && dag < best)) { best = dag; flest = n }
  return best
}
