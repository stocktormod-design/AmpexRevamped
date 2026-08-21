import { useEffect, useState } from 'react'
import { View, ScrollView, Alert } from 'react-native'
import { Text, TextInput } from './text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Q } from '@nozbe/watermelondb'
import { router } from 'expo-router'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { X, Minus, Plus, Trash2, ChevronRight, Search, ShoppingCart } from 'lucide-react-native'
import { Pressable } from './pressable'
import { database } from '../lib/db'
import { Order, orderStatusLabel } from '../lib/db/models/order'
import { useCart, takenQty, adjustCartLine, clearCart, assignCartToOrder, type CartLine } from '../lib/cart'
import { colors, spacing, radius, sizes, shadows, type as t } from '../lib/theme'

function CartRow({ line, last }: { line: CartLine; last: boolean }) {
  function confirmRemove() {
    Alert.alert('Fjerne fra uttaket?', `${line.product.name} legges tilbake i lageret.`, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Fjern', style: 'destructive', onPress: () => clearCart([line]) },
    ])
  }
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
      ]}
    >
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={t.body} numberOfLines={1}>{line.product.name}</Text>
        {!!line.product.elnummer && (
          <Text style={[t.footnote, { marginTop: 1 }]}>{`EL ${line.product.elnummer}`}</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Pressable onPress={() => adjustCartLine(line.movement, -1)} pressScale={0.9}
          style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
          <Minus size={16} color={colors.label} strokeWidth={2.4} />
        </Pressable>
        <Text style={[t.bodyMedium, { minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>
          {takenQty(line.movement)}
        </Text>
        <Pressable onPress={() => adjustCartLine(line.movement, 1)} pressScale={0.9}
          style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center' }}>
          <Plus size={16} color={colors.ctaLabel} strokeWidth={2.4} />
        </Pressable>
        <Pressable onPress={confirmRemove} hitSlop={8} pressScale={0.9}
          style={{ marginLeft: spacing.xs, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
          <Trash2 size={16} color={colors.tertiaryLabel} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  )
}

/** Ekspandert materielluttak — overlay over gjeldende fane (ikke egen rute). Trykk backdrop/X lukker. */
export function CartSheet({ lines, onClose }: { lines: CartLine[]; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    const sub = database.get<Order>('orders')
      .query(Q.where('status', Q.notEq('fakturert')), Q.sortBy('scheduled_at', Q.asc))
      .observe().subscribe(setOrders)
    return () => sub.unsubscribe()
  }, [])

  async function assign(orderId: string) {
    await assignCartToOrder(lines, orderId)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onClose()
    router.push(`/(app)/ordre/${orderId}`)
  }

  const q = query.trim().toLowerCase()
  const filteredOrders = q
    ? orders.filter(o => o.title.toLowerCase().includes(q) || (o.customerName ?? '').toLowerCase().includes(q))
    : orders

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
      <Pressable haptic="none" onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} />

      <View
        style={[
          {
            position: 'absolute', left: spacing.sm, right: spacing.sm,
            top: insets.top + spacing.xxl, bottom: sizes.tabBar + insets.bottom + spacing.sm,
            backgroundColor: colors.canvas, borderRadius: radius.hero, overflow: 'hidden',
            borderWidth: 1, borderColor: colors.border,
          },
          shadows.floating,
        ]}
      >
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120 }}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="cartSheetHeaderWash" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.brand} stopOpacity="0.14" />
                <Stop offset="1" stopColor={colors.brand} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#cartSheetHeaderWash)" />
          </Svg>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingTop: spacing.lg, paddingBottom: spacing.md }}>
          {picking ? (
            <Pressable onPress={() => setPicking(false)} hitSlop={8}>
              <Text style={[t.body, { color: colors.secondaryLabel }]}>Tilbake</Text>
            </Pressable>
          ) : lines.length > 0 ? (
            <Pressable onPress={() => clearCart(lines)} hitSlop={8}>
              <Text style={[t.subhead, { color: colors.danger }]}>Tøm</Text>
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <Text style={t.headline}>{picking ? 'Velg ordre' : 'Materielluttak'}</Text>
          <Pressable onPress={onClose} pressScale={0.92}
            style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color={colors.label} strokeWidth={2.2} />
          </Pressable>
        </View>

        {picking ? (
          <>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
              marginHorizontal: spacing.screen, marginBottom: spacing.md,
              backgroundColor: colors.fill, borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 40,
            }}>
              <Search size={16} color={colors.tertiaryLabel} strokeWidth={2} />
              <TextInput
                value={query} onChangeText={setQuery} autoFocus
                placeholder="Søk ordre eller kunde" placeholderTextColor={colors.tertiaryLabel}
                style={[t.body, { flex: 1 }]}
              />
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
              <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
                {filteredOrders.map((o, i) => (
                  <Pressable key={o.id} onPress={() => assign(o.id)}
                    style={[
                      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                      i < filteredOrders.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                    ]}>
                    <View style={{ flex: 1 }}>
                      <Text style={t.body} numberOfLines={1}>{o.title}</Text>
                      <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
                        {[o.customerName, orderStatusLabel[o.status]].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                  </Pressable>
                ))}
                {filteredOrders.length === 0 && (
                  <Text style={[t.footnote, { padding: spacing.lg }]}>Ingen ordre funnet.</Text>
                )}
              </View>
            </ScrollView>
          </>
        ) : lines.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl }}>
            <ShoppingCart size={28} color={colors.tertiaryLabel} strokeWidth={1.6} />
            <Text style={[t.body, { color: colors.secondaryLabel, marginTop: spacing.md, textAlign: 'center' }]}>
              Uttaket er tomt
            </Text>
            <Text style={[t.footnote, { marginTop: spacing.xs, textAlign: 'center' }]}>
              Skann en NFC-tapp eller ta ut fra lager for å starte
            </Text>
            <Pressable
              haptic="medium" onPress={() => { onClose(); router.push('/(app)/lager') }}
              style={{
                marginTop: spacing.xl, height: sizes.ctaHeight, paddingHorizontal: spacing.xxl,
                borderRadius: radius.xl, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={[t.headline, { color: '#fff' }]}>Gå til Lager</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingBottom: spacing.md }}>
              <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
                {lines.map((l, i) => (
                  <CartRow key={l.movement.id} line={l} last={i === lines.length - 1} />
                ))}
              </View>
            </ScrollView>
            <View style={{ padding: spacing.screen, paddingTop: spacing.sm }}>
              <Pressable
                haptic="medium" onPress={() => setPicking(true)}
                style={{ height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={[t.headline, { color: '#fff' }]}>Før på ordre</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  )
}
