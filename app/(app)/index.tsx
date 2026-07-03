import { View, Text, ScrollView, StatusBar } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { router } from 'expo-router'
import {
  CirclePlus, FolderOpen, Package, Clock,
  ScanBarcode, TriangleAlert, ShieldCheck, ChevronRight,
  type LucideIcon,
} from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

const actions: { label: string; sub: string; Icon: LucideIcon; onPress: () => void }[] = [
  { label: 'Ny ordre',      sub: 'Service, installasjon, kontroll', Icon: CirclePlus, onPress: () => router.push('/(app)/ordre') },
  { label: 'Nytt prosjekt', sub: 'Tegninger, rom, framdrift',       Icon: FolderOpen, onPress: () => router.push('/(app)/prosjekter') },
  { label: 'Lager',         sub: 'Inn/ut, bil, bestilling',         Icon: Package,    onPress: () => router.push('/(app)/lager') },
  { label: 'Timeføring',    sub: 'Dag, uke, godkjenn forslag',      Icon: Clock,      onPress: () => {} },
]

const shortcuts: { label: string; Icon: LucideIcon }[] = [
  { label: 'Skann', Icon: ScanBarcode },
  { label: 'Avvik', Icon: TriangleAlert },
  { label: 'HMS',   Icon: ShieldCheck },
]

export default function HomeScreen() {
  const insets = useSafeAreaInsets()

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.xxl }}>
          <Text style={[t.caption, { marginBottom: spacing.xs }]}>Ampex</Text>
          <Text style={t.largeTitle}>Hva vil du gjøre?</Text>
        </View>

        {/* Actions */}
        {actions.map((a, i) => (
          <Animated.View key={a.label} entering={FadeInDown.springify().delay(i * 40)}>
            <Pressable
              onPress={a.onPress}
              style={[
                { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.screen, paddingVertical: spacing.lg },
                i < actions.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
              ]}
            >
              <View style={{
                width: sizes.iconChip, height: sizes.iconChip, borderRadius: radius.md,
                backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
                marginRight: spacing.lg,
              }}>
                <a.Icon size={sizes.icon} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={t.bodyMedium}>{a.label}</Text>
                <Text style={[t.footnote, { marginTop: 2 }]}>{a.sub}</Text>
              </View>
              <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
            </Pressable>
          </Animated.View>
        ))}

        <View style={{ height: 1, backgroundColor: colors.fill, marginTop: spacing.sm, marginBottom: spacing.xxl }} />

        {/* Shortcuts */}
        <Text style={[t.footnote, { marginHorizontal: spacing.screen, marginBottom: spacing.md }]}>Snarveier</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm + 2, marginHorizontal: spacing.screen }}>
          {shortcuts.map((s, i) => (
            <Animated.View key={s.label} entering={FadeInDown.springify().delay(200 + i * 40)} style={{ flex: 1 }}>
              <Pressable
                pressScale={0.95}
                style={{ backgroundColor: colors.fill, borderRadius: radius.lg, alignItems: 'center', paddingVertical: spacing.lg + 2 }}
              >
                <s.Icon size={sizes.iconLg} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                <Text style={[t.footnote, { color: colors.iconMuted, marginTop: spacing.sm - 1 }]}>{s.label}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
