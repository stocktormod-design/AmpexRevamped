import { useEffect, useState } from 'react'
import { View, Text, FlatList, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Plus, ChevronRight, Inbox } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { Chip, GlassCard, AmbientBackdrop } from '../../../components/ui'
import { MicButton } from '../../../components/mic-button'
import { database } from '../../../lib/db'
import { Order, orderStatuses, orderStatusLabel, type OrderStatus } from '../../../lib/db/models/order'
import { formatTime } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

type Filter = 'apne' | 'alle' | OrderStatus

const filters: { key: Filter; label: string }[] = [
  { key: 'apne', label: 'Åpne' },
  { key: 'alle', label: 'Alle' },
  ...orderStatuses.map(s => ({ key: s as Filter, label: orderStatusLabel[s] })),
]

function useOrders(filter: Filter) {
  const [orders, setOrders] = useState<Order[]>([])
  useEffect(() => {
    const clauses =
      filter === 'alle' ? [] :
      filter === 'apne' ? [Q.where('status', Q.notEq('fakturert'))] :
      [Q.where('status', filter)]
    const sub = database
      .get<Order>('orders')
      .query(...clauses, Q.sortBy('scheduled_at', Q.asc))
      .observe()
      .subscribe(setOrders)
    return () => sub.unsubscribe()
  }, [filter])
  return orders
}

function OrderRow({ order, first, last }: { order: Order; first: boolean; last: boolean }) {
  return (
    <Pressable
      onPress={() => router.push(`/(app)/ordre/${order.id}`)}
      style={{
        backgroundColor: colors.cardGlassStrong,
        marginHorizontal: spacing.screen,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md + 2,
        flexDirection: 'row',
        alignItems: 'center',
        borderTopLeftRadius: first ? radius.hero : 0,
        borderTopRightRadius: first ? radius.hero : 0,
        borderBottomLeftRadius: last ? radius.hero : 0,
        borderBottomRightRadius: last ? radius.hero : 0,
      }}
    >
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={t.bodyMedium} numberOfLines={1}>{order.title}</Text>
        <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={1}>
          {[order.customerName, order.address].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', marginRight: spacing.sm }}>
        <Text style={t.caption}>{orderStatusLabel[order.status] ?? order.status}</Text>
        {!!order.scheduledAt && (
          <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 2 }]}>
            {formatTime(order.scheduledAt)}
          </Text>
        )}
      </View>
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

export default function OrdreScreen() {
  const insets = useSafeAreaInsets()
  const [filter, setFilter] = useState<Filter>('apne')
  const orders = useOrders(filter)

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AmbientBackdrop height={340} />
      <FlatList
        data={orders}
        keyExtractor={o => o.id}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xl,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <View style={{
              flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
              paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
            }}>
              <Text style={t.largeTitle}>Ordre</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
                <MicButton />
                <Pressable
                  haptic="medium"
                  pressScale={0.92}
                  onPress={() => router.push('/(app)/ordre/ny')}
                  style={{
                    width: 36, height: 36, borderRadius: radius.pill,
                    backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Plus size={sizes.icon} color={colors.brand} strokeWidth={2.2} />
                </Pressable>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm }}
              style={{ marginBottom: spacing.lg }}
            >
              {filters.map(f => (
                <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </ScrollView>
          </>
        }
        ItemSeparatorComponent={() => (
          <View style={{ backgroundColor: colors.cardGlassStrong, marginHorizontal: spacing.screen }}>
            <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: spacing.lg }} />
          </View>
        )}
        renderItem={({ item, index }) => (
          <OrderRow order={item} first={index === 0} last={index === orders.length - 1} />
        )}
        ListEmptyComponent={
          <GlassCard>
            <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
              <View style={{
                width: sizes.iconChip + 8, height: sizes.iconChip + 8, borderRadius: radius.pill,
                backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
              }}>
                <Inbox size={sizes.iconLg} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
              </View>
              <Text style={[t.headline, { marginTop: spacing.md }]}>Ingen ordre her</Text>
              <Text style={[t.footnote, { marginTop: spacing.xs }]}>Prøv et annet filter, eller opprett en ny.</Text>
            </View>
          </GlassCard>
        }
      />
    </View>
  )
}
