// Typed theme — re-exports lib/tokens.js and adds RN-specific pieces
// (text styles, spring presets). Import from here in all screens/components.
import type { TextStyle, ViewStyle } from 'react-native'
import { WithSpringConfig } from 'react-native-reanimated'
import './fonts' // kobler på vekt→fil-oversettelsen for Geist

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
  // Sporingen er strammere enn HIG fordi en grotesk i 38 px står for luftig med
  // normal sporing; det er trangheten som gjør en tittel til en display-tittel.
  display: { fontSize: 38, lineHeight: 44, fontWeight: '600', letterSpacing: -0.9, color: colors.label } satisfies TextStyle,
  // Eyebrow: liten caps-linje over titler/hero-kort (dato, status·tid). Bred tracking
  // gir teknisk «måleinstrument»-rytme. Brukes med textTransform: 'uppercase'.
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 1.1, color: colors.secondaryLabel } satisfies TextStyle,
  largeTitle: { fontSize: 36, lineHeight: 42, fontWeight: '600', letterSpacing: -0.8, color: colors.label } satisfies TextStyle,
  title1: { fontSize: 30, lineHeight: 36, fontWeight: '600', letterSpacing: -0.6, color: colors.label } satisfies TextStyle,
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

/**
 * Samme skala, mørkt blekk — for dokumentskjermene (papir).
 *
 * Papiret er unntaket i appen: alt er brunt bortsett fra det du ser inne i et
 * dokument. Importeres som `paperType as t` der, på samme måte som resten av
 * appen bruker `type`.
 */
export const paperType = {
  display: { ...type.display, color: colors.paperLabel },
  eyebrow: { ...type.eyebrow, color: colors.paperSecondary },
  largeTitle: { ...type.largeTitle, color: colors.paperLabel },
  title1: { ...type.title1, color: colors.paperLabel },
  title2: { ...type.title2, color: colors.paperLabel },
  title3: { ...type.title3, color: colors.paperLabel },
  headline: { ...type.headline, color: colors.paperLabel },
  body: { ...type.body, color: colors.paperLabel },
  bodyMedium: { ...type.bodyMedium, color: colors.paperLabel },
  callout: { ...type.callout, color: colors.paperLabel },
  subhead: { ...type.subhead, color: colors.paperLabel },
  footnote: { ...type.footnote, color: colors.paperSecondary },
  caption: { ...type.caption, color: colors.paperSecondary },
} as const

/**
 * Samme skala, kremet blekk — for de mørke verktøyskjermene.
 *
 * Uten denne må hver eneste `<Text>` på en mørk skjerm skrive
 * `[t.body, { color: colors.toolLabel }]`, og det er nøyaktig slik en skjerm
 * ender opp med tre nyanser grått som ingen har bestemt. Importeres som
 * `toolType as t`, så en skjerm bytter flate ved å bytte ÉN linje.
 */
export const toolType = {
  display: { ...type.display, color: colors.toolLabel },
  eyebrow: { ...type.eyebrow, color: colors.toolTertiary },
  largeTitle: { ...type.largeTitle, color: colors.toolLabel },
  title1: { ...type.title1, color: colors.toolLabel },
  title2: { ...type.title2, color: colors.toolLabel },
  title3: { ...type.title3, color: colors.toolLabel },
  headline: { ...type.headline, color: colors.toolLabel },
  body: { ...type.body, color: colors.toolLabel },
  bodyMedium: { ...type.bodyMedium, color: colors.toolLabel },
  callout: { ...type.callout, color: colors.toolLabel },
  subhead: { ...type.subhead, color: colors.toolLabel },
  footnote: { ...type.footnote, color: colors.toolSecondary },
  caption: { ...type.caption, color: colors.toolSecondary },
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
