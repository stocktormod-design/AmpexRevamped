import { useEffect, useMemo, useState } from 'react'
import { View, FlatList, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Plus, Inbox, CalendarDays, ChevronRight, List } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { PapirScreen } from '../../../components/papir-surface'
import { MegAvatar } from '../../../components/meg-avatar'
import { OrdreKalender } from '../../../components/ordre-kalender'
import { database } from '../../../lib/db'
import { Order } from '../../../lib/db/models/order'
import { OrderArchive } from '../../../lib/db/models/order-archive'
import { formatTime } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/**
 * ORDRE (lagt om 2026-09-06, Tormod: «ordre er ikke oversiktlig. tesla hadde
 * aldri kommet fram til denne løsningen»).
 *
 * Det som sto her: fem kontroller i hodet (merke, kalender, kart, Tilbud, +),
 * sju filterchips, og rader som viste status på alle. Sju valg før lista.
 *
 * Nå er det ÉN struktur: tittel + én sort handling, én bryter (Åpne/Ferdig),
 * og lista gruppert på DAG. Dagen er statusen — «I dag 16:04» sier mer enn
 * «Planlagt». Status vises bare når den avviker: Pågår (sort) og Klar til
 * faktura (grønn). Kalenderen er en visning av samme liste, Tilbud en rad.
 */

function useOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  useEffect(() => {
    const sub = database.get<Order>('orders').query(Q.sortBy('scheduled_at', Q.asc)).observe().subscribe(setOrders)
    return () => sub.unsubscribe()
  }, [])
  return orders
}

/** Nedfryste ordre = de som har en arkivrad (registeret, ikke R2). */
function useNedfryst() {
  const [ids, setIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    const sub = database.get<OrderArchive>('order_archives').query().observe().subscribe(r => setIds(new Set(r.map(x => x.orderId))))
    return () => sub.unsubscribe()
  }, [])
  return ids
}

type Rad = { type: 'hode'; key: string; label: string } | { type: 'ordre'; key: string; order: Order; first: boolean; last: boolean }

/**
 * Fire bunker i fast rekkefølge (Tormod 2026-09-06): ÅPNE øverst — det du
 * skal gjøre — så Klar til faktura, Fakturert og Nedfryst. Ingen «Tidligere»
 * og ingen «Uten tidspunkt»: en ordre uten tid er fortsatt åpen, og hører
 * hjemme i samme bunke som resten, bare nederst i den.
 */
function grupper(inn: Order[], nedfryst: Set<string>): Rad[] {
  const apne = inn.filter(o => !nedfryst.has(o.id) && (o.status === 'mottatt' || o.status === 'planlagt' || o.status === 'pagaar'))
  const klar = inn.filter(o => !nedfryst.has(o.id) && o.status === 'fakturaklar')
  const fakturert = inn.filter(o => !nedfryst.has(o.id) && o.status === 'fakturert')
  const fryst = inn.filter(o => nedfryst.has(o.id))
  const tidsatt = (liste: Order[]) => [...liste.filter(o => o.scheduledAt), ...liste.filter(o => !o.scheduledAt)]
  const bunker: { label: string; liste: Order[] }[] = [
    { label: 'Åpne', liste: tidsatt(apne) },
    { label: 'Klar til faktura', liste: tidsatt(klar) },
    { label: 'Fakturert', liste: [...fakturert].reverse() },
    { label: 'Nedfryst', liste: [...fryst].reverse() },
  ]
  const ut: Rad[] = []
  for (const b of bunker) {
    if (b.liste.length === 0) continue
    ut.push({ type: 'hode', key: 'h:' + b.label, label: `${b.label} · ${b.liste.length}` })
    b.liste.forEach((o, i) => ut.push({ type: 'ordre', key: o.id, order: o, first: i === 0, last: i === b.liste.length - 1 }))
  }
  return ut
}

/** Raden: navn, kunde · adresse, og klokkeslettet stort til høyre. Status
 *  bare når den avviker fra det dagen alt sier. */
