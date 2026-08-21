// Typed theme — re-exports lib/tokens.js and adds RN-specific pieces
// (text styles, spring presets). Import from here in all screens/components.
import type { TextStyle, ViewStyle } from 'react-native'
import { WithSpringConfig } from 'react-native-reanimated'
import { DISPLAY_FONT } from './fonts'

const tokens = require('./tokens.js') as {
  colors: Record<string, string>
  spacing: Record<string, number>
  radius: Record<string, number>
  sizes: Record<string, number>
}

export const colors = tokens.colors
export const spacing = tokens.spacing
export const radius = tokens.radius
export const sizes = tokens.sizes

// iOS HIG type scale (size/lineHeight/weight/tracking).
// Use these instead of ad-hoc fontSize — consistency IS the Apple feel.
export const type = {
  // Ampex display-signatur: skjermtitler og store tall. Tyngre og strammere enn
  // HIG-largeTitle — det som skiller «verktøy laget med omhu» fra Innstillinger.
  // Serif. Ingen fontWeight: med en egendefinert familie synteser iOS en falsk
  // fetstil som ser billig ut — vekten ligger i filen, ikke i stilen.
  // En serif trenger dessuten mindre negativ sporing enn en grotesk; -1.0 ville
  // presset seriffene inn i hverandre.
  display: { fontSize: 38, lineHeight: 44, fontFamily: DISPLAY_FONT, letterSpacing: -0.4, color: colors.label } satisfies TextStyle,
  // Eyebrow: liten caps-linje over titler/hero-kort (dato, status·tid). Bred tracking
  // gir teknisk «måleinstrument»-rytme. Brukes med textTransform: 'uppercase'.
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 1.1, color: colors.secondaryLabel } satisfies TextStyle,
  largeTitle: { fontSize: 36, lineHeight: 42, fontFamily: DISPLAY_FONT, letterSpacing: -0.3, color: colors.label } satisfies TextStyle,
  title1: { fontSize: 30, lineHeight: 36, fontFamily: DISPLAY_FONT, letterSpacing: -0.2, color: colors.label } satisfies TextStyle,
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3, color: colors.label } satisfies TextStyle,
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.3, color: colors.label } satisfies TextStyle,
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.3, color: colors.label } satisfies TextStyle,
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400', letterSpacing: -0.3, color: colors.label } satisfies TextStyle,
  bodyMedium: { fontSize: 17, lineHeight: 22, fontWeight: '500', letterSpacing: -0.3, color: colors.label } satisfies TextStyle,
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400', letterSpacing: -0.2, color: colors.label } satisfies TextStyle,
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.2, color: colors.label } satisfies TextStyle,
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0, color: colors.secondaryLabel } satisfies TextStyle,
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.3, color: colors.secondaryLabel } satisfies TextStyle,
} as const

// Shadows — hero/feature cards only; inset-list cards stay flat on grouped bg.
// Don't combine with overflow:'hidden' on iOS (clipsToBounds kills the shadow).
export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  } satisfies ViewStyle,
  // Elements floating OVER a tab's content (not inline in a scroll view) — cart bar/sheet.
  // Needs to read as clearly lifted off the page, not just gently inset.
  floating: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  } satisfies ViewStyle,
} as const

// Spring presets (Reanimated). Springs, never duration+easing — that's the Apple feel.
export const springs = {
  // Press feedback: fast in, no bounce
  press: { damping: 20, stiffness: 400, mass: 0.6 } satisfies WithSpringConfig,
  // Elements settling into place (sheets, cards)
  settle: { damping: 18, stiffness: 220 } satisfies WithSpringConfig,
  // Playful entrance (staggered list items)
  entrance: { damping: 16, stiffness: 180 } satisfies WithSpringConfig,
} as const
