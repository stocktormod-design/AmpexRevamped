import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { setStatusBarStyle } from 'expo-status-bar'
import { router, useFocusEffect } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import {
  Circle, CircleCheck, ChevronRight, Cloud, CloudDrizzle, CloudSnow, Moon, Plus,
  ScanLine, ScanSearch, Sun, UserPlus, type LucideIcon,
} from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { database } from '../../lib/db'
import { Order } from '../../lib/db/models/order'
import { Task } from '../../lib/db/models/task'
import { Project } from '../../lib/db/models/project'
import { AddressMap } from '../../components/address-map'
import { Drawing } from '../../lib/db/models/drawing'
import { Product } from '../../lib/db/models/product'
import { DrawingThumb } from '../../components/drawing-thumb'
import { Image } from 'react-native'
import { MegAvatar, useUserName } from '../../components/meg-avatar'
import { toggleTaskDone } from '../../lib/tasks'
import { useUserId } from '../../lib/auth-user'
import { formatTime } from '../../lib/format'
import { getVaerNaa, type VaerNaa, type VaerSymbol } from '../../lib/weather'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../lib/theme'

/**
 * HJEM — svarer på morgen-spørsmålet: har jeg ordrer i dag, og hva er været?
 *
 * Spec 2026-08-29 (artifact «Espresso-prøven» + DESIGN.md):
 *  - Glass-navbar: dato venstre, vær høyre (KUN nå-tilstand: farget ikon +
 *    grader). Liten hilsen under. Ingen stor «I dag»-tittel — jobben er helten.
 *  - ÉN plate = neste ordre, og platen ER kontrollen (trykk → åpne ordre).
 *    Ingen «Åpne»-knapp, ingen chevron — hint er press + haptikk. Kartutsnitt
 *    øverst kommer med snapshot-pipelinen; flat plate er spec-ens fallback.
 *  - Agendaen er ren tekst med 2 px renne som toner ut der dagen slutter.
 *    Messing finnes ETT sted: neste-prikken.
 *  - Snarveisbånd (+ Ordre · + Kunde · + Avvik) forankret over docken,
 *    sentrert med stemme-orben. Ekte skape-handlinger, aldri messing.
 *  - Ingen pseudo-CTA-er, ingen materiellstatus («elektrikeren vet det selv»),
 *    ingen timeføring — det bor på Meg.
 */

const HILSEN = () => {
  const h = new Date().getHours()
  return h < 10 ? 'God morgen' : h < 17 ? 'God dag' : 'God kveld'
}

function sammeDag(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Etikett for platen: NESTE i dag, I MORGEN, ellers ukedag + dato. */
function plateEtikett(nar: Date | undefined): string {
  if (!nar) return 'Neste'
  const naa = new Date()
  if (sammeDag(nar, naa)) return 'Neste'
  const iMorgen = new Date(naa)
  iMorgen.setDate(naa.getDate() + 1)
  if (sammeDag(nar, iMorgen)) return 'I morgen'
  return nar.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })
}

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

/** Oppgaver tildelt meg og fortsatt åpne — unntakene som krever handling. */
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

/** Første tegning og første vare med bilde — flisene på Hjem skal vise EKTE innhold. */
function useForsteTegning() {
  const [d, setD] = useState<Drawing | null>(null)
  useEffect(() => {
    const sub = database.get<Drawing>('drawings').query(Q.where('file_path', Q.notEq(null)), Q.sortBy('updated_at', Q.desc), Q.take(1)).observe().subscribe(r => setD(r[0] ?? null))
    return () => sub.unsubscribe()
  }, [])
  return d
}
function useForsteVare() {
  const [p, setP] = useState<Product | null>(null)
  useEffect(() => {
    const sub = database.get<Product>('products').query(Q.where('image_url', Q.notEq(null)), Q.sortBy('updated_at', Q.desc), Q.take(1)).observe().subscribe(r => setP(r[0] ?? null))
    return () => sub.unsubscribe()
  }, [])
  return p
}

