import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StatusBar } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import {
  CirclePlus, FolderOpen, Package, Clock,
  ScanBarcode, TriangleAlert, ShieldCheck, ChevronRight,
  type LucideIcon,
} from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { database } from '../../lib/db'
import { Order, orderStatusLabel, type OrderStatus } from '../../lib/db/models/order'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

const statusColor: Record<OrderStatus, string> = {
  mottatt: colors.secondaryLabel,
  planlagt: colors.accent,
  pagaar: colors.success,
  fakturaklar: colors.warning,
  fakturert: colors.tertiaryLabel,
}

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

function useOpenOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  useEffect(() => {
    const sub = database
      .get<Order>('orders')
      .query(Q.where('status', Q.notEq('fakturert')), Q.sortBy('scheduled_at', Q.asc))
      .observe()
      .subscribe(setOrders)
    return () => sub.unsubscribe()
  }, [])
  return orders
}

function OrderRow({ order, last }: { order: Order; last: boolean }) {
  return (
    <Pressable
      onPress={() => router.push('/(app)/ordre')}
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md + 2 },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
      ]}
    >
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={t.bodyMedium} numberOfLines={1}>
          {order.title}
        </Text>
        <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={1}>
          {[order.customerName, order.address].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={{
        paddingHorizontal: spacing.sm + 2, paddingVertical: 3,
        borderRadius: radius.pill, backgroundColor: colors.fill,
      }}>
        <Text style={[t.caption, { color: statusColor[order.status] ?? colors.secondaryLabel }]}>
          {orderStatusLabel[order.status] ?? order.status}
        </Text>
      </View>
    </Pressable>
  )
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const orders = useOpenOrders()
  const today = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.xl }}>
          <Text style={[t.caption, { marginBottom: spacing.xs, textTransform: 'capitalize' }]}>{today}</Text>
          <Text style={t.largeTitle}>I dag</Text>
        </View>

        {/* Åpne ordre — lokal SQLite, alltid umiddelbar (offline-først) */}
        {orders.length > 0 && (
          <Animated.View entering={FadeInDown.springify()} style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.xl }}>
            <Text style={[t.footnote, { marginBottom: spacing.xs }]}>
              {orders.length} åpne ordre
            </Text>
            {orders.slice(0, 4).map((o, i, arr) => (
              <OrderRow key={o.id} order={o} last={i === arr.length - 1} />
            ))}
          </Animated.View>
        )}

        {/* Handlinger */}
        <Text style={[t.footnote, { marginHorizontal: spacing.screen, marginBottom: spacing.xs }]}>Handlinger</Text>
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

        {/* Snarveier */}
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
