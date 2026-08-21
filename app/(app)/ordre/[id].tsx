import { useEffect, useState } from 'react'
import { View, Text, ScrollView, Linking, Platform, ActionSheetIOS, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import {
  ChevronLeft, Phone, MapPin, FileText, Check, ChevronRight, Plus, Package, Navigation, Trash2,
  Receipt, UserPlus, Clock, Users, FilePlus2,
  PenLine,
} from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { AvtaltPrisKort } from '../../../components/avtalt-pris-kort'
import { useSignaturer } from '../../../lib/signatures'
import { useGodkjenninger, useGrunnlag } from '../../../lib/approvals'
import { GodkjenningKort } from '../../../components/godkjenning-kort'
import { ArkivKort } from '../../../components/arkiv-kort'
import { CreamCard, ListCard, SectionHeader, Chip } from '../../../components/ui'
import { AmpexMarkButton } from '../../../components/ampex-mark-button'
import { ScanCard } from '../../../components/scan-card'
import { deleteScanFiles, clearRevisions } from '../../../lib/scan-revisions'
import { AddressMap } from '../../../components/address-map'
import { database } from '../../../lib/db'
import { slettMateriell, uttakForMateriell } from '../../../lib/cart'
import { syncQuietly } from '../../../lib/db/sync'
import { Order, orderStatuses, orderStatusLabel, type OrderStatus } from '../../../lib/db/models/order'
import { OrderDocument } from '../../../lib/db/models/order-document'
import { OrderMaterial } from '../../../lib/db/models/order-material'
import { OrderScan, scanKindLabel, type ScanKind } from '../../../lib/db/models/order-scan'
import { AMPEX_TEMPLATES } from '../../../lib/forms/templates'
import { markOrderOpened } from '../../../lib/last-opened'
import { formatDateTime } from '../../../lib/format'
import { TimeEntry } from '../../../lib/db/models/time-entry'
import { OrderMember } from '../../../lib/db/models/order-member'
import { OrderExtra } from '../../../lib/db/models/order-extra'
import { useFakturagrunnlag } from '../../../lib/order-billing'
import { formatKr } from '../../../lib/invoicing'
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

/** Sum timer på ordren — reaktivt. Mater både denne raden og fakturagrunnlaget. */
function useOrderTimer(orderId: string) {
  const [sum, setSum] = useState(0)
  useEffect(() => {
    if (!orderId) return
    const sub = database
      .get<TimeEntry>('time_entries')
      .query(Q.where('order_id', orderId))
      .observeWithColumns(['hours'])
      .subscribe(rader => setSum(rader.reduce((a, e) => a + e.hours, 0)))
    return () => sub.unsubscribe()
  }, [orderId])
  return sum
}

/** Tilleggsarbeid — reaktivt. Ventende tillegg er penger som ikke kan faktureres. */
function useOrderExtras(orderId: string) {
  const [rader, setRader] = useState<{ ventende: number; total: number }>({ ventende: 0, total: 0 })
  useEffect(() => {
    if (!orderId) return
    const sub = database
      .get<OrderExtra>('order_extras')
      .query(Q.where('order_id', orderId))
      .observeWithColumns(['status'])
      .subscribe(x => setRader({
        ventende: x.filter(e => e.status === 'foreslatt').length,
        total: x.length,
      }))
    return () => sub.unsubscribe()
  }, [orderId])
  return rader
}

/** Antall deltakere — reaktivt */
function useOrderMemberCount(orderId: string) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!orderId) return
    const sub = database
      .get<OrderMember>('order_members')
      .query(Q.where('order_id', orderId))
      .observe()
      .subscribe(rader => setN(rader.length))
    return () => sub.unsubscribe()
  }, [orderId])
  return n
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

const scanKinds: ScanKind[] = ['planlegging', 'dokumentasjon']

