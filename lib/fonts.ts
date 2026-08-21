import { useFonts } from 'expo-font'
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif'

/**
 * ── Typografisk identitet ──────────────────────────────────────────────────
 *
 * Appen brukte systemfonten på HVER eneste tekst. SF er en utmerket font, men
 * den er også fonten hver eneste iOS-app har — og det er den enkeltgrunnen til
 * at et velbygget produkt likevel leser som «laget av en mal».
 *
 * Valget: **serif på display, SF på alt annet.**
 *
 * Instrument Serif på titlene og de store tallene. En høykontrast display-serif
 * er uventet i denne kategorien — Jobber, Tradify, SpeedyCraft og Cordel bruker
 * alle en grotesk — og den trekker i nøyaktig samme retning som brunt og
 * kremet: noe som er laget, ikke satt sammen.
 *
 * Hvorfor IKKE bytte brødteksten også: 102 steder i appen overstyrer
 * `fontWeight` lokalt. Med en egendefinert familie blir de overstyringene
 * ignorert, og tekst som skulle vært halvfet blir tynn — 102 stille
 * regresjoner for en gevinst ingen ser. Display-stilene overstyres ingen
 * steder, så de kan byttes trygt. Serif-display mot SF-brødtekst er dessuten
 * en klassisk paring, ikke en nødløsning.
 */
export const DISPLAY_FONT = 'InstrumentSerif_400Regular'

export function useAmpexFonts() {
  const [klar] = useFonts({ InstrumentSerif_400Regular })
  return klar
}