function OrderRow({ order, first, last }: { order: Order; first: boolean; last: boolean }) {
  const tid = order.scheduledAt
    ? `${order.scheduledAt.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} ${formatTime(order.scheduledAt)}`
    : ''
  const avvik =
    order.status === 'pagaar' ? { tekst: 'Pågår', farge: '#FFFFFF', bg: colors.label } :
    order.status === 'fakturaklar' ? { tekst: 'Klar til faktura', farge: colors.success, bg: colors.successSoft } :
    null
  return (
    <Pressable
      haptic="light"
      onPress={() => router.push(`/(app)/ordre/${order.id}`)}
      style={{
        backgroundColor: colors.bg,
        marginHorizontal: spacing.screen,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md + 4,
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: first ? 1 : 0,
        borderBottomWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: colors.separator,
        borderTopLeftRadius: first ? radius.lg : 0,
        borderTopRightRadius: first ? radius.lg : 0,
        borderBottomLeftRadius: last ? radius.lg : 0,
        borderBottomRightRadius: last ? radius.lg : 0,
      }}
    >
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={[t.headline, { color: colors.label }]} numberOfLines={1}>{order.title}</Text>
        <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: 3 }]} numberOfLines={1}>
          {[order.customerName, order.address].filter(Boolean).join(' · ') || 'Ingen kunde'}
        </Text>
        {avvik && (
          <View style={{ alignSelf: 'flex-start', marginTop: spacing.sm - 2, paddingHorizontal: spacing.sm + 1, height: 22, borderRadius: radius.pill, backgroundColor: avvik.bg, justifyContent: 'center' }}>
            <Text style={[t.caption, { color: avvik.farge, fontWeight: '600' }]}>{avvik.tekst}</Text>
          </View>
        )}
      </View>
      {!!tid && (
        <Text style={[t.subhead, { fontWeight: '600', color: colors.label, fontVariant: ['tabular-nums'], textAlign: 'right' }]}>
          {tid}
        </Text>
      )}
    </Pressable>
  )
}

export default function OrdreScreen() {
  const insets = useSafeAreaInsets()
  const [kalender, setKalender] = useState(false)
  const orders = useOrders()
  const nedfryst = useNedfryst()
  const rader = useMemo(() => grupper(orders, nedfryst), [orders, nedfryst])

  const topp = (
    <>
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
        paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
      }}>
        <Text style={[t.display, { color: colors.label }]}>Ordre</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <MegAvatar />
          <Pressable
            haptic="medium" pressScale={0.92}
            onPress={() => router.push('/(app)/ordre/ny')}
            style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.label, alignItems: 'center', justifyContent: 'center' }}
          >
            <Plus size={sizes.icon} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
        </View>
      </View>

      {/* Visning og tilbud. Ingen filter: bunkene ER filteret, i fast rekkefølge. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.screen, marginBottom: spacing.lg, gap: spacing.sm }}>
        <Pressable haptic="light" pressScale={0.94} onPress={() => setKalender(k => !k)}
          accessibilityLabel={kalender ? 'Vis liste' : 'Vis kalender'}
          style={{ width: 38, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: kalender ? colors.label : colors.fill }}>
          {kalender
            ? <List size={18} color="#FFFFFF" strokeWidth={2.1} />
            : <CalendarDays size={18} color={colors.label} strokeWidth={2.1} />}
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable haptic="light" onPress={() => router.push('/(app)/tilbud')} hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={[t.subhead, { fontWeight: '600', color: colors.label }]}>Tilbud</Text>
          <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={2.2} />
        </Pressable>
      </View>
    </>
  )

  if (kalender) {
    return (
      <PapirScreen>
        <ScrollView
          contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
          showsVerticalScrollIndicator={false}
        >
          {topp}
          <OrdreKalender
            orders={orders.filter(o => o.status !== 'fakturert' && !nedfryst.has(o.id))}
            onVelg={o => router.push({ pathname: '/(app)/ordre/[id]', params: { id: o.id } })}
          />
        </ScrollView>
      </PapirScreen>
    )
  }

  return (
    <PapirScreen>
      <FlatList
        data={rader}
        keyExtractor={r => r.key}
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={topp}
        renderItem={({ item }) => item.type === 'hode' ? (
          <Text style={[t.eyebrow, { textTransform: 'uppercase', color: item.label.startsWith('Klar til faktura') ? colors.success : colors.secondaryLabel, marginHorizontal: spacing.screen + spacing.xs, marginTop: spacing.md, marginBottom: spacing.sm }]}>
            {item.label}
          </Text>
        ) : (
          <OrderRow order={item.order} first={item.first} last={item.last} />
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl }}>
            <View style={{ width: sizes.iconChip + 8, height: sizes.iconChip + 8, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
              <Inbox size={sizes.iconLg} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
            </View>
            <Text style={[t.headline, { color: colors.label, marginTop: spacing.md }]}>Ingen ordre ennå</Text>
            <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: spacing.xs, textAlign: 'center' }]}>Trykk + for å opprette en.</Text>
          </View>
        }
      />
    </PapirScreen>
  )
}
