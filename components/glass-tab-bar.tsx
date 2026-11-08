import { useEffect, useState, type ComponentProps } from 'react'
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import type { Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { House, FolderOpen, FileText, Warehouse, MessageSquareWarning, Square } from 'lucide-react-native'
import { Text } from './text'
import { Pressable } from './pressable'
import { AmpexLogo } from './ampex-logo'
import { TilbakemeldingArk } from './tilbakemelding'
import { useVoiceSession } from '../lib/ai/voice-session'
import { colors } from '../lib/theme'

/**
 * APPLE-FANELINJA (Tormod 2026-11-04: «shapen matcher ikke Apple», «vil ha det på Android også»).
 *
 * Formen er iOS 26 sin: en flytende kapsel med fanene, og ved siden av en egen
 * glasssirkel i samme høyde (der Apple har søk, har vi assistenten). Valgt fane får
 * en lys kapsel bak seg som glir mellom fanene. Ingen hevet midtknapp, ingen delt
 * plass med piler — Prosjekter og Ordre får hver sin fane nå som merket står utenfor.
 *
 * Materialet: ekte Liquid Glass der iOS har det (26+), ellers frostet blur — på
 * Android også, så begge plattformer har samme form og samme følelse.
 */
type Fane = { name: string; label: string; sf: SFSymbol; sfValgt: SFSymbol; icon: typeof House }
const FANER: Fane[] = [
  { name: 'index', label: 'Hjem', sf: 'house', sfValgt: 'house.fill', icon: House },
  { name: 'prosjekter', label: 'Prosjekter', sf: 'folder', sfValgt: 'folder.fill', icon: FolderOpen },
  { name: 'ordre', label: 'Ordre', sf: 'doc.text', sfValgt: 'doc.text.fill', icon: FileText },
  { name: 'lager', label: 'Lager', sf: 'shippingbox', sfValgt: 'shippingbox.fill', icon: Warehouse },
]

// Målene er hentet fra iOS 26 sin egen fanelinje på iPhone 17 Pro (402 pt bred):
// kapsel og sirkel 62 pt høye, 21 pt fra sidekantene, bunnen 21 pt over skjermkanten
// (34 pt hjemindikator − 13), valgt-markøren 52 pt høy med 5 pt luft. Målt på Bilder-appen
// i simulatoren 2026-11-04.
export const TAB_BAR_HOYDE = 62
const KANT = 21
const MELLOMROM = 8
/** Avstand fra skjermbunnen til fanelinja — CartBar og innhold legger seg over denne. */
export function tabBarBunn(innsettBunn: number) { return Math.max(innsettBunn - 13, 12) }
const flytendeGlass = isLiquidGlassAvailable()

function Glass({ style, children }: { style: object; children?: React.ReactNode }) {
  if (flytendeGlass) {
    return <GlassView glassEffectStyle="regular" isInteractive style={style}>{children}</GlassView>
  }
  return (
    <View style={[style, styles.glassKant]}>
      <BlurView intensity={Platform.OS === 'android' ? 40 : 60} tint="light"
        blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
        style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.72)' }]} />
      {children}
    </View>
  )
}

type Props = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]

