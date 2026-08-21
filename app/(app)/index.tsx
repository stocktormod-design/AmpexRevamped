import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text, AnimatedText } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  FadeInDown, useSharedValue, useAnimatedScrollHandler, useAnimatedStyle,
  interpolate, Extrapolation, type SharedValue,
} from 'react-native-reanimated'
import { BlurView } from 'expo-blur'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import {
  CirclePlus, FolderOpen, Package, Clock, MapPin, Phone, CircleCheck, ChevronRight,
  ScanBarcode, TriangleAlert, ClipboardCheck, Circle, ScanSearch,
  type LucideIcon,
} from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { AmpexMarkButton } from '../../components/ampex-mark-button'
import { SectionHeader } from '../../components/ui'
import { ToolScreen, ToolCard, ToolSectionHeader } from '../../components/tool-surface'
import { database } from '../../lib/db'
import { Order, orderStatusLabel } from '../../lib/db/models/order'
import { Task } from '../../lib/db/models/task'
import { toggleTaskDone } from '../../lib/tasks'
import { useUserId } from '../../lib/auth-user'
import { useLastOpened } from '../../lib/last-opened'
import { formatTime, formatSince } from '../../lib/format'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../lib/theme'

// `soon` = funksjonen finnes ikke ennå. Flisa vises dempet og merket «Kommer»
// i stedet for å se trykkbar ut og ikke svare — en død knapp koster tillit i felt.
const actions: { label: string; sub: string; Icon: LucideIcon; onPress?: () => void; soon?: true }[] = [
  { label: 'Ny ordre',      sub: 'Service, installasjon', Icon: CirclePlus, onPress: () => router.push('/(app)/ordre/ny') },
  { label: 'Nytt prosjekt', sub: 'Tegninger, rom',        Icon: FolderOpen, onPress: () => router.push('/(app)/prosjekter') },
  { label: 'Lager',         sub: 'Inn/ut, bestilling',    Icon: Package,    onPress: () => router.push('/(app)/lager') },
  { label: 'Timeføring',    sub: 'Dag, uke, forslag',     Icon: Clock,      soon: true },
]

const shortcuts: { label: string; Icon: LucideIcon; route?: string; soon?: true }[] = [
  { label: 'Skann',  Icon: ScanBarcode,   soon: true },
  { label: 'Avvik',  Icon: TriangleAlert, soon: true },
  { label: 'Skjema', Icon: ClipboardCheck, route: '/(app)/skjema' },
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

/** Oppgaver tildelt meg og fortsatt åpne — inbox. */
function useMyTasks(userId: string | null) {
  const [tasks, setTasks] = useState<Task[]>([])
  useEffect(() => {
    if (!userId) { setTasks([]); return }
    const sub = database
      .get<Task>('tasks')
      .query(Q.where('assigned_to', userId), Q.where('status', 'open'), Q.sortBy('created_at', Q.desc))
      .observe()
      .subscribe(setTasks)
    return () => sub.unsubscribe()
  }, [userId])
  return tasks
}

/** Inbox-rad: hak av til venstre, trykk rad → åpne prosjektet. */
function InboxRow({ task, last }: { task: Task; last: boolean }) {
  return (
    <Pressable
      onPress={() => router.push(`/(app)/prosjekter/${task.projectId}`)}
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.lg, paddingVertical: spacing.md + 2, paddingLeft: spacing.lg },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.toolBorder },
      ]}
    >
      <Pressable haptic="light" hitSlop={10} onPress={() => toggleTaskDone(task)}>
        <Circle size={sizes.icon} color={colors.toolTertiary} strokeWidth={2} />
      </Pressable>
      <View style={{ flex: 1, marginHorizontal: spacing.md }}>
        <Text style={[t.bodyMedium, { color: colors.toolLabel }]} numberOfLines={2}>{task.title}</Text>
      </View>
      {task.kind === 'lidar_scan' && <ScanSearch size={16} color={colors.brand} strokeWidth={sizes.lucideStroke} />}
      <ChevronRight size={16} color={colors.toolTertiary} strokeWidth={sizes.lucideStroke} style={{ marginLeft: spacing.sm }} />
    </Pressable>
  )
}

/** Kompakt frostet nav-bar som toner inn når stor tittel scroller ut — iOS-standard */
function GlassHeader({ scrollY, topInset }: { scrollY: SharedValue<number>; topInset: number }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [44, 76], [0, 1], Extrapolation.CLAMP),
  }))
  return (
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }, style]} pointerEvents="none">
      <BlurView
        tint="dark"
        intensity={90}
        style={{
          paddingTop: topInset,
          backgroundColor: 'rgba(33,28,21,0.86)',
          borderBottomWidth: 0.5,
          borderBottomColor: colors.toolBorder,
        }}
      >
        <View style={{ height: sizes.navBar, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[t.headline, { color: colors.toolLabel }]}>I dag</Text>
        </View>
      </BlurView>
    </Animated.View>
  )
}

