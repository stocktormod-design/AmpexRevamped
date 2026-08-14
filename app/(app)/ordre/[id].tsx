import { useEffect, useState } from 'react'
import { View, Text, ScrollView, Linking, Platform, ActionSheetIOS } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import {
  ChevronLeft, Phone, MapPin, FileText, Check, ChevronRight, Plus, Package, Navigation,
  ScanLine, CalendarClock, ClipboardCheck,
} from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { CreamCard, ListCard, SectionHeader, Chip } from '../../../components/ui'
import { MicButton } from '../../../components/mic-button'
import { ScanCard } from '../../../components/scan-card'
import { deleteScanFiles, clearRevisions } from '../../../lib/scan-revisions'
import { AddressMap } from '../../../components/address-map'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Order, orderStatuses, orderStatusLabel, type OrderStatus } from '../../../lib/db/models/order'
import { OrderDocument } from '../../../lib/db/models/order-document'
import { OrderMaterial } from '../../../lib/db/models/order-material'
import { OrderScan, scanKindLabel, type ScanKind } from '../../../lib/db/models/order-scan'
import { AMPEX_TEMPLATES } from '../../../lib/forms/templates'
import { markOrderOpened } from '../../../lib/last-opened'
import { formatDateTime } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
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

/** Materiell-linjer for én ordre — reaktivt */
function useOrderMaterials(orderId: string) {
  const [materials, setMaterials] = useState<OrderMaterial[]>([])
  useEffect(() => {
    const sub = database
      .get<OrderMaterial>('order_materials')
      .query(Q.where('order_id', orderId), Q.sortBy('created_at', Q.asc))
      .observe()
      .subscribe(setMaterials)
    return () => sub.unsubscribe()
  }, [orderId])
  return materials
}

/** LiDAR-skann for én ordre — reaktivt */
function useOrderScans(orderId: string) {
  const [scans, setScans] = useState<OrderScan[]>([])
  useEffect(() => {
    const sub = database
      .get<OrderScan>('order_scans')
      .query(Q.where('order_id', orderId), Q.sortBy('created_at', Q.asc))
      .observe()
      .subscribe(setScans)
    return () => sub.unsubscribe()
  }, [orderId])
  return scans
}

async function addScan(orderId: string, kind: ScanKind, index: number) {
  await database.write(async () => {
    await database.get<OrderScan>('order_scans').create(s => {
      s.orderId = orderId
      s.kind = kind
      s.title = `${scanKindLabel[kind]} ${index}`
    })
  })
  syncQuietly()
}

/** Én adskilt LiDAR-gruppe (planlegging ELLER dokumentasjon). */
function ScanGroup({ orderId, kind, scans, Icon, hint }: {
  orderId: string; kind: ScanKind; scans: OrderScan[]; Icon: typeof ScanLine; hint: string
}) {
  const mine = scans.filter(s => s.kind === kind)
  async function removeScan(s: OrderScan) {
    if (s.scanPath) await deleteScanFiles(s.scanPath)
    await clearRevisions(s.id)
    await database.write(async () => s.markAsDeleted())
    syncQuietly()
  }
  return (
    <View style={{ marginBottom: spacing.screen }}>
      <SectionHeader>{`LiDAR · ${scanKindLabel[kind]}`}</SectionHeader>
      <View style={{ marginHorizontal: spacing.screen, gap: spacing.sm }}>
        {mine.map(s => (
          <ScanCard
            key={s.id}
            title={s.title}
            meta={`LiDAR · ${scanKindLabel[kind]}`}
            scanPath={s.scanPath}
            revisionKey={s.id}
            onOpen={() => router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[kind], title: s.title, ...(s.scanPath ? { viewPath: s.scanPath } : {}) } })}
            onScan={() => router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[kind], title: s.title, viewPath: '' } })}
            onOpenRevision={rev => router.push({ pathname: '/(app)/skann', params: { viewPath: rev.path, title: `${s.title} · ${new Date(rev.ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}` } })}
            onDelete={() => removeScan(s)}
          />
        ))}
        <Pressable
          haptic="light"
          onPress={() => addScan(orderId, kind, mine.length + 1)}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.fill, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}
        >
          <View style={{ width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
            <Plus size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
          </View>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>{`Legg til ${scanKindLabel[kind].toLowerCase()}-skann`}</Text>
        </Pressable>
      </View>
      {mine.length === 0 && (
        <Text style={[t.footnote, { marginHorizontal: spacing.screen + spacing.lg, marginTop: spacing.sm }]}>{hint}</Text>
      )}
    </View>
  )
}

function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')
}

