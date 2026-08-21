import { StyleSheet, Text as RNText, TextInput as RNTextInput, type StyleProp, type TextStyle } from 'react-native'
import Animated from 'react-native-reanimated'
import { fontKlar, geistFamilie } from '../lib/fonts'

/**
 * `Text` og `TextInput` for hele appen — importer disse, ikke dem fra
 * react-native.
 *
 * Grunnen er én: en egendefinert font kan ikke gjøres fetere av `fontWeight`.
 * Hver vekt er sin egen fil med sitt eget familienavn, og `fontWeight: '600'`
 * over en Geist-Regular gjør ingenting — teksten vises, bare i feil vekt. Det
 * er en feil ingen oppdager og alle ser.
 *
 * Her oversettes vekt → fil én gang, for all tekst. Skjermene fortsetter å
 * skrive `fontWeight` som før, og RN-API-et er uendret; det eneste som er
 * annerledes er hvor `Text` importeres fra.
 */

function medFamilie(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  // Før fonten er lastet skal ingenting skje: systemfonten er fallbacken, og
  // typografi skal aldri kunne stoppe et produkt fra å vise tekst.
  if (!fontKlar()) return style
  const flat = StyleSheet.flatten(style) as TextStyle | undefined
  // Ikonfonter (@expo/vector-icons) tegner tegn som ikke finnes i Geist. Alt
  // annet med egen familie er allerede bestemt av den som skrev det.
  if (flat?.fontFamily && !flat.fontFamily.startsWith('Geist')) return style
  // `fontWeight: 'normal'` er ikke pynt: uten den legger Android en syntetisk
  // fetstil OPPÅ en fil som allerede er fet.
  return [style, { fontFamily: geistFamilie(flat?.fontWeight), fontWeight: 'normal' as const }]
}

export function Text({ style, ...rest }: React.ComponentProps<typeof RNText>) {
  return <RNText {...rest} style={medFamilie(style)} />
}

export function TextInput({ style, ...rest }: React.ComponentProps<typeof RNTextInput>) {
  return <RNTextInput {...rest} style={medFamilie(style)} />
}

/**
 * For tekst som animeres (Reanimated). `Animated.Text` går rett på RN-teksten
 * og hadde derfor stått igjen på systemfonten mens resten av skjermen byttet.
 */
export const AnimatedText = Animated.createAnimatedComponent(Text)