/** Hero — neste ordre. Kobber-prikken + «Åpne ordre»-CTA er skjermens ENE brand-aksent. */
function NextOrderCard({ order }: { order: Order }) {
  const time = formatTime(order.scheduledAt)
  const status = orderStatusLabel[order.status] ?? order.status
  return (
    <ToolCard>
      <View style={{ padding: spacing.xl, paddingBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
            backgroundColor: colors.toolRaisedStrong, borderRadius: radius.pill,
            paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1,
          }}>
            <View style={{ width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.brand }} />
            <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.brand }]}>
              {[status, time].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.toolTertiary} strokeWidth={sizes.lucideStroke} />
        </View>
        <Text style={[t.title2, { color: colors.toolLabel, marginTop: spacing.md }]} numberOfLines={2}>{order.title}</Text>
        {!!order.customerName && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
            <Phone size={16} color={colors.toolSecondary} strokeWidth={sizes.lucideStroke} />
            <Text style={[t.subhead, { flex: 1, color: colors.toolSecondary }]} numberOfLines={1}>{order.customerName}</Text>
          </View>
        )}
        {!!order.address && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs + 2 }}>
            <MapPin size={16} color={colors.toolSecondary} strokeWidth={sizes.lucideStroke} />
            <Text style={[t.subhead, { flex: 1, color: colors.toolSecondary }]} numberOfLines={1}>{order.address}</Text>
          </View>
        )}
      </View>
      <Pressable
        haptic="medium"
        onPress={() => router.push(`/(app)/ordre/${order.id}`)}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.brand,
          marginHorizontal: spacing.md, marginBottom: spacing.md,
        }}
      >
        <Text style={[t.headline, { color: '#fff' }]}>Åpne ordre</Text>
      </Pressable>
    </ToolCard>
  )
}

/**
 * «Sist innom» — hvert kort er selvstendig, ikke én lang liste.
 *
 * Kortene var kremhvite med skygge. På mørk grunn ble de lysende hvite flekker
 * med kremet skrift oppå: usynlig tekst. Dybde lages nå med VERDI som ellers,
 * og skyggen er borte — den hadde uansett ingen jobb på en mørk flate.
 */