/** Antall aktive prosjekter — ett tall til instrumentpanelet. */
function useAktiveProsjekter() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const sub = database.get<Project>('projects').query(Q.where('status', 'aktiv')).observeCount().subscribe(setN)
    return () => sub.unsubscribe()
  }, [])
  return n
}

/** Nå-været, cachet i lib/weather. Sted fra neste ordres adresse. */
function useVaer(sted: string | undefined) {
  const [vaer, setVaer] = useState<VaerNaa | null>(null)
  useEffect(() => {
    let stopp = false
    getVaerNaa(sted || 'Bergen').then(v => { if (!stopp) setVaer(v) })
    return () => { stopp = true }
  }, [sted])
  return vaer
}

const VAER_IKON: Record<VaerSymbol, { Icon: LucideIcon; farge: string }> = {
  regn: { Icon: CloudDrizzle, farge: colors.weatherRain },
  sno: { Icon: CloudSnow, farge: colors.weatherRain },
  sol: { Icon: Sun, farge: colors.weatherSun },
  natt: { Icon: Moon, farge: colors.weatherMoon },
  skyet: { Icon: Cloud, farge: colors.secondaryLabel },
}

/** Været står ved merket: ETT farget ikon + grader. Ingen egen linje. */
function Vaer({ vaer }: { vaer: VaerNaa | null }) {
  const V = vaer?.ok ? VAER_IKON[vaer.symbol] : null
  if (!V || !vaer?.ok) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 1, marginRight: spacing.sm }}>
      <V.Icon size={16} color={V.farge} strokeWidth={2} />
      <Text style={[t.subhead, { fontWeight: '600', color: colors.label, fontVariant: ['tabular-nums'] }]}>
        {vaer.temp}°
      </Text>
    </View>
  )
}

/** PLATEN — neste ordre. Hele platen er kontrollen; ingen knapp, ingen chevron.
 *  Kartet øverst er stedet du skal — det leses før navnet, og gjør platen til
 *  et sted i stedet for en overskrift. Rendres først når geokodingen har svart. */
