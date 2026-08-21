import { View, Text } from 'react-native'
import { BlurView } from 'expo-blur'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { Pressable } from './pressable'
import { colors, spacing, radius, shadows, type as t } from '../lib/theme'

/**
 * Myke ambient-flekker bak innhold — glass trenger noe å bryte, en flat farge
 * bak glass er usynlig. `scrollY` gir parallakse på scrollbare skjermer,
 * utelates for statiske flater (f.eks. en empty-state-boks).
 */
export function AmbientBackdrop({ scrollY, height = 460 }: { scrollY?: SharedValue<number>; height?: number }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollY ? -scrollY.value * 0.35 : 0 }],
  }))
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, height }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="cool" cx="18%" cy="12%" r="65%">
            <Stop offset="0" stopColor={colors.ambientCool} stopOpacity="0.9" />
            <Stop offset="1" stopColor={colors.ambientCool} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="warm" cx="88%" cy="34%" r="60%">
            <Stop offset="0" stopColor={colors.ambientWarm} stopOpacity="0.75" />
            <Stop offset="1" stopColor={colors.ambientWarm} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#cool)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#warm)" />
      </Svg>
    </Animated.View>
  )
}

/** Seksjonsoverskrift: eyebrow-caps med bred tracking — Ampex-rytmen, ikke Settings */
/** `tone="light"` for skjermer med mørk grunn (ordredetaljen). */
export function SectionHeader({ children, tone = 'default' }: { children: string; tone?: 'default' | 'light' }) {
  return (
    <Text style={[t.eyebrow, {
      textTransform: 'uppercase',
      marginHorizontal: spacing.screen + spacing.lg,
      marginBottom: spacing.sm - 1,
    }, tone === 'light' && { color: 'rgba(251,247,240,0.55)' }]}>
      {children}
    </Text>
  )
}

/** Frostet glasskort — skygge på wrapper (overflow:hidden på BlurView klipper den ellers) */
export function GlassCard({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  const inner = (
    <BlurView
      tint="light"
      intensity={40}
      style={{
        borderRadius: radius.hero,
        overflow: 'hidden',
        padding: spacing.xl,
        backgroundColor: colors.cardGlass,
        borderWidth: 0.5,
        borderColor: colors.glassEdge,
      }}
    >
      {children}
    </BlurView>
  )
  const outerStyle = [{ marginHorizontal: spacing.screen, borderRadius: radius.hero }, shadows.card]
  return onPress
    ? <Pressable onPress={onPress} style={outerStyle}>{inner}</Pressable>
    : <View style={outerStyle}>{inner}</View>
}

/**
 * Solid kremhvit hero-/featured-kort — Claude Design "lys + kobber"-retningen.
 * Ingen blur; myk skygge gir dybden. Ingen innebygd padding — barna styrer egen
 * indre spacing (header padded, media/CTA nær kant, som i synket design).
 */
export function CreamCard({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: object }) {
  const inner = <View style={{ borderRadius: radius.hero, overflow: 'hidden', backgroundColor: colors.brandSoft }}>{children}</View>
  const outerStyle = [{ marginHorizontal: spacing.screen, borderRadius: radius.hero }, shadows.card, style]
  return onPress
    ? <Pressable onPress={onPress} style={outerStyle}>{inner}</Pressable>
    : <View style={outerStyle}>{inner}</View>
}

/**
 * Hvitt strukturert kort m/hårlinje-kant (Materiell/Dokumentasjon-stil) — flatere
 * enn CreamCard, ingen skygge. For radlister der innholdet selv er hovedsaken.
 */
export function ListCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[{
      marginHorizontal: spacing.screen, borderRadius: radius.hero, overflow: 'hidden',
      backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    }, style]}>
      {children}
    </View>
  )
}

/** Filter-/valg-pille. Valgt = kobber-tint (myk, ikke sort system-pille), ellers glass. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      pressScale={0.95}
      onPress={onPress}
      style={{
        paddingHorizontal: spacing.md + 2,
        paddingVertical: spacing.sm,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.brandSoft : colors.cardGlassStrong,
        borderWidth: 0.5,
        borderColor: selected ? colors.brand : colors.glassEdge,
      }}
    >
      <Text style={[t.footnote, { fontWeight: '500', color: selected ? colors.brand : colors.secondaryLabel }]}>
        {label}
      </Text>
    </Pressable>
  )
}
