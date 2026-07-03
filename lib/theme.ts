// Typed theme — re-exports lib/tokens.js and adds RN-specific pieces
// (text styles, spring presets). Import from here in all screens/components.
import type { TextStyle } from 'react-native'
import { WithSpringConfig } from 'react-native-reanimated'

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
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.5, color: colors.label } satisfies TextStyle,
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.4, color: colors.label } satisfies TextStyle,
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

// Spring presets (Reanimated). Springs, never duration+easing — that's the Apple feel.
export const springs = {
  // Press feedback: fast in, no bounce
  press: { damping: 20, stiffness: 400, mass: 0.6 } satisfies WithSpringConfig,
  // Elements settling into place (sheets, cards)
  settle: { damping: 18, stiffness: 220 } satisfies WithSpringConfig,
  // Playful entrance (staggered list items)
  entrance: { damping: 16, stiffness: 180 } satisfies WithSpringConfig,
} as const
