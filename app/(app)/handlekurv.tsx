import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { X, Minus, Plus, ChevronRight } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { SectionHeader } from '../../components/ui'
import { database } from '../../lib/db'
import { Order, orderStatusLabel } from '../../lib/db/models/order'
import { useCart, takenQty, adjustCartLine, clearCart, assignCartToOrder, type CartLine } from '../../lib/cart'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

function CartRow({ line, last }: { line: CartLine; last: boolean }) {
  return (
    <View style={[
      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
      !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
    ]}>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={t.body} numberOfLines={1}>{line.product.name}</Text>
        {!!line.product.elnummer && (
          <Text style={[t.footnote, { marginTop: 1 }]}>{`EL ${line.product.elnummer}`}</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Pressable
          onPress={() => adjustCartLine(line.movement, -1)} pressScale={0.9}
          style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}
        >
          <Minus size={16} color={colors.label} strokeWidth={2.4} />
        </Pressable>
        <Text style={[t.bodyMedium, { minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>
          {takenQty(line.movement)}
        </Text>
        <Pressable
          onPress={() => adjustCartLine(line.movement, 1)} pressScale={0.9}
          style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center' }}
        >
          <Plus size={16} color={colors.ctaLabel} strokeWidth={2.4} />
        </Pressable>
      </View>
    </View>
  )
}

export default function HandlekurvScreen() {
  const insets = useSafeAreaInsets()
  const lines = useCart()
  const [picking, setPicking] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    const sub = database.get<Order>('orders')
      .query(Q.where('status', Q.notEq('fakturert')), Q.sortBy('scheduled_at', Q.asc))
      .observe().subscribe(setOrders)
    return () => sub.unsubscribe()
  }, [])

  // Tom kurv → lukk automatisk (baren forsvinner uansett)
  useEffect(() => { if (lines.length === 0) router.back() }, [lines.length])

  async function assign(orderId: string) {
    await assignCartToOrder(lines, orderId)
    router.back()
    router.push(`/(app)/ordre/${orderId}`)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.screen, paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md,
      }}>
        <Pressable onPress={() => router.back()} pressScale={0.92}
          style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={sizes.icon} color={colors.label} strokeWidth={2.2} />
        </Pressable>
        <Text style={t.headline}>Handletur</Text>
        <Pressable onPress={() => clearCart(lines)} hitSlop={8}>
          <Text style={[t.subhead, { color: colors.danger }]}>Tøm</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden', marginBottom: spacing.screen }}>
          {lines.map((l, i) => (
            <CartRow key={l.movement.id} line={l} last={i === lines.length - 1} />
          ))}
        </View>

        {picking ? (
          <View>
            <SectionHeader>Velg ordre</SectionHeader>
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
              {orders.map((o, i) => (
                <Pressable
                  key={o.id} onPress={() => assign(o.id)}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                    i < orders.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={t.body} numberOfLines={1}>{o.title}</Text>
                    <Text style={[t.footnote, { marginTop: 1 }]}>{orderStatusLabel[o.status] ?? o.status}</Text>
                  </View>
                  <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                </Pressable>
              ))}
              {orders.length === 0 && (
                <Text style={[t.footnote, { padding: spacing.lg }]}>Ingen åpne ordre å plassere på.</Text>
              )}
            </View>
          </View>
        ) : (
          <Pressable
            haptic="medium" onPress={() => setPicking(true)}
            style={{
              height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
              alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.screen,
            }}
          >
            <Text style={[t.headline, { color: colors.ctaLabel }]}>Plasser på ordre</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  )
}