const scanHints: Record<ScanKind, string> = {
  planlegging: 'Skann før jobben. Grunnlag for planlegging og mengder.',
  dokumentasjon: 'Skann as-built. Et ekstra lag dokumentasjon på det utførte.',
}

/**
 * LiDAR — ÉN seksjon med segmentvalg, ikke to parallelle.
 * To fulle grupper (hver med egen overskrift, legg-til-knapp og hint) sto alltid
 * synlige, også på serviceordrer der ingen av dem brukes — det var den største
 * enkeltposten av tom skjerm på siden. Antallet står på det uvalgte segmentet, så
 * innhold på den andre typen aldri blir usynlig.
 */
function ScanSection({ orderId, scans }: { orderId: string; scans: OrderScan[] }) {
  const [kind, setKind] = useState<ScanKind>('planlegging')
  const mine = scans.filter(s => s.kind === kind)
  async function removeScan(s: OrderScan) {
    if (s.scanPath) await deleteScanFiles(s.scanPath)
    await clearRevisions(s.id)
    await database.write(async () => s.markAsDeleted())
    syncQuietly()
  }
  return (
    <View style={{ marginBottom: spacing.screen }}>
      <SectionHeader>LiDAR</SectionHeader>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.screen, marginBottom: spacing.sm + 2 }}>
        {scanKinds.map(k => {
          const n = scans.filter(s => s.kind === k).length
          return (
            <Chip
              key={k}
              label={n > 0 ? `${scanKindLabel[k]} · ${n}` : scanKindLabel[k]}
              selected={kind === k}
              onPress={() => setKind(k)}
            />
          )
        })}
      </View>
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
        <Text style={[t.footnote, { marginHorizontal: spacing.screen + spacing.lg, marginTop: spacing.sm }]}>
          {scanHints[kind]}
        </Text>
      )}
    </View>
  )
}

function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')
}

/**
 * Sveip til venstre avdekker Slett — iOS-standard, trenger ingen bruksanvisning
 * (den gamle «hold inne»-hinten under lista er derfor borte). Sveipet avdekker
 * bare knappen; slettingen krever et trykk. To bevisste ledd, fordi hansker og
 * bevegelse i felt gir utilsiktede sveip — og materiell mater fakturagrunnlaget.
 * Langtrykk beholdt som fallback for den som ikke får sveipet til å ta.
 */
/**
 * Én rad i et kort: ikon, tittel, valgfri underlinje, verdi, pil.
 *
 * Fantes som fire nesten like Pressable-blokker på denne skjermen alene. Det
 * gjorde det tungvint å FLYTTE en rad — og rekkefølgen er nettopp det som var
 * feil her.
 */
