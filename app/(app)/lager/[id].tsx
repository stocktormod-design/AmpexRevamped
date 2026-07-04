import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { ChevronLeft, Plus, ShoppingCart } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader } from '../../../components/ui'
import { database } from '../../../lib/db'
import { Location } from '../../../lib/db/models/location'
import { useLocationStock, formatQty } from '../../../lib/stock'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

export default function LocationDetailScreen() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [location, setLocation] = useState<Location | null>(null)
  const stock = useLocationStock(id ?? '')

  useEffect(() => {
    if (!id) return
    const sub = database.get<Location>('locations').findAndObserve(id).subscribe({
      next: setLocation,
      error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [id])

  if (!location) return <View style={{ flex: 1, backgroundColor: colors.groupedBg }} />

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable
            onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.title1, { marginTop: spacing.lg }]}>{location.name}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {location.type === 'lager' ? 'Sentrallager' : 'Bil'}
          </Text>

          {location.type === 'lager' && (
            <Pressable
              haptic="medium"
              onPress={() => router.push({ pathname: '/(app)/lager/uttak', params: { locationId: location.id } })}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.cta, marginTop: spacing.lg,
              }}
            >
              <ShoppingCart size={sizes.icon} color={colors.ctaLabel} strokeWidth={sizes.lucideStroke} />
              <Text style={[t.headline, { color: colors.ctaLabel }]}>Ta ut (handletur)</Text>
            </Pressable>
          )}
        </View>

        <SectionHeader>{stock.length > 0 ? `Beholdning · ${stock.length}` : 'Beholdning'}</SectionHeader>
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          {stock.map((line, i) => (
            <View
              key={line.product.id}
              style={[
                { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                i < stock.length && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={t.body} numberOfLines={1}>{line.product.name}</Text>
                {!!line.product.elnummer && (
                  <Text style={[t.footnote, { marginTop: 1 }]}>{`EL ${line.product.elnummer}`}</Text>
                )}
              </View>
              <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>
                {`${formatQty(line.qty)} ${line.product.unit}`}
              </Text>
            </View>
          ))}
          <Pressable
            onPress={() => router.push({ pathname: '/(app)/lager/bevegelse', params: { locationId: location.id } })}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}
          >
            <View style={{
              width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm,
              backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
            }}>
              <Plus size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
            </View>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>Legg til / juster</Text>
          </Pressable>
        </View>

        {stock.length === 0 && (
          <Text style={[t.caption, { marginHorizontal: spacing.screen + spacing.lg, marginTop: spacing.sm }]}>
            Ingen beholdning ennå. Legg til varer, eller la bestillinger og forbruk fylle den.
          </Text>
        )}
      </ScrollView>
    </View>
  )
}