function RecentCard({ order, since }: { order: Order; since: Date }) {
  return (
    <Pressable
      onPress={() => router.push(`/(app)/ordre/${order.id}`)}
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 1,
        borderRadius: radius.md, backgroundColor: colors.toolRaised,
        borderWidth: 1, borderColor: colors.toolBorder,
      }]}
    >
      <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.toolTertiary }} />
      <View style={{ flex: 1 }}>
        <Text style={[t.bodyMedium, { color: colors.toolLabel }]} numberOfLines={1}>{order.title}</Text>
        <Text style={[t.footnote, { color: colors.toolSecondary, marginTop: 1 }]} numberOfLines={1}>
          {[order.customerName, formatSince(since)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <ChevronRight size={15} color={colors.toolTertiary} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

function ActionTile({ action, primary }: { action: (typeof actions)[number]; primary?: boolean }) {
  const soon = action.soon === true
  const inner = (
    <>
      <action.Icon
        size={sizes.iconLg - 2}
        color={soon ? colors.toolTertiary : primary ? '#fff' : colors.label}
        strokeWidth={sizes.lucideStroke}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
        <Text
          style={[t.headline, { color: soon ? colors.toolSecondary : primary ? '#fff' : colors.label }]}
          numberOfLines={1}
        >
          {action.label}
        </Text>
        {soon && (
          <View style={{ backgroundColor: colors.toolRaisedStrong, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
            <Text style={[t.caption, { color: colors.toolTertiary, fontWeight: '600' }]}>Kommer</Text>
          </View>
        )}
      </View>
    </>
  )
  const style = {
    flex: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
    backgroundColor: soon ? colors.toolRaised : primary ? colors.brand : colors.slateSoft,
    borderWidth: primary && !soon ? 0 : 0.5,
    borderColor: soon ? colors.toolBorder : colors.slateBorder,
  }
  // Ingen Pressable når funksjonen ikke finnes — ingen trykkrespons å love.
  if (soon) return <View style={style}>{inner}</View>
  return (
    <Pressable pressScale={0.96} onPress={action.onPress} style={style}>
      {inner}
    </Pressable>
  )
}

function EmptyState() {
  return (
    <ToolCard>
      <View style={{ alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.xl }}>
        <View style={{
          width: sizes.iconChip + 8, height: sizes.iconChip + 8, borderRadius: radius.pill,
          backgroundColor: colors.toolRaised, alignItems: 'center', justifyContent: 'center',
        }}>
          <CircleCheck size={sizes.iconLg} color={colors.brand} strokeWidth={sizes.lucideStroke} />
        </View>
        <Text style={[t.headline, { color: colors.toolLabel, marginTop: spacing.md }]}>Ingen åpne ordre</Text>
        <Text style={[t.footnote, { color: colors.toolSecondary, marginTop: spacing.xs }]}>Nye ordre dukker opp her.</Text>
      </View>
    </ToolCard>
  )
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const orders = useOpenOrders()
  const userId = useUserId()
  const myTasks = useMyTasks(userId)
  const lastOpened = useLastOpened()
  const rawDate = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })
  const today = rawDate.charAt(0).toUpperCase() + rawDate.slice(1)
  const [next] = orders
  // Sist innom: åpne ordre du sist har åpnet (lokal sporing; updated_at som fallback)
  const openedAt = (o: Order) => lastOpened[o.id] ?? o.updatedAt.getTime()
  const recent = orders
    .filter(o => o.id !== next?.id)
    .sort((a, b) => openedAt(b) - openedAt(a))
    .slice(0, 4)

  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler(e => { scrollY.value = e.contentOffset.y })
  // Stor tittel strekker seg litt ved overscroll — iOS-detalj
  const titleStyle = useAnimatedStyle(() => ({
    transformOrigin: 'left center',
    transform: [{ scale: interpolate(scrollY.value, [-80, 0], [1.06, 1], Extrapolation.CLAMP) }],
  }))

  return (
    <ToolScreen>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xl,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
          paddingHorizontal: spacing.screen, marginBottom: spacing.xl,
        }}>
          <View>
            <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.toolTertiary, marginBottom: spacing.xs }]}>{today}</Text>
            <AnimatedText style={[t.display, { color: colors.toolLabel }, titleStyle]}>I dag</AnimatedText>
          </View>
          {/* Merket ER assistenten — samme knapp som på de andre skjermene.
              Sto tidligere som ren dekorasjon her. */}
          <View style={{ marginBottom: spacing.xs + 2 }}>
            <AmpexMarkButton />
          </View>
        </View>

        {/* Neste ordre — hero, det viktigste akkurat nå */}
        <Animated.View entering={FadeInDown.springify()} style={{ marginBottom: spacing.screen }}>
          <ToolSectionHeader>Neste ordre</ToolSectionHeader>
          {next ? <NextOrderCard order={next} /> : <EmptyState />}
        </Animated.View>

        {/* Tildelt meg — inbox: åpne oppgaver tildelt deg (LiDAR-forespørsler m.m.) */}
        {myTasks.length > 0 && (
          <Animated.View entering={FadeInDown.springify().delay(30)} style={{ marginBottom: spacing.screen }}>
            <ToolSectionHeader>Tildelt meg</ToolSectionHeader>
            <ToolCard>
              {myTasks.map((task, i, arr) => (
                <InboxRow key={task.id} task={task} last={i === arr.length - 1} />
              ))}
            </ToolCard>
          </Animated.View>
        )}

        {/* Sist innom — åpne ordre du sist har jobbet med */}
        {recent.length > 0 && (
          <Animated.View entering={FadeInDown.springify().delay(60)} style={{ marginBottom: spacing.screen }}>
            <ToolSectionHeader>Sist innom</ToolSectionHeader>
            <View style={{ marginHorizontal: spacing.screen, gap: spacing.sm }}>
              {recent.map(o => (
                <RecentCard key={o.id} order={o} since={new Date(openedAt(o))} />
              ))}
            </View>
          </Animated.View>
        )}

        {/* Handlinger — 2×2 tiles */}
        <Animated.View entering={FadeInDown.springify().delay(120)} style={{ marginBottom: spacing.screen }}>
          <ToolSectionHeader>Handlinger</ToolSectionHeader>
          <View style={{ gap: spacing.md, marginHorizontal: spacing.screen }}>
            {[actions.slice(0, 2), actions.slice(2)].map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.md }}>
                {row.map(a => <ActionTile key={a.label} action={a} primary={a.label === 'Ny ordre'} />)}
              </View>
            ))}
          </View>
        </Animated.View>

        {/* Snarveier — kompakte kapsler, tertiært */}
        <Animated.View entering={FadeInDown.springify().delay(180)}>
          <ToolSectionHeader>Snarveier</ToolSectionHeader>
          <View style={{ flexDirection: 'row', gap: spacing.sm + 2, marginHorizontal: spacing.screen }}>
            {shortcuts.map(s => {
              const style = {
                flex: 1, flexDirection: 'row' as const, gap: spacing.sm,
                backgroundColor: colors.toolRaisedStrong, borderRadius: radius.lg,
                alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: spacing.md + 2,
                opacity: s.soon ? 0.5 : 1,
              }
              const inner = (
                <>
                  <s.Icon size={sizes.icon} color={colors.brand} strokeWidth={sizes.lucideStroke} />
                  <Text style={[t.subhead, { fontWeight: '500', color: s.soon ? colors.toolSecondary : colors.toolLabel }]}>
                    {s.label}
                  </Text>
                </>
              )
              // Uten rute er kapselen ren informasjon — ikke en knapp som tier.
              if (s.soon || !s.route) return <View key={s.label} style={style}>{inner}</View>
              return (
                <Pressable key={s.label} pressScale={0.95} onPress={() => router.push(s.route as any)} style={style}>
                  {inner}
                </Pressable>
              )
            })}
          </View>
        </Animated.View>
      </Animated.ScrollView>
      <GlassHeader scrollY={scrollY} topInset={insets.top} />
    </ToolScreen>
  )
}
