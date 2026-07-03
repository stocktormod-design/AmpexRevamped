import { useEffect, useState } from 'react'
import { View, Text, ScrollView, Linking, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Phone, MapPin, FileText, CircleCheck, ChevronRight } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { GlassCard, SectionHeader, Chip } from '../../../components/ui'
import { AddressMap } from '../../../components/address-map'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Order, orderStatuses, orderStatusLabel, type OrderStatus } from '../../../lib/db/models/order'
import { OrderDocument } from '../../../lib/db/models/order-document'
import { AMPEX_TEMPLATES } from '../../../lib/forms/templates'
import { markOrderOpened } from '../../../lib/last-opened'
import { formatDateTime } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function ContactRow({ Icon, label, action, last }: {
  Icon: typeof Phone; label: string; action?: () => void; last?: boolean
}) {
  return (
    <Pressable
      onPress={action}
      haptic={action ? 'light' : 'none'}
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
      ]}
    >
      <View style={{
        width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm,
        backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
      }}>
        <Icon size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
      </View>
      <Text style={[t.body, { flex: 1 }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  )
}

/** Dokumentstatus per mal for én ordre — reaktivt (rad finnes først ved første endring) */
function useOrderDocuments(orderId: string) {
  const [docs, setDocs] = useState<OrderDocument[]>([])
  useEffect(() => {
    const sub = database
      .get<OrderDocument>('order_documents')
      .query(Q.where('order_id', orderId))
      .observe()
      .subscribe(setDocs)
    return () => sub.unsubscribe()
  }, [orderId])
  return docs
}

function DocumentRow({ name, status, last, onPress }: {
  name: string; status: 'fullfort' | 'utkast' | 'ingen'; last: boolean; onPress: () => void
}) {
  const statusLabel = status === 'fullfort' ? 'Fullført' : status === 'utkast' ? 'Utkast' : 'Ikke påbegynt'
  return (
    <Pressable
      onPress={onPress}
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
      ]}
    >
      <View style={{
        width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm,
        backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
      }}>
        {status === 'fullfort'
          ? <CircleCheck size={sizes.icon - 2} color={colors.label} strokeWidth={sizes.lucideStroke} />
          : <FileText size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
      </View>
      <Text style={[t.body, { flex: 1 }]} numberOfLines={1}>{name}</Text>
      <Text style={[t.caption, {
        color: status === 'fullfort' ? colors.label : status === 'utkast' ? colors.secondaryLabel : colors.tertiaryLabel,
        marginRight: spacing.sm,
      }]}>
        {statusLabel}
      </Text>
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

function MetaRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[
      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
      !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
    ]}>
      <Text style={t.body}>{label}</Text>
      <Text style={[t.body, { color: colors.secondaryLabel }]}>{value}</Text>
    </View>
  )
}

export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const docs = useOrderDocuments(id ?? '')
  const docByTemplate = new Map(docs.map(d => [d.templateId, d]))
  const doneCount = AMPEX_TEMPLATES.filter(tpl => docByTemplate.get(tpl.id)?.status === 'fullfort').length

  useEffect(() => {
    if (!id) return
    markOrderOpened(id)
    const sub = database.get<Order>('orders').findAndObserve(id).subscribe({
      next: setOrder,
      error: () => router.back(), // slettet eller ukjent id
    })
    return () => sub.unsubscribe()
  }, [id])

  async function setStatus(status: OrderStatus) {
    if (!order || order.status === status) return
    await database.write(async () => {
      await order.update(o => { o.status = status })
    })
    syncQuietly()
  }

  function ring() {
    if (order?.customerPhone) Linking.openURL(`tel:${order.customerPhone.replace(/\s/g, '')}`)
  }

  function naviger() {
    if (!order?.address) return
    const q = encodeURIComponent(order.address)
    // dirflg=d → Kart åpner rett i kjørerute
    Linking.openURL(Platform.OS === 'android' ? `geo:0,0?q=${q}` : `https://maps.apple.com/?daddr=${q}&dirflg=d`)
  }

  if (!order) return <View style={{ flex: 1, backgroundColor: colors.groupedBg }} />

  const meta = [
    order.orderNumber ? `#${order.orderNumber}` : null,
    orderStatusLabel[order.status] ?? order.status,
    formatDateTime(order.scheduledAt),
  ].filter(Boolean).join(' · ')

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable
            onPress={() => router.back()}
            pressScale={0.92}
            style={{
              width: 36, height: 36, borderRadius: radius.pill,
              backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={{ marginBottom: spacing.screen }}>
          <GlassCard>
            <Text style={[t.caption, { textTransform: 'uppercase' }]}>{meta}</Text>
            <Text style={[t.title1, { marginTop: spacing.sm }]}>{order.title}</Text>
            {!!order.description && (
              <Text style={[t.subhead, { color: colors.secondaryLabel, marginTop: spacing.md }]}>
                {order.description}
              </Text>
            )}
          </GlassCard>
        </View>

        {(order.customerName || order.customerPhone) && (
          <View style={{ marginBottom: spacing.screen }}>
            <SectionHeader>Kunde</SectionHeader>
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
              <ContactRow
                Icon={Phone}
                label={[order.customerName, order.customerPhone].filter(Boolean).join(' · ')}
                action={order.customerPhone ? ring : undefined}
                last
              />
            </View>
          </View>
        )}

        {/* Adresse — kartpreview (iOS) + rad; alt åpner kjørerute i Kart */}
        {!!order.address && (
          <View style={{ marginBottom: spacing.screen }}>
            <SectionHeader>Adresse</SectionHeader>
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
              <AddressMap address={order.address} onPress={naviger} />
              <ContactRow Icon={MapPin} label={order.address} action={naviger} last />
            </View>
          </View>
        )}

        {/* Dokumentasjon — de 5 sikre; rader er «foreslått» til de røres */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>{`Dokumentasjon · ${doneCount} av ${AMPEX_TEMPLATES.length} fullført`}</SectionHeader>
          <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
            {AMPEX_TEMPLATES.map((tpl, i) => {
              const doc = docByTemplate.get(tpl.id)
              return (
                <DocumentRow
                  key={tpl.id}
                  name={tpl.name}
                  status={doc?.status === 'fullfort' ? 'fullfort' : doc ? 'utkast' : 'ingen'}
                  last={i === AMPEX_TEMPLATES.length - 1}
                  onPress={() => router.push({
                    pathname: '/(app)/ordre/skjema',
                    params: { orderId: order.id, templateId: tpl.id },
                  })}
                />
              )
            })}
          </View>
        </View>

        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Status</SectionHeader>
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
            marginHorizontal: spacing.screen,
          }}>
            {orderStatuses.map(s => (
              <Chip
                key={s}
                label={orderStatusLabel[s]}
                selected={order.status === s}
                onPress={() => setStatus(s)}
              />
            ))}
          </View>
        </View>

        {/* Detaljer — metadata nederst, minst viktig */}
        <View>
          <SectionHeader>Detaljer</SectionHeader>
          <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
            <MetaRow label="Ordrenummer" value={order.orderNumber ? `#${order.orderNumber}` : 'Tildeles ved synk'} />
            <MetaRow label="Opprettet" value={formatDateTime(order.createdAt) ?? '–'} />
            <MetaRow label="Sist endret" value={formatDateTime(order.updatedAt) ?? '–'} last />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
