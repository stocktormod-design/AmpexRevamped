import { useEffect, useState } from 'react'
import { View, Text, StatusBar } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  FadeInDown, useSharedValue, useAnimatedScrollHandler, useAnimatedStyle,
  interpolate, Extrapolation, type SharedValue,
} from 'react-native-reanimated'
import { BlurView } from 'expo-blur'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import {
  CirclePlus, FolderOpen, Package, Clock, MapPin, CircleCheck, ChevronRight,
  ScanBarcode, TriangleAlert, ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { AmpexLogo } from '../../components/ampex-logo'
import { GlassCard, SectionHeader } from '../../components/ui'
import { database } from '../../lib/db'
import { Order, orderStatusLabel } from '../../lib/db/models/order'
import { useLastOpened } from '../../lib/last-opened'
import { formatTime, formatSince } from '../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

const actions: { label: string; sub: string; Icon: LucideIcon; onPress: () => void }[] = [
  { label: 'Ny ordre',      sub: 'Service, installasjon', Icon: CirclePlus, onPress: () => router.push('/(app)/ordre/ny') },
  { label: 'Nytt prosjekt', sub: 'Tegninger, rom',        Icon: FolderOpen, onPress: () => router.push('/(app)/prosjekter') },
  { label: 'Lager',         sub: 'Inn/ut, bestilling',    Icon: Package,    onPress: () => router.push('/(app)/lager') },
  { label: 'Timeføring',    sub: 'Dag, uke, forslag',     Icon: Clock,      onPress: () => {} },
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

/**
 * Knapt synlige nøytrale gradient-flekker bak innholdet — gir glass-materialene
 * noe å bryte (glass over flat farge er usynlig). Parallakse ved scroll.
 */
function AmbientBackdrop({ scrollY }: { scrollY: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollY.value * 0.35 }],
  }))
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, height: 460 }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="cool" cx="18%" cy="12%" r="65%">
            <Stop offset="0" stopColor={colors.ambientCool} stopOpacity="0.9" />
            <Stop offset="1" stopColor={colors.ambientCool} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="warm" cx="88%" cy="34%" r="60%">
            <Stop offset="0" stopColor={colors.ambientWarm} stopOpacity="0.75" />
            <Stop offset="1" stopColor={colors.ambientWarm} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#cool)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#warm)" />
      </Svg>
    </Animated.View>
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
        tint="systemChromeMaterialLight"
        intensity={90}
        style={{
          paddingTop: topInset,
          backgroundColor: colors.chromeGlass,
          borderBottomWidth: 0.5,
          borderBottomColor: colors.separator,
        }}
      >
        <View style={{ height: sizes.navBar, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={t.headline}>I dag</Text>
        </View>
      </BlurView>
    </Animated.View>
  )
}

/** Hero — neste ordre. Monokrom: status er tekst, ikke farge. */
function NextOrderCard({ order }: { order: Order }) {
  const time = formatTime(order.scheduledAt)
  const status = orderStatusLabel[order.status] ?? order.status
  return (
    <GlassCard onPress={() => router.push(`/(app)/ordre/${order.id}`)}>
      <Text style={[t.caption, { textTransform: 'uppercase' }]}>
        {[status, time].filter(Boolean).join(' · ')}
      </Text>
      <Text style={[t.title2, { marginTop: spacing.sm }]} numberOfLines={2}>{order.title}</Text>
      {!!order.customerName && (
        <Text style={[t.subhead, { color: colors.secondaryLabel, marginTop: spacing.xs }]} numberOfLines={1}>
          {order.customerName}
        </Text>
      )}
      {!!order.address && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginTop: spacing.md }}>
          <MapPin size={sizes.icon - 4} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
          <Text style={[t.subhead, { color: colors.secondaryLabel, flex: 1 }]} numberOfLines={1}>
            {order.address}
          </Text>
        </View>
      )}
    </GlassCard>
  )
}

