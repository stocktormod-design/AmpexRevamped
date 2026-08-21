import { useEffect, useState } from 'react'
import { loadAsync } from 'expo-font'
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif'

/**
 * ── Typografisk identitet ──────────────────────────────────────────────────
 *
 * Appen brukte systemfonten på HVER eneste tekst. SF er en utmerket font, men
 * den er også fonten hver eneste iOS-app har — og det er enkeltgrunnen til at
 * et velbygget produkt likevel leser som «laget av en mal».
 *
 * Valget: **serif på display, SF på alt annet.** Instrument Serif på titlene og
 * de store tallene. En høykontrast display-serif er uventet i kategorien —
 * Jobber, Tradify, SpeedyCraft og Cordel bruker alle en grotesk.
 *
 * Brødteksten blir på SF med vilje: 102 steder i appen overstyrer `fontWeight`
 * lokalt, og med en egendefinert familie blir de overstyringene ignorert.
 * Display-stilene overstyres ingen steder, så de kan byttes trygt.
 *
 * ── Hvorfor dette IKKE er `useFonts` ───────────────────────────────────────
 *
 * Første forsøk brukte `useFonts` og holdt hele treet tilbake til fonten var
 * klar. Fonten ble aldri klar, hooken rendret i evig løkke, og appen viste en
 * hvit skjerm uten én feilmelding — hverken i konsollen, i Metro eller i
 * krasjloggen. Det er den verste feiltypen som finnes: total, og taus.
 *
 * Lærdommen er ikke «den hooken har en bug». Den er at **typografi aldri skal
 * kunne stoppe et produkt fra å starte.** Fonten lastes nå ved siden av appen,
 * i en effekt som ikke kan kaste og ikke kan blokkere. Lykkes den, tegnes
 * titlene om. Lykkes den ikke, får du systemfonten og et varsel i konsollen —
 * og appen din virker.
 */
export const DISPLAY_FONT = 'InstrumentSerif_400Regular'

let lastet = false

/**
 * Returnerer true når serifen er inne. Ingen som helst grunn til å VENTE på
 * den — den brukes til å tegne titlene om, ikke til å slippe appen fram.
 */
export function useAmpexFonts(): boolean {
  const [klar, setKlar] = useState(lastet)
  useEffect(() => {
    if (lastet) return
    let levende = true
    loadAsync({ InstrumentSerif_400Regular })
      .then(() => {
        lastet = true
        if (levende) setKlar(true)
      })
      .catch(e => console.warn('Font: Instrument Serif lastet ikke, bruker systemfont:', e))
    return () => { levende = false }
  }, [])
  return klar
}
