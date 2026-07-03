import { View, Text } from 'react-native'
import { BlurView } from 'expo-blur'
import { Pressable } from './pressable'
import { colors, spacing, radius, shadows, type as t } from '../lib/theme'

/** Seksjonsoverskrift i iOS grouped-stil: liten caps over kortet */
export function SectionHeader({ children }: { children: string }) {
  return (
    <Text style={[t.caption, {
      textTransform: 'uppercase',
      marginHorizontal: spacing.screen + spacing.lg,
      marginBottom: spacing.sm - 1,
    }]}>
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
        borderRadius: radius.xl,
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
  const outerStyle = [{ marginHorizontal: spacing.screen, borderRadius: radius.xl }, shadows.card]
  return onPress
    ? <Pressable onPress={onPress} style={outerStyle}>{inner}</Pressable>
    : <View style={outerStyle}>{inner}</View>
}

/** Filter-/valg-pille. Valgt = Ampex-sort, ellers hvit med hårlinje. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      pressScale={0.95}
      onPress={onPress}
      style={{
        paddingHorizontal: spacing.md + 2,
        paddingVertical: spacing.sm,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.cta : colors.bg,
        borderWidth: 0.5,
        borderColor: selected ? colors.cta : colors.border,
      }}
    >
      <Text style={[t.footnote, { fontWeight: '500', color: selected ? colors.ctaLabel : colors.secondaryLabel }]}>
        {label}
      </Text>
    </Pressable>
  )
}