/** Kompakt rad for sist-innom: siden sist | tittel/kunde */
function OrderRow({ order, since, last }: { order: Order; since: Date; last: boolean }) {
  return (
    <Pressable
      onPress={() => router.push(`/(app)/ordre/${order.id}`)}
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator, marginLeft: spacing.lg, paddingLeft: 0 },
      ]}
    >
      <Text style={[t.subhead, { color: colors.secondaryLabel, width: 52, fontVariant: ['tabular-nums'] }]}>
        {formatSince(since)}
      </Text>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={t.bodyMedium} numberOfLines={1}>{order.title}</Text>
        <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={1}>
          {[order.customerName, order.address].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

function ActionTile({ action }: { action: (typeof actions)[number] }) {
  return (
    <Pressable
      pressScale={0.96}
      onPress={action.onPress}
      style={{ flex: 1, backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.lg }}
    >
      <View style={{
        width: sizes.iconChip, height: sizes.iconChip, borderRadius: radius.md,
        backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
      }}>
        <action.Icon size={sizes.iconLg - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
      </View>
      <Text style={[t.headline, { marginTop: spacing.md }]}>{action.label}</Text>
      <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={1}>{action.sub}</Text>
    </Pressable>
  )
}

function EmptyState() {
  return (
    <GlassCard>
      <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
        <View style={{
          width: sizes.iconChip + 8, height: sizes.iconChip + 8, borderRadius: radius.pill,
          backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
        }}>
          <CircleCheck size={sizes.iconLg} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
        </View>
        <Text style={[t.headline, { marginTop: spacing.md }]}>Ingen åpne ordre</Text>
        <Text style={[t.footnote, { marginTop: spacing.xs }]}>Nye ordre dukker opp her.</Text>
      </View>
    </GlassCard>
  )
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const orders = useOpenOrders()
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
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <StatusBar barStyle="dark-content" />
      <AmbientBackdrop scrollY={scrollY} />
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
            <Text style={[t.caption, { marginBottom: spacing.xs }]}>{today}</Text>
            <Animated.Text style={[t.largeTitle, titleStyle]}>I dag</Animated.Text>
          </View>
          {/* Brand-mark — én plassering, App Store-avatar-posisjonen */}
          <View style={{ marginBottom: spacing.xs + 2 }}>
            <AmpexLogo size={30} />
          </View>
        </View>

        {/* Neste ordre — hero, det viktigste akkurat nå */}
        <Animated.View entering={FadeInDown.springify()} style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Neste ordre</SectionHeader>
          {next ? <NextOrderCard order={next} /> : <EmptyState />}
        </Animated.View>

        {/* Sist innom — åpne ordre du sist har jobbet med */}
        {recent.length > 0 && (
          <Animated.View entering={FadeInDown.springify().delay(60)} style={{ marginBottom: spacing.screen }}>
            <SectionHeader>Sist innom</SectionHeader>
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
              {recent.map((o, i, arr) => (
                <OrderRow key={o.id} order={o} since={new Date(openedAt(o))} last={i === arr.length - 1} />
              ))}
            </View>
          </Animated.View>
        )}

        {/* Handlinger — 2×2 tiles */}
        <Animated.View entering={FadeInDown.springify().delay(120)} style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Handlinger</SectionHeader>
          <View style={{ gap: spacing.md, marginHorizontal: spacing.screen }}>
            {[actions.slice(0, 2), actions.slice(2)].map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.md }}>
                {row.map(a => <ActionTile key={a.label} action={a} />)}
              </View>
            ))}
          </View>
        </Animated.View>

        {/* Snarveier — kompakte kapsler, tertiært */}
        <Animated.View entering={FadeInDown.springify().delay(180)}>
          <SectionHeader>Snarveier</SectionHeader>
          <View style={{ flexDirection: 'row', gap: spacing.sm + 2, marginHorizontal: spacing.screen }}>
            {shortcuts.map(s => (
              <Pressable
                key={s.label}
                pressScale={0.95}
                style={{
                  flex: 1, flexDirection: 'row', gap: spacing.sm,
                  backgroundColor: colors.bg, borderRadius: radius.lg,
                  alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md + 2,
                }}
              >
                <s.Icon size={sizes.icon} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                <Text style={[t.subhead, { fontWeight: '500' }]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </Animated.ScrollView>
      <GlassHeader scrollY={scrollY} topInset={insets.top} />
    </View>
  )
}
