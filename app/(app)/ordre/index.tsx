import { useEffect, useState } from 'react'
import { View, FlatList, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Plus, ChevronRight, Inbox, FileText, Map, List, CalendarDays } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ToolScreen, ToolChip } from '../../../components/tool-surface'
import { AmpexMarkButton } from '../../../components/ampex-mark-button'
import { OrdreKart, kartStottes } from '../../../components/ordre-kart'
import { OrdreKalender } from '../../../components/ordre-kalender'
import { database } from '../../../lib/db'
import { Order, orderStatuses, orderStatusLabel, type OrderStatus } from '../../../lib/db/models/order'
import { formatTime } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

type Filter = 'apne' | 'alle' | OrderStatus

/** Liste, kalender og kart er tre VISNINGER av samme filtrerte liste. */
type Visning = 'liste' | 'kalender' | 'kart'

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
        backgroundColor: colors.toolRaised,
        marginHorizontal: spacing.screen,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md + 3,
        flexDirection: 'row',
        alignItems: 'center',
        // Hårlinje MELLOM radene, ikke rundt hver. Rader som er separate kort
        // leses som løse lapper; én sammenhengende flate leses som en liste.
        borderTopWidth: first ? 1 : 0,
        borderBottomWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: colors.toolBorder,
        borderTopLeftRadius: first ? radius.lg : 0,
        borderTopRightRadius: first ? radius.lg : 0,
        borderBottomLeftRadius: last ? radius.lg : 0,
        borderBottomRightRadius: last ? radius.lg : 0,
      }}
    >
      {/* Statusen som en smal kobberstrek, ikke som ord til høyre. Den leses
          før teksten og tar null plass. */}
      <View style={{
        width: 3, height: 30, borderRadius: 2, marginRight: spacing.md,
        backgroundColor: order.status === 'pagaar' ? colors.brand : colors.toolBorder,
      }} />
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={[t.bodyMedium, { color: colors.toolLabel }]} numberOfLines={1}>{order.title}</Text>
        <Text style={[t.footnote, { color: colors.toolSecondary, marginTop: 2 }]} numberOfLines={1}>
          {[order.customerName, order.address].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', marginRight: spacing.sm }}>
        <Text style={[t.caption, { color: colors.toolSecondary }]}>
          {orderStatusLabel[order.status] ?? order.status}
        </Text>
        {!!order.scheduledAt && (
          <Text style={[t.caption, { color: colors.toolTertiary, marginTop: 2, fontVariant: ['tabular-nums'] }]}>
            {formatTime(order.scheduledAt)}
          </Text>
        )}
      </View>
      <ChevronRight size={16} color={colors.toolTertiary} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

export default function OrdreScreen() {
  const insets = useSafeAreaInsets()
  const [filter, setFilter] = useState<Filter>('apne')
  const [visning, setVisning] = useState<Visning>('liste')
  const orders = useOrders(filter)

  // Tittel + filterchips ligger her fordi BÅDE lista og kalenderen bruker dem:
  // filteret over gjelder visningen du står i, uansett hvilken det er.
  const topp = (
    <>
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
        paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
      }}>
        <Text style={[t.display, { color: colors.toolLabel }]}>Ordre</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <AmpexMarkButton />
          {/* Uken som kalender. Lista svarer på «hvilke jobber har vi», denne
              på «når skal de gjøres» — og de er samme liste. */}
          <Pressable
            haptic="light"
            pressScale={0.94}
            onPress={() => setVisning(v => (v === 'kalender' ? 'liste' : 'kalender'))}
            style={{
              width: 36, height: 36, borderRadius: radius.pill,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: visning === 'kalender' ? colors.brandSoft : colors.toolRaised,
              borderWidth: 1, borderColor: visning === 'kalender' ? colors.brandSoft : colors.toolBorder,
            }}
          >
            <CalendarDays size={16} color={visning === 'kalender' ? colors.brand : colors.toolLabel} strokeWidth={2.1} />
          </Pressable>
          {kartStottes && (
            <Pressable
              haptic="light"
              pressScale={0.94}
              onPress={() => setVisning('kart')}
              style={{
                width: 36, height: 36, borderRadius: radius.pill,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: colors.toolRaised, borderWidth: 1, borderColor: colors.toolBorder,
              }}
            >
              <Map size={16} color={colors.toolLabel} strokeWidth={2.1} />
            </Pressable>
          )}
          {/* Tilbudet er steget FØR ordren — derfor står inngangen her, ved
              siden av ordrelista, og ikke gjemt under Meg. */}
          <Pressable
            haptic="light"
            pressScale={0.94}
            onPress={() => router.push('/(app)/tilbud')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
              height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill,
              backgroundColor: colors.toolRaised, borderWidth: 1, borderColor: colors.toolBorder,
            }}
          >
            <FileText size={15} color={colors.toolLabel} strokeWidth={2.1} />
            <Text style={[t.subhead, { fontWeight: '600', color: colors.toolLabel }]}>Tilbud</Text>
          </Pressable>
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
          <ToolChip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </ScrollView>
    </>
  )

  // Kartet er en VISNING av samme liste, ikke en egen skjerm: filteret over
  // gjelder alle tre. Slik gjør Jobber, Housecall Pro og Tradify det, og grunnen
  // er at rekkefølgen på dagens jobber bestemmes av geografi — en liste sortert
  // på klokkeslett skjuler at to av dem ligger i samme gate.
  if (visning === 'kart' && kartStottes) {
    return (
      <ToolScreen>
        <OrdreKart
          orders={orders}
          onVelg={o => router.push({ pathname: '/(app)/ordre/[id]', params: { id: o.id } })}
        />
        <Pressable
          haptic="light"
          onPress={() => setVisning('liste')}
          style={{
            position: 'absolute', top: insets.top + spacing.md, right: spacing.screen,
            flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
            height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill,
            backgroundColor: colors.bg,
          }}
        >
          <List size={15} color={colors.label} strokeWidth={2.1} />
          <Text style={[t.subhead, { fontWeight: '600' }]}>Liste</Text>
        </Pressable>
      </ToolScreen>
    )
  }

  if (visning === 'kalender') {
    return (
      <ToolScreen>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + spacing.xl,
            paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
          }}
          showsVerticalScrollIndicator={false}
        >
          {topp}
          <OrdreKalender
            orders={orders}
            onVelg={o => router.push({ pathname: '/(app)/ordre/[id]', params: { id: o.id } })}
          />
        </ScrollView>
      </ToolScreen>
    )
  }

  return (
    <ToolScreen>
      <FlatList
        data={orders}
        keyExtractor={o => o.id}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xl,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={topp}
        ItemSeparatorComponent={null}
        renderItem={({ item, index }) => (
          <OrderRow order={item} first={index === 0} last={index === orders.length - 1} />
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl }}>
            <View style={{
              width: sizes.iconChip + 8, height: sizes.iconChip + 8, borderRadius: radius.md,
              backgroundColor: colors.toolRaised, borderWidth: 1, borderColor: colors.toolBorder,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Inbox size={sizes.iconLg} color={colors.toolSecondary} strokeWidth={sizes.lucideStroke} />
            </View>
            <Text style={[t.headline, { color: colors.toolLabel, marginTop: spacing.md }]}>Ingen ordre her</Text>
            <Text style={[t.footnote, { color: colors.toolSecondary, marginTop: spacing.xs, textAlign: 'center' }]}>
              Prøv et annet filter, eller opprett en ny.
            </Text>
          </View>
        }
      />
    </ToolScreen>
  )
}