function MaterialRow({ material }: { material: OrderMaterial }) {
  async function remove() {
    await database.write(async () => { await material.markAsDeleted() })
    syncQuietly()
  }
  return (
    <Pressable
      onLongPress={remove}
      haptic="none"
      style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingHorizontal: spacing.md, paddingVertical: spacing.md,
        borderRadius: radius.xl, backgroundColor: colors.fill,
      }}
    >
      <Text style={[t.body, { width: 52, color: colors.brand, fontWeight: '700', fontVariant: ['tabular-nums'] }]}>
        {`${formatQty(material.quantity)} ${material.unit}`}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={t.body} numberOfLines={1}>{material.description}</Text>
        {!!material.elnummer && (
          <Text style={[t.footnote, { marginTop: 1 }]}>{`EL ${material.elnummer}`}</Text>
        )}
      </View>
    </Pressable>
  )
}

function DocumentRow({ name, status, onPress }: { name: string; status: 'fullfort' | 'utkast'; onPress: () => void }) {
  const done = status === 'fullfort'
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingHorizontal: spacing.md, paddingVertical: spacing.md,
        borderRadius: radius.xl, backgroundColor: colors.fill,
      }}
    >
      <View style={{
        width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: done ? colors.slateSoft : colors.bg,
      }}>
        {done
          ? <Check size={14} color={colors.slate} strokeWidth={2.6} />
          : <FileText size={14} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
      </View>
      <Text style={[t.body, { flex: 1 }]} numberOfLines={1}>{name}</Text>
      <Text style={[t.caption, { color: done ? colors.slate : colors.secondaryLabel, fontWeight: '600' }]}>
        {done ? 'Fullført' : 'Utkast'}
      </Text>
      <ChevronRight size={15} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
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
  const materials = useOrderMaterials(id ?? '')
  const scans = useOrderScans(id ?? '')
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

  const startedTemplates = AMPEX_TEMPLATES.filter(tpl => docByTemplate.has(tpl.id))
  const remainingTemplates = AMPEX_TEMPLATES.filter(tpl => !docByTemplate.has(tpl.id))

  // Dokumentasjon viser kun faktisk lagt-til skjema — «Legg til» velger blant de resterende.
  function addDocumentation() {
    if (!order || remainingTemplates.length === 0) return
    if (Platform.OS !== 'ios') {
      router.push({ pathname: '/(app)/ordre/skjema', params: { orderId: order.id, templateId: remainingTemplates[0].id } })
      return
    }
    const options = [...remainingTemplates.map(tpl => tpl.name), 'Avbryt']
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Legg til dokumentasjon', options, cancelButtonIndex: options.length - 1 },
      idx => {
        if (idx < remainingTemplates.length) {
          router.push({ pathname: '/(app)/ordre/skjema', params: { orderId: order.id, templateId: remainingTemplates[idx].id } })
        }
      },
    )
  }

  if (!order) return <View style={{ flex: 1, backgroundColor: colors.bg }} />

  const when = formatDateTime(order.scheduledAt)

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable
              onPress={() => router.back()}
              pressScale={0.92}
              style={{
                width: 36, height: 36, borderRadius: radius.pill,
                backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
            </Pressable>
            <MicButton />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
              backgroundColor: colors.fill, borderRadius: radius.pill,
              paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1,
            }}>
              <View style={{ width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.brand }} />
              <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.brand }]}>
                {orderStatusLabel[order.status] ?? order.status}
              </Text>
            </View>
            {!!order.orderNumber && (
              <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>{`#${order.orderNumber}`}</Text>
            )}
          </View>

          <Text style={[t.title1, { marginTop: spacing.md }]}>{order.title}</Text>
          {!!order.description && (
            <Text style={[t.subhead, { color: colors.secondaryLabel, marginTop: spacing.md }]}>
              {order.description}
            </Text>
          )}
          {!!when && <Text style={[t.footnote, { marginTop: spacing.md }]}>{when}</Text>}
        </View>

        {/* Oppdrag — kontakt + kart + adresse samlet i ett kort */}
        {(order.customerName || order.customerPhone || order.address) && (
          <View style={{ marginBottom: spacing.screen }}>
            <CreamCard>
              {(order.customerName || order.customerPhone) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.md }}>
                  <View style={{
                    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.label,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={[t.headline, { color: colors.brandSoft }]}>{initials(order.customerName ?? order.customerPhone ?? '')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    {!!order.customerName && <Text style={t.headline} numberOfLines={1}>{order.customerName}</Text>}
                    {!!order.customerPhone && (
                      <Text style={[t.subhead, { color: colors.secondaryLabel, marginTop: 1 }]}>{order.customerPhone}</Text>
                    )}
                  </View>
                  {!!order.customerPhone && (
                    <Pressable haptic="medium" onPress={ring} style={{
                      width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brand,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Phone size={19} color="#fff" strokeWidth={2} />
                    </Pressable>
                  )}
                </View>
              )}
              {!!order.address && (
                <>
                  <View style={{ marginHorizontal: spacing.md, borderRadius: radius.lg, overflow: 'hidden' }}>
                    <AddressMap address={order.address} onPress={naviger} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
                    <MapPin size={17} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
                    <Text style={[t.subhead, { flex: 1 }]} numberOfLines={2}>{order.address}</Text>
                    <Pressable haptic="medium" onPress={naviger} style={{
                      flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
                      backgroundColor: colors.label, borderRadius: radius.pill,
                      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                    }}>
                      <Navigation size={14} color="#fff" strokeWidth={2.2} />
                      <Text style={[t.footnote, { color: '#fff', fontWeight: '700' }]}>Kjør</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </CreamCard>
          </View>
        )}

        {/* Materiell — forbruksmotor: mater §36-dok + fakturagrunnlag */}
        <View style={{ marginBottom: spacing.screen }}>
          <ListCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Package size={20} color={colors.label} strokeWidth={sizes.lucideStroke} />
                <Text style={t.headline}>Materiell</Text>
              </View>
              {materials.length > 0 && (
                <View style={{ backgroundColor: colors.brandWash, borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 3 }}>
                  <Text style={[t.caption, { color: colors.brand, fontWeight: '700' }]}>{materials.length}</Text>
                </View>
              )}
            </View>
            <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs }}>
              {materials.map(m => <MaterialRow key={m.id} material={m} />)}
              <Pressable
                haptic="medium"
                onPress={() => router.push({ pathname: '/(app)/ordre/material', params: { orderId: order.id } })}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                  paddingVertical: spacing.md + 1, borderRadius: radius.xl, backgroundColor: colors.brand,
                }}
              >
                <Plus size={18} color="#fff" strokeWidth={2.4} />
                <Text style={[t.subhead, { color: '#fff', fontWeight: '700' }]}>Legg til materiell</Text>
              </Pressable>
            </View>
          </ListCard>
          {materials.length > 0 && (
            <Text style={[t.caption, { marginHorizontal: spacing.screen + spacing.lg, marginTop: spacing.sm }]}>
              Hold inne en linje for å slette.
            </Text>
          )}
        </View>

        {/* Dokumentasjon — viser kun faktisk påbegynt/fullført skjema, ikke alle malene */}
        <View style={{ marginBottom: spacing.screen }}>
          <ListCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <FileText size={20} color={colors.label} strokeWidth={sizes.lucideStroke} />
                <Text style={t.headline}>Dokumentasjon</Text>
              </View>
              <Text style={[t.caption, { color: colors.secondaryLabel, fontWeight: '600' }]}>
                {doneCount > 0 ? `${doneCount} fullført` : 'Ingen fullført'}
              </Text>
            </View>
            <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs }}>
              {startedTemplates.map(tpl => {
                const doc = docByTemplate.get(tpl.id)
                return (
                  <DocumentRow
                    key={tpl.id}
                    name={tpl.name}
                    status={doc?.status === 'fullfort' ? 'fullfort' : 'utkast'}
                    onPress={() => router.push({
                      pathname: '/(app)/ordre/skjema',
                      params: { orderId: order.id, templateId: tpl.id },
                    })}
                  />
                )
              })}
              {remainingTemplates.length > 0 && (
                <Pressable
                  haptic="light"
                  onPress={addDocumentation}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                    paddingVertical: spacing.md, borderRadius: radius.xl,
                    borderWidth: 1.5, borderColor: colors.border,
                  }}
                >
                  <Plus size={18} color={colors.label} strokeWidth={2.4} />
                  <Text style={[t.subhead, { color: colors.label, fontWeight: '700' }]}>Legg til dokumentasjon</Text>
                </Pressable>
              )}
            </View>
          </ListCard>
        </View>

        {/* LiDAR — planlegging og dokumentasjon holdt adskilt */}
        <ScanGroup
          orderId={order.id} kind="planlegging" scans={scans} Icon={CalendarClock}
          hint="Skann før jobben. Grunnlag for planlegging og mengder."
        />
        <ScanGroup
          orderId={order.id} kind="dokumentasjon" scans={scans} Icon={ClipboardCheck}
          hint="Skann as-built. Et ekstra lag dokumentasjon på det utførte."
        />

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
          <ListCard>
            <MetaRow label="Ordrenummer" value={order.orderNumber ? `#${order.orderNumber}` : 'Tildeles ved synk'} />
            <MetaRow label="Opprettet" value={formatDateTime(order.createdAt) ?? '–'} />
            <MetaRow label="Sist endret" value={formatDateTime(order.updatedAt) ?? '–'} last />
          </ListCard>
        </View>
      </ScrollView>
    </View>
  )
}
