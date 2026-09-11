import { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Plus, Warehouse, FileUp, Search } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { MegAvatar } from '../../../components/meg-avatar'
import { PapirSectionHeader, usePapirFokus } from '../../../components/papir-surface'
import { database } from '../../../lib/db'
import { Location } from '../../../lib/db/models/location'
import { useLocationCounts } from '../../../lib/stock'
import { useVareantall } from '../../../lib/products'
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
  return (
    <Pressable
      onPress={() => router.push(`/(app)/lager/${location.id}`)}
      style={{
        backgroundColor: colors.bg,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      }}
    >
      {/* Raden ledes av sine egne data: navn, regnr og antall — ingen ikonflis,
          ingen chevron (DESIGN.md «Rader ledes av sine egne data»). */}
      <View style={{ flex: 1 }}>
        <Text style={t.bodyMedium} numberOfLines={1}>{location.name}</Text>
        {!!location.regNr && <Text style={[t.footnote, { marginTop: 1 }]}>{location.regNr}</Text>}
      </View>
      <Text style={[t.subhead, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>
        {`${count} ${count === 1 ? 'vare' : 'varer'}`}
      </Text>
    </Pressable>
  )
}

export default function LagerScreen() {
  const insets = useSafeAreaInsets()
  // Kremet klokke og batteri på mørk grunn — settes tilbake når skjermen forlates.
  usePapirFokus()
  const locations = useLocations()
  const counts = useLocationCounts()
  const vareantall = useVareantall()
  const lagre = locations.filter(l => l.type === 'lager')
  const biler = locations.filter(l => l.type === 'bil')

  function Group({ title, items }: { title: string; items: Location[] }) {
    if (items.length === 0) return null
    return (
      <View style={{ marginBottom: spacing.screen }}>
        <PapirSectionHeader>{title}</PapirSectionHeader>
        <View style={{ marginHorizontal: spacing.screen, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.separator, overflow: 'hidden' }}>
          {items.map((l, i) => (
            <View key={l.id}>
              <LocationRow location={l} count={counts[l.id] ?? 0} first={i === 0} last={i === items.length - 1} />
              {i < items.length - 1 && (
                <View style={{ backgroundColor: colors.bg }}>
                  <View style={{ height: 1, backgroundColor: colors.separator, marginLeft: spacing.lg }} />
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
          <Text style={t.display}>Lager</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <MegAvatar />
          {/* Prisfila er inngangen til hele vareregisteret — uten den er lageret
              en liste over ting noen har skrevet inn for hånd. */}
          <Pressable
            haptic="light" pressScale={0.92}
            onPress={() => router.push('/(app)/lager/prisfil')}
            style={{
              width: 36, height: 36, borderRadius: radius.pill,
              alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
            }}
          >
            <FileUp size={18} color={colors.label} strokeWidth={sizes.lucideStroke} />
          </Pressable>
          <Pressable
            haptic="medium" pressScale={0.92}
            onPress={() => router.push('/(app)/lager/ny-lokasjon')}
            style={{
              width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.brandSoft,
              alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
            }}
          >
            <Plus size={sizes.icon} color={colors.brand} strokeWidth={2.2} />
          </Pressable>
          </View>
        </View>

        {locations.length === 0 ? (
          <View style={{
            marginHorizontal: spacing.screen, borderRadius: radius.hero, overflow: 'hidden',
            backgroundColor: colors.bg,
          }}>
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
            {/* Varekartoteket ligger ØVERST, over lokasjonene: «hva er denne varen
            og hva koster den» er et hyppigere spørsmål enn «hva står i bilen». */}
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/lager/varer')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            backgroundColor: colors.bg, borderRadius: radius.lg,
            borderWidth: 1, borderColor: colors.separator,
            marginHorizontal: spacing.screen, marginBottom: spacing.screen,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
          }}
        >
          {/* Ser ut som et søkefelt, fordi det er det du får når du trykker. */}
          <Search size={18} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
          <View style={{ flex: 1 }}>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>
              {vareantall === 0 ? 'Kartoteket er tomt — importer en prisfil' : 'Søk i varer'}
            </Text>
          </View>
          {vareantall > 0 && (
            <Text style={[t.caption, { color: colors.tertiaryLabel, fontVariant: ['tabular-nums'] }]}>{`${vareantall}`}</Text>
          )}
        </Pressable>

        <Group title="Lager" items={lagre} />
            <Group title="Biler" items={biler} />
          </>
        )}
      </ScrollView>
    </View>
  )
}