function Rad({ ikon, tittel, under, underVarsel, verdi, sterkVerdi, onPress, forst, sist }: {
  ikon: React.ReactNode
  tittel: string
  under?: string
  underVarsel?: boolean
  verdi: string
  sterkVerdi?: boolean
  onPress: () => void
  forst?: boolean
  sist?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
        ...(forst ? {} : { borderTopWidth: 0.5, borderTopColor: colors.separator }),
      }}
    >
      {ikon}
      <View style={{ flex: 1 }}>
        <Text style={t.headline}>{tittel}</Text>
        {!!under && (
          <Text style={[t.footnote, { marginTop: 1 }, underVarsel && { color: colors.warning }]}>{under}</Text>
        )}
      </View>
      <Text style={[t.bodyMedium, { color: sterkVerdi ? colors.label : colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>
        {verdi}
      </Text>
      <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

function MaterialRow({ material }: { material: OrderMaterial }) {
  /**
   * Kom linja fra et lageruttak, finnes den samme varen som TO rader: uttaket
   * (bilen er tommere) og materiallinja (fakturaen). Sletter vi bare den siste,
   * blir beholdningen stående for lav for alltid, uten spor.
   *
   * Bare mennesket vet hvilket av de to utfallene som gjelder, så vi gjetter
   * ikke — vi spør, med ord som beskriver virkeligheten og ikke datamodellen.
   */
  async function remove() {
    const uttak = await uttakForMateriell(material)
    if (uttak.length === 0) {
      await slettMateriell(material, 'beholdt')
      return
    }
    Alert.alert(
      'Fjern materiellet',
      'Varen ble tatt ut av lageret. Hva skjedde med den?',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Lagt tilbake på lager', onPress: () => { void slettMateriell(material, 'tilbake') } },
        { text: 'Fortsatt ute — bare ikke her', onPress: () => { void slettMateriell(material, 'beholdt') } },
      ],
    )
  }
  return (
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={36}
      overshootRight={false}
      containerStyle={{ borderRadius: radius.xl, overflow: 'hidden' }}
      renderRightActions={() => (
        <Pressable
          haptic="medium"
          onPress={remove}
          style={{
            width: 84, backgroundColor: colors.danger,
            alignItems: 'center', justifyContent: 'center', gap: 2,
          }}
        >
          <Trash2 size={18} color="#fff" strokeWidth={2.2} />
          <Text style={[t.caption, { color: '#fff', fontWeight: '700' }]}>Slett</Text>
        </Pressable>
      )}
    >
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
    </ReanimatedSwipeable>
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
  const [statusOpen, setStatusOpen] = useState(false)
  const docs = useOrderDocuments(id ?? '')
  const materials = useOrderMaterials(id ?? '')
  const scans = useOrderScans(id ?? '')
  const docByTemplate = new Map(docs.map(d => [d.templateId, d]))
  const doneCount = AMPEX_TEMPLATES.filter(tpl => docByTemplate.get(tpl.id)?.status === 'fullfort').length
  const grunnlag = useFakturagrunnlag(id ?? '')
  const timer = useOrderTimer(id ?? '')
  const antallMedlemmer = useOrderMemberCount(id ?? '')
  const tillegg = useOrderExtras(id ?? '')
  const signaturer = useSignaturer(id ?? '')
  const godkjenninger = useGodkjenninger(id)
  const godkjenningsgrunnlag = useGrunnlag(id, grunnlag?.bruttoOre ?? 0)
  const allDocsDone = doneCount === AMPEX_TEMPLATES.length

  useEffect(() => {
    if (!id) return
    markOrderOpened(id)
    const sub = database.get<Order>('orders').findAndObserve(id).subscribe({
      next: setOrder,
      error: () => router.back(), // slettet eller ukjent id
    })
    return () => sub.unsubscribe()
  }, [id])

  /**
   * «Fakturert» kan ALDRI settes herfra.
   *
   * Å skrive status direkte hopper over markerFakturert() — som krever faglig
   * godkjenning, stempler `invoiced_at` på linjene og låser dem mot ny
   * fakturering. Uten det kan samme arbeid faktureres om igjen.
   *
   * Og verre: serveren har en trigger (`krev_faglig_godkjenning`) som avviser
   * status 'fakturert' uten godkjenning. Siden watermelon_push kjører i én
   * transaksjon, ville ett slikt trykk blokkert HELE synken — stille, akkurat
   * som base62-id-ene gjorde. Fakturering skjer på fakturaskjermen, punktum.
   */
  async function setStatus(status: OrderStatus) {
    if (!order || order.status === status) return
    if (status === 'fakturert') {
      router.push({ pathname: '/(app)/ordre/faktura', params: { id } })
      return
    }
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

  if (!order) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />

  const when = formatDateTime(order.scheduledAt)
  // Neste steg i den lineære flyten — null når ordren står på siste status.
  const statusIdx = orderStatuses.indexOf(order.status)
  const nextStatus = statusIdx >= 0 && statusIdx < orderStatuses.length - 1
    ? orderStatuses[statusIdx + 1]
    : null

  /**
   * Den ene handlingen. Kopiert fra Jobber og Tradify, og det er ikke
   * plasseringen som er poenget — det er at det finnes ÉN.
   *
   * «Marker som pågår» beskriver en databasekolonne. «Start jobben» beskriver
   * det montøren gjør. Verbet er hele forskjellen: den ene må oversettes i
   * hodet, den andre ikke.
   *
   * Fakturaklar peker VIDERE i stedet for å endre status, fordi fakturering
   * krever faglig godkjenning og skjer på fakturaskjermen. Er jobben fakturert,
   * er det ingen neste handling — og da skal det ikke stå en knapp der.
   */
  const hovedhandling: { tekst: string; gjor: () => void } | null =
    order.status === 'fakturert' ? null
    : order.status === 'fakturaklar'
      ? { tekst: 'Til fakturagrunnlaget', gjor: () => router.push({ pathname: '/(app)/ordre/faktura', params: { id } }) }
      : order.status === 'pagaar'
        ? { tekst: 'Meld ferdig', gjor: () => setStatus('fakturaklar') }
        : order.status === 'planlagt'
          ? { tekst: 'Start jobben', gjor: () => setStatus('pagaar') }
          : nextStatus
            ? { tekst: `Marker som ${orderStatusLabel[nextStatus].toLowerCase()}`, gjor: () => setStatus(nextStatus) }
            : null

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          // Plass til den forankrede handlingen — ellers skjuler den siste rad.
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl + (hovedhandling ? 72 : 0),
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
            <AmpexMarkButton />
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

        {/* Arkivet står øverst når jobben er ferdig — da er det det eneste som
            gjenstår, og det som betyr noe om syv år. */}
        {order.status === 'fakturert' && (
          <View style={{ marginBottom: spacing.screen }}>
            <ArkivKort order={order} />
          </View>
        )}

        {/*
          ── Rekkefølgen på denne skjermen ──────────────────────────────────
          Montøren står i et sikringsskap med hansker på. Det han trenger er,
          i denne rekkefølgen: HVOR er jeg, HVA gjør jeg, hva BRUKTE jeg, hva
          må DOKUMENTERES. Alt det andre — signatur, tillegg, fakturagrunnlag,
          godkjenning — hører til når jobben er ferdig, eller hjemme på PC-en.

          Før lå deltakerliste, tilleggsarbeid, kundesignatur OG fakturagrunnlag
          over materiell og dokumentasjon. Fire kontoroppgaver foran de tre
          tingene jobben faktisk består av.
        */}

        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>På jobben</SectionHeader>
          <ListCard>
            <Rad
              ikon={<Clock size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
              tittel="Timer"
              verdi={timer > 0 ? `${(Number.isInteger(timer) ? timer : timer.toFixed(2).replace(/0+$/, '')).toString().replace('.', ',')} t` : '—'}
              sterkVerdi
              onPress={() => router.push({ pathname: '/(app)/ordre/timer', params: { id } })}
              forst
              sist
            />
          </ListCard>
        </View>

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
            {/* Kun de siste fire. En jobb kan ha tjue linjer materiell, og
                tjue rader her dyttet dokumentasjonen og resten av skjermen ut
                av syne — det var halve grunnen til at siden føltes uendelig.
                De SISTE, ikke de første: det du nettopp førte er det du vil
                se at kom med. */}
            <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs }}>
              {materials.slice(-4).map(m => <MaterialRow key={m.id} material={m} />)}
              {materials.length > 4 && (
                <Pressable
                  haptic="light"
                  onPress={() => router.push({ pathname: '/(app)/ordre/material', params: { orderId: order.id } })}
                  style={{ alignItems: 'center', paddingVertical: spacing.sm }}
                >
                  <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>
                    {`Vis alle ${materials.length}`}
                  </Text>
                </Pressable>
              )}
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
        </View>
        {/* Dokumentasjon — viser kun faktisk påbegynt/fullført skjema, ikke alle malene */}
        <View style={{ marginBottom: spacing.screen }}>
          <ListCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <FileText size={20} color={colors.label} strokeWidth={sizes.lucideStroke} />
                <Text style={t.headline}>Dokumentasjon</Text>
              </View>
              {/* Nevner = alle maler. «2/5» svarer på om jobben kan lukkes; «2 fullført» gjør ikke. */}
              <Text style={[
                t.caption,
                { fontWeight: '700', fontVariant: ['tabular-nums'], color: allDocsDone ? colors.slate : colors.secondaryLabel },
              ]}>
                {`${doneCount}/${AMPEX_TEMPLATES.length}`}
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
        {/* LiDAR — én seksjon, segmentvalg mellom planlegging og dokumentasjon */}
        <ScanSection orderId={order.id} scans={scans} />

        {/* Når jobben er ferdig. Signaturen er en avslutningshandling — den skal
            tas foran kunden når arbeidet er gjort, ikke ligge og lyse mens du
            fortsatt drar kabel. */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Når jobben er ferdig</SectionHeader>
          <ListCard>
            <Rad
              ikon={<PenLine size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
              tittel="Kundesignatur"
              under={signaturer.length === 0 ? 'Bevis på at arbeidet er godtatt' : undefined}
              verdi={signaturer.length > 0 ? String(signaturer.length) : '—'}
              onPress={() => router.push({ pathname: '/(app)/ordre/signatur', params: { id } })}
              forst
            />
            {/* Tilleggsarbeid vises KUN når ordren har en avtalt pris.
                På løpende regning er ekstra arbeid bare flere timer og mer
                materiell — da er dette et unødvendig begrep i veien. Er prisen
                avtalt, er det motsatt: timer og materiell utover avtalen blir
                slukt av fastprisen og aldri fakturert, med mindre de føres som
                et tillegg kunden har godkjent. */}
            {!!order.quoteId && (
              <Rad
                ikon={<FilePlus2 size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
                tittel="Tilleggsarbeid"
                under={tillegg.ventende > 0 ? `${tillegg.ventende} venter på godkjenning` : 'Arbeid utenfor den avtalte prisen'}
                underVarsel={tillegg.ventende > 0}
                verdi={tillegg.total > 0 ? String(tillegg.total) : '—'}
                onPress={() => router.push({ pathname: '/(app)/ordre/tillegg', params: { id } })}
              />
            )}
            <Rad
              ikon={<Users size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
              tittel="Deltakere"
              verdi={antallMedlemmer > 0 ? String(antallMedlemmer) : '—'}
              onPress={() => router.push({ pathname: '/(app)/ordre/deltakere', params: { id } })}
              sist
            />
          </ListCard>
        </View>

        {/* Kom ordren fra et tilbud, er den avtalte prisen det viktigste tallet på
            skjermen — den overstyrer alt fakturagrunnlaget regner ut. */}
        {!!order.quoteId && (
          <View style={{ marginBottom: spacing.screen }}>
            <AvtaltPrisKort quoteId={order.quoteId} />
          </View>
        )}
        {/*
          Fakturagrunnlag. Flyttet NED hit: det er et kontorspørsmål, ikke et
          feltspørsmål, og det sto tidligere over både materiell og
          dokumentasjon. Men det skal fortsatt stå på ordren og ikke bare på
          desktop — mangler (vare uten pris, ordre uten kunde) må oppdages
          mens montøren fortsatt er på stedet og kan rette dem.
        */}
        <View style={{ marginBottom: spacing.screen }}>
          <ListCard>
            <Pressable
              onPress={() => router.push({ pathname: '/(app)/ordre/faktura', params: { id } })}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
              }}
            >
              <Receipt size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
              <View style={{ flex: 1 }}>
                <Text style={t.headline}>Fakturagrunnlag</Text>
                <Text style={[t.footnote, { marginTop: 1 }]}>
                  {!grunnlag ? 'Regner ut …'
                    : grunnlag.linjer.length === 0 ? 'Ingenting å fakturere ennå'
                    : `${grunnlag.linjer.length} linjer${grunnlag.utelatt.length ? ` · ${grunnlag.utelatt.length} utelatt` : ''}`}
                </Text>
              </View>
              {!!grunnlag && grunnlag.linjer.length > 0 && (
                <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatKr(grunnlag.bruttoOre)}</Text>
              )}
              <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
            </Pressable>
            {/* Kunde uten ID stopper fakturaen i regnskapet. Si det her, ikke først til slutt. */}
            {!order.customerId && (
              <Pressable
                onPress={() => router.push({ pathname: '/(app)/kunder/velg', params: { orderId: id } })}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                  paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                  borderTopWidth: 0.5, borderTopColor: colors.separator,
                }}
              >
                <UserPlus size={18} color={colors.warning} strokeWidth={sizes.lucideStroke} />
                <Text style={[t.subhead, { flex: 1, color: colors.secondaryLabel }]}>
                  Ordren mangler kunde i registeret
                </Text>
                <Text style={[t.subhead, { color: colors.brand, fontWeight: '600' }]}>Velg</Text>
              </Pressable>
            )}
          </ListCard>
        </View>
        {/* Faglig godkjenning står OVER fakturagrunnlaget: er ordren sendt
            tilbake, er summen under uinteressant til det er rettet. */}
        {godkjenninger.length > 0 && (
          <View style={{ marginBottom: spacing.screen }}>
            <GodkjenningKort godkjenninger={godkjenninger} grunnlag={godkjenningsgrunnlag} />
          </View>
        )}


        {/*
          Status var seks likeverdige chips — en editor, ikke en handling. Flyten er
          lineær (mottatt → planlagt → pågår → fakturaklar → fakturert), så neste steg
          kan utledes og løftes til én tydelig knapp. Resten ligger bak «Endre status»
          for korrigering; ingen funksjonalitet er fjernet, bare rangert.
        */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Status</SectionHeader>
          <View style={{ marginHorizontal: spacing.screen, gap: spacing.sm }}>
            {/* Hovedhandlingen er flyttet til den forankrede linja nederst.
                Her ligger bare korrigering — å hoppe tilbake når noe ble
                markert feil. */}
            <Pressable
              haptic="light"
              onPress={() => setStatusOpen(o => !o)}
              style={{ alignItems: 'center', paddingVertical: spacing.sm }}
            >
              <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>
                {statusOpen ? 'Skjul statusvalg' : 'Endre status'}
              </Text>
            </Pressable>
            {statusOpen && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {orderStatuses.map(s => (
                  <Chip
                    key={s}
                    label={orderStatusLabel[s]}
                    selected={order.status === s}
                    onPress={() => setStatus(s)}
                  />
                ))}
              </View>
            )}
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

      {/*
        Én forankret hovedhandling — mønsteret fra Jobber og Tradify.

        Poenget er ikke at knappen er festet nederst. Poenget er at det finnes
        ÉN. Før konkurrerte fem kort med lik vekt om oppmerksomheten, og
        statusknappen — det eneste steget som faktisk flytter jobben framover —
        lå nederst mellom «Endre status» og metadata.

        Den ligger OVER tabbaren og under innholdet, så den følger med uansett
        hvor langt ned du har rullet. En montør med hansker skal ikke lete.
      */}
      {hovedhandling && (
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: spacing.screen,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.sm,
          paddingTop: spacing.sm,
        }}>
          <Pressable
            haptic="medium"
            onPress={hovedhandling.gjor}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
              shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
            }}
          >
            <Check size={19} color={colors.ctaLabel} strokeWidth={2.4} />
            <Text style={[t.headline, { color: colors.ctaLabel }]}>{hovedhandling.tekst}</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}
