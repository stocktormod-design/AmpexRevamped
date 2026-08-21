import { useEffect, useState } from 'react'
import type { TextStyle } from 'react-native'
import { loadAsync } from 'expo-font'
// Undermapper, ikke pakkeroten: roten re-eksporterer alle 18 vektene, og da
// havner ~1,6 MB font i appen for å bruke fire av dem.
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular'
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium'
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold'
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold'

/**
 * ── Typografisk identitet ──────────────────────────────────────────────────
 *
 * **Én font, overalt: Geist.**
 *
 * Før sto Instrument Serif på titlene og systemfonten på alt annet. To fonter
 * i samme grensesnitt leses som to grensesnitt — og paret serif+grotesk er
 * nettopp det paret øyet plukker opp raskest.
 *
 * Systemfonten var heller ikke ett valg, men to: SF på iOS og Roboto på
 * Android. Samme app i to forskjellige klær, avhengig av hvilken telefon
 * montøren har. Geist følger med i appen og ser lik ut på iOS, Android og web.
 * Den har dessuten tabulære tall, som ikke er en detalj her: timer, kroner og
 * el-numre står i kolonner gjennom hele appen.
 *
 * ── Hvorfor vekten byttes SENTRALT ─────────────────────────────────────────
 *
 * En egendefinert font kan ikke gjøres fetere av `fontWeight` — hver vekt er
 * sin egen fil og sitt eget familienavn. Appen overstyrer `fontWeight` lokalt
 * på 118 steder, og alle 118 ville blitt ignorert i stillhet: teksten hadde
 * fortsatt vist, bare i feil vekt. Det er en feil ingen oppdager og alle ser.
 *
 * Derfor oversettes vekt → familie ÉN gang, i `components/text.tsx`. Alle 118
 * stedene fortsetter å skrive `fontWeight: '600'` og får riktig fil — og det
 * gjør hver ny tekst som skrives etter dette også.
 *
 * ── Hvorfor dette IKKE er `useFonts` ───────────────────────────────────────
 *
 * Første forsøk brukte `useFonts` og holdt hele treet tilbake til fonten var
 * klar. Fonten ble aldri klar, hooken rendret i evig løkke, og appen viste en
 * hvit skjerm uten én feilmelding — hverken i konsollen, i Metro eller i
 * krasjloggen. Det er den verste feiltypen som finnes: total, og taus.
 *
 * Lærdommen er ikke «den hooken har en bug». Den er at **typografi aldri skal
 * kunne stoppe et produkt fra å starte.** Fonten lastes ved siden av appen, i
 * en effekt som ikke kan kaste og ikke kan blokkere. Lykkes den, tegnes teksten
 * om. Lykkes den ikke, får du systemfonten og et varsel i konsollen — og appen
 * din virker.
 */

const VEKTER = {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
}

/**
 * Vekt → fil. 800/900 finnes ikke i utvalget med vilje: forskjellen fra 700 er
 * ikke synlig i en app som denne, og hver vekt er en fil som skal lastes.
 */
export function geistFamilie(vekt: TextStyle['fontWeight']): string {
  switch (vekt) {
    case '500': return 'Geist_500Medium'
    case '600': return 'Geist_600SemiBold'
    case '700':
    case '800':
    case '900':
    case 'bold': return 'Geist_700Bold'
    default: return 'Geist_400Regular'
  }
}

let lastet = false

/** True når Geist er lastet. Leses av `components/text.tsx` ved render. */
export function fontKlar(): boolean {
  return lastet
}

/**
 * Returnerer true når Geist er inne. Verdien brukes til å tegne treet om, ikke
 * til å slippe appen fram — ingen skjerm venter på den.
 */
export function useAmpexFonts(): boolean {
  const [klar, setKlar] = useState(lastet)
  useEffect(() => {
    if (lastet) return
    let levende = true
    loadAsync(VEKTER)
      .then(() => {
        lastet = true
        if (levende) setKlar(true)
      })
      .catch(e => console.warn('Font: Geist lastet ikke, bruker systemfont:', e))
    return () => { levende = false }
  }, [])
  return klar
}
