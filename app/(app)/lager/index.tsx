import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Plus, Warehouse, Truck, ChevronRight, FileUp } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader, AmbientBackdrop } from '../../../components/ui'
import { database } from '../../../lib/db'
import { Location } from '../../../lib/db/models/location'
import { useLocationCounts } from '../../../lib/stock'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function useLocations() {
  const [locations, setLocations] = useState<Location[]>([])
  useEffect(() => {
    const sub = database.get<Location>('locations').query().observe().subscribe(setLocations)
    return () => sub.unsubscribe()
  }, [])
  return locations
}

function LocationRow({ location, count, first, last }: {
  location: Location; count: number; first: boolean; last: boolean
}) {
  const Icon = location.type === 'lager' ? Warehouse : Truck
  return (
    <Pressable
      onPress={() => router.push(`/(app)/lager/${location.id}`)}
      style={{
        backgroundColor: colors.bg, marginHorizontal: spacing.screen,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
        flexDirection: 'row', alignItems: 'center',
        borderTopLeftRadius: first ? radius.lg : 0, borderTopRightRadius: first ? radius.lg : 0,
        borderBottomLeftRadius: last ? radius.lg : 0, borderBottomRightRadius: last ? radius.lg : 0,
      }}
    >
      <View style={{
        width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm,
        backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
      }}>
        <Icon size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={t.bodyMedium} numberOfLines={1}>{location.name}</Text>
        <Text style={[t.footnote, { marginTop: 1 }]}>
          {location.regNr
            ? `${location.regNr} · ${count} ${count === 1 ? 'vare' : 'varer'}`
            : `${count} ${count === 1 ? 'vare' : 'varer'}`}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

export default function LagerScreen() {
  const insets = useSafeAreaInsets()
  const locations = useLocations()
  const counts = useLocationCounts()
  const lagre = locations.filter(l => l.type === 'lager')
  const biler = locations.filter(l => l.type === 'bil')

  function Group({ title, items }: { title: string; items: Location[] }) {
    if (items.length === 0) return null
    return (
      <View style={{ marginBottom: spacing.screen }}>
        <SectionHeader>{title}</SectionHeader>
        <View style={{ overflow: 'hidden' }}>
          {items.map((l, i) => (
            <View key={l.id}>
              <LocationRow location={l} count={counts[l.id] ?? 0} first={i === 0} last={i === items.length - 1} />
              {i < items.length - 1 && (
                <View style={{ backgroundColor: colors.bg, marginHorizontal: spacing.screen }}>
                  <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: spacing.lg }} />
                </View>
              )}
            </View>
          ))}
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
          paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
        }}>
          <Text style={t.largeTitle}>Lager</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {/* Prisfila er inngangen til hele vareregisteret — uten den er lageret
              en liste over ting noen har skrevet inn for hånd. */}
          <Pressable
            haptic="light" pressScale={0.92}
            onPress={() => router.push('/(app)/lager/prisfil')}
            style={{
              width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.fill,
              alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
            }}
          >
            <FileUp size={sizes.icon - 2} color={colors.secondaryLabel} strokeWidth={2.2} />
          </Pressable>
          <Pressable
            haptic="medium" pressScale={0.92}
            onPress={() => router.push('/(app)/lager/ny-lokasjon')}
            style={{
              width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.cta,
              alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
            }}
          >
            <Plus size={sizes.icon} color={colors.ctaLabel} strokeWidth={2.2} />
          </Pressable>
          </View>
        </View>

        {locations.length === 0 ? (
          <View style={{
            marginHorizontal: spacing.screen, borderRadius: radius.hero, overflow: 'hidden',
            backgroundColor: colors.bg,
          }}>
            <AmbientBackdrop height={280} />
            <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl }}>
              <View style={{
                width: sizes.iconChip + 8, height: sizes.iconChip + 8, borderRadius: radius.pill,
                backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center',
              }}>
                <Warehouse size={sizes.iconLg} color={colors.brand} strokeWidth={sizes.lucideStroke} />
              </View>
              <Text style={[t.headline, { marginTop: spacing.md }]}>Ingen lokasjoner</Text>
              <Text style={[t.footnote, { marginTop: spacing.xs, textAlign: 'center' }]}>
                Legg til sentrallager og biler for å begynne å spore beholdning.
              </Text>
              <Pressable
                haptic="medium"
                pressScale={0.97}
                onPress={() => router.push('/(app)/lager/ny-lokasjon')}
                style={{
                  marginTop: spacing.lg, height: sizes.ctaHeight - 6, paddingHorizontal: spacing.xl,
                  borderRadius: radius.xl, backgroundColor: colors.cta,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                }}
              >
                <Plus size={sizes.icon - 2} color={colors.ctaLabel} strokeWidth={2.2} />
                <Text style={[t.headline, { color: colors.ctaLabel }]}>Legg til lokasjon</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Group title="Lager" items={lagre} />
            <Group title="Biler" items={biler} />
          </>
        )}
      </ScrollView>
    </View>
  )
}