export function GlassTabBar({ state, navigation, descriptors }: Props) {
  const insets = useSafeAreaInsets()
  const { stage, beginSession, endSession } = useVoiceSession()
  const aktiv = state.routes[state.index]
  const skjult = (descriptors[aktiv.key]?.options.tabBarStyle as { display?: string } | undefined)?.display === 'none'

  // Rutene i kapselen, i fast rekkefølge. Gjemte ruter (href: null) står utenfor.
  const ruter = FANER.map(f => ({ fane: f, route: state.routes.find(r => r.name === f.name) }))
    .filter((x): x is { fane: Fane; route: typeof aktiv } => !!x.route)
  const valgt = ruter.findIndex(x => x.route.key === aktiv.key)

  // Kapselen bak valgt fane glir dit. Står du på en rute utenfor linja (kunder,
  // arkiv …), forsvinner den — ingen fane er valgt da.
  const [bredde, setBredde] = useState(0)
  const [tilbakemelding, setTilbakemelding] = useState(false)
  const steg = ruter.length > 0 ? (bredde - 10) / ruter.length : 0
  const x = useSharedValue(0)
  const synlig = useSharedValue(0)
  useEffect(() => {
    if (steg === 0) return
    if (valgt >= 0) x.value = synlig.value === 0 ? valgt * steg : withSpring(valgt * steg, { damping: 22, stiffness: 260, mass: 0.8 })
    synlig.value = withSpring(valgt >= 0 ? 1 : 0, { damping: 20, stiffness: 300 })
  }, [valgt, steg])
  const markør = useAnimatedStyle(() => ({ width: steg, opacity: synlig.value, transform: [{ translateX: x.value }] }))

  if (skjult) return null

  function trykk(route: typeof aktiv, fokus: boolean) {
    const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
    if (!fokus && !e.defaultPrevented) navigation.navigate(route.name, route.params)
  }

  const bunn = tabBarBunn(insets.bottom)
  return (
    <>
    {/* Tilbakemelding: smal glassfane på høyre kant, som på nettsider — holder
        fanelinja ren (Tormod: «for klumpete»). */}
    <Pressable haptic="light" pressScale={0.94} onPress={() => setTilbakemelding(true)} accessibilityLabel="Gi tilbakemelding"
      hitSlop={{ left: 8, top: 8, bottom: 8 }}
      style={{ position: 'absolute', right: 0, bottom: bunn + TAB_BAR_HOYDE + 120 }}>
      <Glass style={styles.kantfane}>
        <View style={styles.sirkelInnhold}>
          <SymbolView name="exclamationmark.bubble" size={17} tintColor={colors.secondaryLabel} weight="medium"
            fallback={<MessageSquareWarning size={17} color={colors.secondaryLabel} strokeWidth={1.9} />} />
        </View>
      </Glass>
    </Pressable>
    <TilbakemeldingArk synlig={tilbakemelding} onLukk={() => setTilbakemelding(false)} />
    <View pointerEvents="box-none" style={[styles.rad, { bottom: bunn }]}>
      <Glass style={styles.kapsel}>
        <View style={styles.innhold} onLayout={(e: LayoutChangeEvent) => setBredde(e.nativeEvent.layout.width)}>
          <Animated.View pointerEvents="none" style={[styles.markør, markør]} />
          {ruter.map(({ fane, route }) => {
            const fokus = route.key === aktiv.key
            const farge = fokus ? colors.label : colors.secondaryLabel
            const Ikon = fane.icon
            return (
              <Pressable key={route.key} haptic="light" pressScale={0.92} onPress={() => trykk(route, fokus)}
                onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                accessibilityRole="tab" accessibilityState={{ selected: fokus }} accessibilityLabel={fane.label}
                style={styles.fane}>
                <SymbolView name={fokus ? fane.sfValgt : fane.sf} size={25} tintColor={farge} weight="medium"
                  fallback={<Ikon size={22} color={farge} strokeWidth={fokus ? 2.4 : 1.8} />} />
                <Text numberOfLines={1} style={[styles.etikett, { color: farge, fontWeight: fokus ? '600' : '500' }]}>{fane.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </Glass>
      {/* Assistenten: egen glasssirkel, som søkeknappen i Apples egne apper. */}
      {/* Under en økt blir samme sirkel stoppknappen — alltid på samme sted. */}
      <Pressable haptic="medium" pressScale={0.92}
        onPress={stage === 'idle' ? beginSession : () => void endSession({ discard: false })}
        accessibilityLabel={stage === 'idle' ? 'Start med AI' : 'Stopp assistenten'}>
        <Glass style={styles.sirkel}>
          <View style={styles.sirkelInnhold}>
            {stage === 'idle'
              ? <AmpexLogo size={26} color={colors.label} />
              : <SymbolView name="stop.fill" size={20} tintColor={colors.label}
                  fallback={<Square size={18} color={colors.label} fill={colors.label} />} />}
          </View>
        </Glass>
      </Pressable>
    </View>
    </>
  )
}

const styles = StyleSheet.create({
  rad: { position: 'absolute', left: KANT, right: KANT, flexDirection: 'row', alignItems: 'center', gap: MELLOMROM },
  kapsel: {
    flex: 1, height: TAB_BAR_HOYDE, borderRadius: TAB_BAR_HOYDE / 2, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
  glassKant: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.08)', overflow: 'hidden', elevation: 8 },
  innhold: { flex: 1, flexDirection: 'row', paddingHorizontal: 5, paddingVertical: 5 },
  markør: {
    position: 'absolute', top: 5, bottom: 5, left: 5,
    borderRadius: (TAB_BAR_HOYDE - 10) / 2, backgroundColor: 'rgba(0,0,0,0.07)',
  },
  fane: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  etikett: { fontSize: 10, letterSpacing: 0.1 },
  sirkel: { width: TAB_BAR_HOYDE, height: TAB_BAR_HOYDE, borderRadius: TAB_BAR_HOYDE / 2, overflow: 'hidden' },
  kantfane: { width: 34, height: 44, borderTopLeftRadius: 14, borderBottomLeftRadius: 14, overflow: 'hidden' },
  sirkelInnhold: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
