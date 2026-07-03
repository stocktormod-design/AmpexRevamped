import { useEffect, useState } from 'react'
import { View, Text, FlatList, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Plus, ChevronRight } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { Chip } from '../../../components/ui'
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
        backgroundColor: colors.bg,
        marginHorizontal: spacing.screen,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md + 2,
        flexDirection: 'row',
        alignItems: 'center',
        borderTopLeftRadius: first ? radius.lg : 0,
        borderTopRightRadius: first ? radius.lg : 0,
        borderBottomLeftRadius: last ? radius.lg : 0,
        borderBottomRightRadius: last ? radius.lg : 0,
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
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
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
              <Pressable
                haptic="medium"
                pressScale={0.92}
                onPress={() => router.push('/(app)/ordre/ny')}
                style={{
                  width: 36, height: 36, borderRadius: radius.pill,
                  backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center',
                  marginBottom: spacing.xs,
                }}
              >
                <Plus size={sizes.icon} color={colors.ctaLabel} strokeWidth={2.2} />
              </Pressable>
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
          <View style={{ backgroundColor: colors.bg, marginHorizontal: spacing.screen }}>
            <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: spacing.lg }} />
          </View>
        )}
        renderItem={({ item, index }) => (
          <OrderRow order={item} first={index === 0} last={index === orders.length - 1} />
        )}
        ListEmptyComponent={
          <View style={{
            backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen,
            alignItems: 'center', paddingVertical: spacing.xxl,
          }}>
            <Text style={t.headline}>Ingen ordre her</Text>
            <Text style={[t.footnote, { marginTop: spacing.xs }]}>Prøv et annet filter, eller opprett en ny.</Text>
          </View>
        }
      />
    </View>
  )
}
