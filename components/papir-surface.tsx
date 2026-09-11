import { useCallback } from 'react'
import { View } from 'react-native'
import { Text } from './text'
import { useFocusEffect } from 'expo-router'
import { setStatusBarStyle } from 'expo-status-bar'
import { Pressable } from './pressable'
import { colors, spacing, radius, type as t } from '../lib/theme'

/**
 * ── Papirflaten ────────────────────────────────────────────────────────────
 *
 * Grunnflaten er papir (DESIGN.md «Papir og messing», låst 2026-08-29).
 * Dette er papir-motstykket til `tool-surface.tsx`: samme API-er, så en skjerm
 * flipper flate ved å bytte import — ikke ved å finne opp egne verdier.
 *
 * Dybde på papir lages med VARM SKYGGE og luft (shadows.card), hårlinjer er
 * nesten usynlige. Verdi-dybden hører til de mørke instrumentflatene.
 */

/** Papir-grunn → mørk statuslinje mens skjermen er i fokus. */
export function usePapirFokus() {
  useFocusEffect(useCallback(() => { setStatusBarStyle('dark') }, []))
}

/** Papir-sidegrunn. */
export function PapirScreen({ children }: { children: React.ReactNode }) {
  usePapirFokus()
  return <View style={{ flex: 1, backgroundColor: colors.canvas }}>{children}</View>
}

/** Panel på papir: hvitere ark, hårlinje. Skygge legges kun på heroer. */
export function PapirCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[{
      marginHorizontal: spacing.screen,
      backgroundColor: colors.bg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.separator,
      overflow: 'hidden',
    }, style]}>
      {children}
    </View>
  )
}

export function PapirSectionHeader({ children }: { children: string }) {
  return (
    <Text style={[t.eyebrow, {
      textTransform: 'uppercase',
      marginHorizontal: spacing.screen + spacing.xs,
      marginBottom: spacing.sm,
    }]}>
      {children}
    </Text>
  )
}

/** Filter-chip på papir. Valgt = løftet ark (hvit + blekk + liten varm skygge),
 *  uvalgt = felt-fyll. Aldri messing — den er opptatt. */
export function PapirChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      pressScale={0.95}
      haptic="light"
      onPress={onPress}
      style={[
        {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm - 1,
          borderRadius: radius.pill,
          // Valgt = SORT pille med hvit tekst (Apple-segmentet). Hvit-på-hvit
          // med skygge forsvant på den hvite grunnen.
          backgroundColor: selected ? colors.label : colors.fill,
          borderWidth: 1,
          borderColor: selected ? colors.label : 'transparent',
        },
      ]}
    >
      <Text style={[t.footnote, { fontWeight: '600', color: selected ? '#FFFFFF' : colors.secondaryLabel }]}>
        {label}
      </Text>
    </Pressable>
  )
}