function Platen({ order }: { order: Order }) {
  const tid = formatTime(order.scheduledAt)
  const etikett = [plateEtikett(order.scheduledAt ?? undefined), tid].filter(Boolean).join(' · ')
  const aapne = () => router.push(`/(app)/ordre/${order.id}`)
  return (
    <View style={[{ marginHorizontal: spacing.screen, borderRadius: radius.hero }, shadows.card]}>
      <View style={{ borderRadius: radius.hero, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator }}>
        {!!order.address && <AddressMap address={order.address} onPress={aapne} height={170} chrome={false} />}
        <Pressable haptic="medium" pressScale={0.985} onPress={aapne} style={{ padding: spacing.xl, paddingTop: spacing.lg }}>
          <Text style={[t.eyebrow, { textTransform: 'uppercase' }]}>{etikett}</Text>
          <Text
            numberOfLines={2}
            style={{
              fontSize: 34, lineHeight: 37, fontWeight: '600', letterSpacing: -1.1,
              color: colors.label, marginTop: spacing.md,
            }}
          >
            {order.title}
          </Text>
          {!!order.address && (
            <Text style={[t.callout, { color: colors.labelMuted, marginTop: spacing.sm - 2 }]} numberOfLines={1}>
              {order.address}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  )
}

/** Tre stat-chips (referansen): tallet med oransje ikonflekk, ordet under. */
function Instrumenter({ stoppIDag, oppgaver, prosjekter }: { stoppIDag: number; oppgaver: number; prosjekter: number }) {
  const fliser: { tall: number; label: string; onPress: () => void }[] = [
    { tall: stoppIDag, label: 'stopp i dag', onPress: () => router.push('/(app)/ordre') },
    { tall: oppgaver, label: 'oppgaver', onPress: () => router.push('/(app)/prosjekter') },
    { tall: prosjekter, label: 'prosjekter', onPress: () => router.push('/(app)/prosjekter') },
  ]
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.screen, marginTop: spacing.md }}>
      {fliser.map(f => (
        <Pressable key={f.label} haptic="light" pressScale={0.97} onPress={f.onPress}
          style={{ flex: 1, alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.separator, paddingVertical: spacing.md, paddingHorizontal: spacing.md }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[t.subhead, { fontWeight: '700', color: f.tall > 0 ? colors.label : colors.tertiaryLabel, fontVariant: ['tabular-nums'] }]}>{f.tall}</Text>
          </View>
          <Text style={[t.caption, { color: colors.secondaryLabel }]} numberOfLines={1}>{f.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

/** Bildefliser (referansens «Category»): ekte innhold — tegning, kart, vare. */
function Fliser({ tegning, vare }: { tegning: Drawing | null; vare: Product | null }) {
  const H = 116
  return (
    <View style={{ marginTop: spacing.screen }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: spacing.screen, marginBottom: spacing.sm }}>
        <Text style={t.title3}>Gå til</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.screen }}>
        <Pressable haptic="light" pressScale={0.97} onPress={() => router.push('/(app)/prosjekter')}
          style={{ flex: 1, height: H, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.fill }}>
          {tegning ? <DrawingThumb filePath={tegning.filePath} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} /> : null}
          <View style={{ position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm, backgroundColor: 'rgba(29,29,31,0.78)', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
            <Text style={[t.caption, { color: '#FFFFFF', fontWeight: '600' }]}>Tegninger</Text>
          </View>
        </Pressable>
        <Pressable haptic="light" pressScale={0.97} onPress={() => router.push('/(app)/lager')}
          style={{ flex: 1, height: H, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.separator }}>
          {vare?.imageUrl ? <Image source={{ uri: vare.imageUrl }} style={{ position: 'absolute', left: 8, right: 8, top: 4, bottom: 28 }} resizeMode="contain" /> : null}
          <View style={{ position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm, backgroundColor: 'rgba(29,29,31,0.78)', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
            <Text style={[t.caption, { color: '#FFFFFF', fontWeight: '600' }]}>Lager</Text>
          </View>
        </Pressable>
        <Pressable haptic="light" pressScale={0.97} onPress={() => router.push('/(app)/ordre')}
          style={{ flex: 1, height: H, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Plus size={28} color="#FFFFFF" strokeWidth={2.4} />
          <Text style={[t.caption, { color: '#FFFFFF', fontWeight: '600', marginTop: 4 }]}>Ny ordre</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** Rolig tom tilstand — ingen ordrer betyr stillhet, ikke en plakat. */
function TomPlate() {
  return (
    <View style={{
      marginHorizontal: spacing.screen, backgroundColor: colors.bg,
      borderRadius: radius.hero, borderWidth: 1, borderColor: colors.separator,
      padding: spacing.xl, alignItems: 'center', ...shadows.card,
    }}>
      <CircleCheck size={sizes.iconLg} color={colors.brand} strokeWidth={sizes.lucideStroke} />
      <Text style={[t.headline, { marginTop: spacing.md }]}>Ingen ordrer i dag</Text>
      <Text style={[t.footnote, { marginTop: spacing.xs }]}>Nye ordre dukker opp her.</Text>
    </View>
  )
}

/** Agendaen — resten av dagen som ren tekst. Rennen toner ut der dagen
 *  slutter, og den står ALLTID når det finnes en neste ordre: linja med
 *  messing-prikken er skjermens signatur, også når dagen bare har ett stopp. */
function Agenda({ stopp, harNeste }: { stopp: Order[]; harNeste: boolean }) {
  if (!harNeste) return null
  return (
    <View style={{ marginHorizontal: spacing.screen + spacing.xs, marginTop: spacing.xl, paddingLeft: spacing.xl }}>
      {/* Rennen: 2 px, toner ut. Messing finnes ETT sted — neste-prikken. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 4, bottom: 8, width: 2, borderRadius: 2 }}>
        <LinearGradient colors={['rgba(29,29,31,0.12)', 'rgba(29,29,31,0)']} style={{ flex: 1, borderRadius: 2 }} />
      </View>
      <View pointerEvents="none" style={{
        position: 'absolute', left: -6, top: -2,
        width: 14, height: 14, borderRadius: 7,
        backgroundColor: colors.brandWash, alignItems: 'center', justifyContent: 'center',
      }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />
      </View>
      {stopp.length === 0 && (
        <Text style={[t.footnote, { paddingVertical: spacing.sm }]}>Ingen flere stopp i dag</Text>
      )}
      {stopp.map(o => (
        <Pressable
          key={o.id}
          onPress={() => router.push(`/(app)/ordre/${o.id}`)}
          style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.md - 2, paddingVertical: spacing.sm }}
        >
          <Text style={{
            width: 46, fontSize: 15, fontWeight: '600', letterSpacing: -0.2,
            color: colors.label, fontVariant: ['tabular-nums'],
          }}>
            {formatTime(o.scheduledAt) || '—'}
          </Text>
          <Text style={[t.subhead, { flex: 1, fontWeight: '500', color: colors.labelMuted }]} numberOfLines={1}>
            {o.title}
            {!!o.address && <Text style={[t.subhead, { color: colors.secondaryLabel }]}>{'  ·  ' + o.address}</Text>}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

/** Inbox-rad på papir: hak av til venstre, trykk rad → tegningen/prosjektet. */
function InboxRow({ task, last }: { task: Task; last: boolean }) {
  return (
    <Pressable
      onPress={() => task.drawingId
        ? router.push({ pathname: '/(app)/prosjekter/tegning', params: { drawingId: task.drawingId } })
        : router.push(`/(app)/prosjekter/${task.projectId}`)}
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
      ]}
    >
      <Pressable haptic="light" hitSlop={10} onPress={() => toggleTaskDone(task)}>
        <Circle size={sizes.icon} color={colors.tertiaryLabel} strokeWidth={2} />
      </Pressable>
      <View style={{ flex: 1, marginHorizontal: spacing.md }}>
        <Text style={[t.bodyMedium]} numberOfLines={2}>{task.title}</Text>
        {!!task.fristAt && (
          <Text style={[t.caption, { marginTop: 1 }]}>
            Frist {task.fristAt.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
          </Text>
        )}
      </View>
      {task.kind === 'lidar_scan' && <ScanSearch size={16} color={colors.brand} strokeWidth={sizes.lucideStroke} />}
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} style={{ marginLeft: spacing.sm }} />
    </Pressable>
  )
}


export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  // Papir-grunn → mørk statuslinje mens fanen er i fokus.
  useFocusEffect(useCallback(() => { setStatusBarStyle('dark') }, []))

  const orders = useOpenOrders()
  const userId = useUserId()
  const myTasks = useMyTasks(userId)
  const aktiveProsjekter = useAktiveProsjekter()
  const navn = useUserName()
  const forsteTegning = useForsteTegning()
  const forsteVare = useForsteVare()

  // Platen = første ordre som ikke er passert (30 min slingring); agendaen =
  // resten av SAMME dag. Uten tidsatte ordrer faller platen tilbake til første
  // åpne ordre, så skjermen aldri er tom mens det finnes arbeid.
  const naa = Date.now()
  const medTid = orders.filter(o => o.scheduledAt)
  const kommende = medTid.filter(o => (o.scheduledAt as Date).getTime() >= naa - 30 * 60 * 1000)
  const neste = kommende[0] ?? medTid[medTid.length - 1] ?? orders[0]
  const agenda = neste?.scheduledAt
    ? kommende.filter(o => o.id !== neste.id && sammeDag(o.scheduledAt as Date, neste.scheduledAt as Date))
    : []

  const vaer = useVaer(neste?.address || undefined)
  const siste = [...orders].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).filter(o => o.id !== neste?.id).slice(0, 3)


  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Animated.ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.md,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Velkomstraden (referansen): avatar · «Velkommen, Tormod» · vær. */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
        }}>
          <MegAvatar size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[t.caption, { color: colors.secondaryLabel }]}>
              {new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' })}
            </Text>
            <Text style={[t.title3, { marginTop: 1 }]}>{HILSEN()}{navn ? `, ${navn.split(' ')[0]}` : ''}</Text>
          </View>
          <Vaer vaer={vaer} />
        </View>

        <Animated.View entering={FadeInDown.springify()}>
          {neste ? <Platen order={neste} /> : <TomPlate />}
        </Animated.View>

        {/* SISTE ORDRE — de tre sist endrede, som liste. «Se alle» går til Ordre. */}
        <View style={{ marginTop: spacing.screen }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: spacing.screen, marginBottom: spacing.sm }}>
            <Text style={t.title3}>Siste ordre</Text>
            <Pressable haptic="light" onPress={() => router.push('/(app)/ordre')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text style={[t.subhead, { color: colors.secondaryLabel }]}>Se alle</Text>
              <ChevronRight size={15} color={colors.tertiaryLabel} strokeWidth={2.2} />
            </Pressable>
          </View>
          <View style={{ marginHorizontal: spacing.screen, borderRadius: radius.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, overflow: 'hidden' }}>
            {siste.length === 0 ? (
              <Text style={[t.footnote, { padding: spacing.lg }]}>Ingen ordre ennå.</Text>
            ) : siste.map((o, i) => (
              <Pressable key={o.id} haptic="light" onPress={() => router.push(`/(app)/ordre/${o.id}`)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.separator }}>
                <View style={{ flex: 1 }}>
                  <Text style={t.bodyMedium} numberOfLines={1}>{o.title}</Text>
                  <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>{[o.customerName, o.address].filter(Boolean).join(' · ') || 'Ingen kunde'}</Text>
                </View>
                {o.status === 'pagaar' && (
                  <View style={{ paddingHorizontal: spacing.sm, height: 22, borderRadius: radius.pill, backgroundColor: colors.label, justifyContent: 'center' }}>
                    <Text style={[t.caption, { color: '#FFFFFF', fontWeight: '600' }]}>Pågår</Text>
                  </View>
                )}
                {o.status === 'fakturaklar' && (
                  <View style={{ paddingHorizontal: spacing.sm, height: 22, borderRadius: radius.pill, backgroundColor: colors.successSoft, justifyContent: 'center' }}>
                    <Text style={[t.caption, { color: colors.success, fontWeight: '600' }]}>Klar til faktura</Text>
                  </View>
                )}
                <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
              </Pressable>
            ))}
          </View>
        </View>

        {/* TRE HURTIGVALG: Ny ordre · Ny kunde · Ny skann. */}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.screen, marginTop: spacing.lg }}>
          {([
            { label: 'Ny ordre', Icon: Plus, to: '/(app)/ordre/ny' },
            { label: 'Ny kunde', Icon: UserPlus, to: '/(app)/kunder/ny' },
            { label: 'Ny skann', Icon: ScanLine, to: '/(app)/skanner' },
          ] as const).map(h => (
            <Pressable key={h.label} haptic="medium" pressScale={0.97} onPress={() => router.push(h.to as never)}
              style={{ flex: 1, height: 84, borderRadius: radius.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, alignItems: 'flex-start', justifyContent: 'space-between', padding: spacing.md }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.label, alignItems: 'center', justifyContent: 'center' }}>
                <h.Icon size={16} color="#FFFFFF" strokeWidth={2.2} />
              </View>
              <Text style={[t.subhead, { fontWeight: '600', color: colors.label }]} numberOfLines={1}>{h.label}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.ScrollView>

    </View>
  )
}
