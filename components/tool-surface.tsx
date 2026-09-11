import { useCallback } from 'react'
import { View } from 'react-native'
import { Text } from './text'
import { useFocusEffect } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { setStatusBarStyle } from 'expo-status-bar'
import { Pressable } from './pressable'
import { colors, spacing, radius, type as t } from '../lib/theme'

/**
 * ── Verktøyflaten ──────────────────────────────────────────────────────────
 *
 * Ampex har to slags skjermer, og de skal ikke se like ut:
 *
 *   VERKTØY  ordre, lager, prosjekter, lister. Mørk grunn, tett, høy kontrast.
 *   PAPIR    skjema, tilbud, arkiv. Kremet grunn — ting som ER dokumenter.
 *
 * Kremfargen ble brukt overalt, og den ligger i samme familie som Kindle,
 * Apple Notes og Goodreads. Derfor leste hver eneste skjerm som en notatblokk.
 * Nå betyr fargen noe: skiftet fra mørkt til kremet forteller deg at du har
 * gått fra å JOBBE til å DOKUMENTERE.
 *
 * Denne fila er rammen som gjør det billig å bygge en verktøyskjerm riktig, så
 * neste skjerm ikke finner opp sine egne verdier igjen.
 */

/**
 * Lys klokke og batteri — standarden, siden grunnflaten er brun. Rot-layoutet
 * setter den allerede; denne finnes for skjermer som kommer TILBAKE fra et
 * dokument og må sette den på plass igjen.
 */
export function useMorkStatuslinje() {
  useFocusEffect(useCallback(() => { setStatusBarStyle('light') }, []))
}

/**
 * MØRK statuslinje mens et dokument er i fokus — og lys igjen når du går ut.
 *
 * `<StatusBar>` setter stilen ved mount og gjenoppretter ingenting ved unmount.
 * Uten denne blir klokke og batteri kremhvite på kremet papir i det du åpner et
 * skjema fra en brun skjerm — usynlige, og umulig å spore tilbake til hvor det
 * ble satt.
 */
export function usePapirStatuslinje() {
  useFocusEffect(useCallback(() => {
    setStatusBarStyle('dark')
    return () => setStatusBarStyle('light')
  }, []))
}

/**
 * Lyskilden alene. En flat mørk flate ser billig ut — ekte mørke grensesnitt
 * har et sted lyset kommer fra.
 *
 * Løsrevet fra `ToolScreen` fordi flere skjermer har sin egen rot-View (modaler,
 * KeyboardAvoidingView) og bare trenger gløden. Den er den mørke tvillingen til
 * `AmbientBackdrop`, og byttes rett inn der den lå.
 */
export function ToolGlow({ height = 420 }: { height?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height }}>
      <LinearGradient
        colors={['rgba(29,29,31,0.05)', 'rgba(29,29,31,0.012)', 'rgba(0,0,0,0)']}
        locations={[0, 0.45, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ flex: 1 }}
      />
    </View>
  )
}

/** Mørk sidegrunn med lyskilde. */
export function ToolScreen({ children }: { children: React.ReactNode }) {
  useMorkStatuslinje()
  return (
    <View style={{ flex: 1, backgroundColor: colors.toolBg }}>
      <ToolGlow />
      {children}
    </View>
  )
}

/**
 * Panel på mørk grunn. Dybde ved VERDI, ikke ved skygge — en lysere flate
 * leses som nærmere. Diffuse skygger på alt er dessuten et av de tydeligste
 * tegnene på et grensesnitt ingen har tatt et valg i.
 */
export function ToolCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[{
      marginHorizontal: spacing.screen,
      backgroundColor: colors.toolRaised,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.toolBorder,
      overflow: 'hidden',
    }, style]}>
      {children}
    </View>
  )
}

export function ToolSectionHeader({ children }: { children: string }) {
  return (
    <Text style={[t.eyebrow, {
      textTransform: 'uppercase',
      color: colors.toolTertiary,
      marginHorizontal: spacing.screen + spacing.xs,
      marginBottom: spacing.sm,
    }]}>
      {children}
    </Text>
  )
}

/** Chip på mørk grunn — radius.pill, som er det eneste stedet pille hører hjemme. */
export function ToolChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      pressScale={0.95}
      haptic="light"
      onPress={onPress}
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm - 1,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.brandSoft : colors.toolRaised,
        borderWidth: 1,
        borderColor: selected ? colors.brandSoft : colors.toolBorder,
      }}
    >
      <Text style={[t.footnote, { fontWeight: '600', color: selected ? colors.label : colors.toolSecondary }]}>
        {label}
      </Text>
    </Pressable>
  )
}
