import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { ChevronLeft, Trash2, Lock, Minus, Plus } from 'lucide-react-native'
import { TidForing } from '../../../components/tid-foring'
import { Pressable } from '../../../components/pressable'
import { ListCard, SectionHeader } from '../../../components/ui'
import { Ark } from '../../../components/sheet'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Activity } from '../../../lib/db/models/activity'
import { TimeEntry } from '../../../lib/db/models/time-entry'
import { useAktiviteter } from '../../../lib/activities'
import { getCurrentUser } from '../../../lib/order-access'
import { formatKr, tilOre } from '../../../lib/invoicing'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'


function timerTekst(n: number): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '')).replace('.', ',')
}

function datoTekst(d: Date): string {
  const idag = new Date(); idag.setHours(0, 0, 0, 0)
  const dag = new Date(d); dag.setHours(0, 0, 0, 0)
  const diff = Math.round((idag.getTime() - dag.getTime()) / 86400000)
  if (diff === 0) return 'I dag'
  if (diff === 1) return 'I går'
  return dag.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' })
}

function Foering({ entry, aktivitet, kanSlette, onRediger }: {
  entry: TimeEntry; aktivitet: Activity | undefined; kanSlette: boolean; onRediger: () => void
}) {
  const laast = !!entry.invoicedAt

  async function slett() {
    if (laast) return
    await database.write(async () => { await entry.markAsDeleted() })
    syncQuietly()
  }

  const rad = (
    <Pressable haptic="light" disabled={laast || !kanSlette} onPress={onRediger} style={{
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      backgroundColor: colors.bg,
    }}>
      <View style={{
        minWidth: 52, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
        borderRadius: radius.md, backgroundColor: laast ? colors.fill : colors.brandSoft,
        alignItems: 'center',
      }}>
        <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'], color: laast ? colors.secondaryLabel : colors.brand }]}>
          {timerTekst(entry.hours)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={t.body} numberOfLines={1}>{aktivitet?.name ?? 'Uten aktivitet'}</Text>
        <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
          {entry.userName}{entry.note ? ` · ${entry.note}` : ''}
        </Text>
      </View>
      {laast && <Lock size={15} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />}
    </Pressable>
  )

  // Fakturerte føringer kan ikke slettes — beløpet er allerede sendt videre.
  if (laast || !kanSlette) return rad

  return (
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={36}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          haptic="medium"
          onPress={slett}
          style={{ width: 84, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', gap: 2 }}
        >
          <Trash2 size={18} color="#fff" strokeWidth={2.2} />
          <Text style={[t.caption, { color: '#fff', fontWeight: '700' }]}>Slett</Text>
        </Pressable>
      )}
    >
      {rad}
    </ReanimatedSwipeable>
  )
}

/**
 * Endre en føring (Tormod 04.11: «kan ikke endre timer»). Trykk på raden. Bare egne,
 * ufakturerte føringer — samme regel som sveip-for-å-slette. Valgene ligger i arket
 * selv (ikke et ark over arket: to Modal-er samtidig henger på iOS).
 */
function RedigerFoering({ entry, aktiviteter, onLukk }: {
  entry: TimeEntry | null; aktiviteter: Activity[]; onLukk: () => void
}) {
  const [timer, setTimer] = useState('')
  const [aktivitet, setAktivitet] = useState<string | null>(null)
  const [dato, setDato] = useState(0)
  const [notat, setNotat] = useState('')
  const [lagrer, setLagrer] = useState(false)
  useEffect(() => {
    if (!entry) return
    setTimer(timerTekst(entry.hours)); setAktivitet(entry.activityId ?? null)
    setDato(new Date(entry.date).setHours(0, 0, 0, 0)); setNotat(entry.note ?? '')
  }, [entry])

  const tall = parseFloat(timer.replace(',', '.'))
  const gyldig = Number.isFinite(tall) && tall > 0 && tall <= 24
  const datoer = useMemo(() => {
    const ds = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); return d.getTime() })
    if (dato && !ds.includes(dato)) ds.push(dato)
    return ds.sort((a, b) => b - a)
  }, [dato])

  async function lagre() {
    if (!entry || !gyldig) return
    setLagrer(true)
    try {
      await database.write(async () => {
        await entry.update(e => {
          e.hours = tall
          e.activityId = aktivitet
          e.date = new Date(dato)
          e.note = notat.trim() || null
        })
      })
      syncQuietly()
      onLukk()
    } finally { setLagrer(false) }
  }

  const chip = (aktiv: boolean) => ({
    height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, justifyContent: 'center' as const,
    backgroundColor: aktiv ? colors.label : colors.fill,
  })
  const chipTekst = (aktiv: boolean) => [t.subhead, { fontWeight: '600' as const, color: aktiv ? colors.bg : colors.label }]

  return (
    <Ark synlig={!!entry} onLukk={onLukk}>
      <View style={{ paddingHorizontal: spacing.screen, gap: spacing.lg }}>
        <Text style={t.title3}>Endre føring</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 48, borderRadius: radius.md, backgroundColor: colors.fill }}>
          <Pressable haptic="light" onPress={() => setTimer(timerTekst(Math.max(0.5, (Number.isFinite(tall) ? tall : 0) - 0.5)))}
            style={{ width: 52, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Minus size={18} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <TextInput value={timer} onChangeText={setTimer} keyboardType="decimal-pad" selectTextOnFocus
            style={[t.title3, { flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] }]} />
          <Text style={[t.body, { color: colors.secondaryLabel }]}>t</Text>
          <Pressable haptic="light" onPress={() => setTimer(timerTekst(Math.min(24, (Number.isFinite(tall) ? tall : 0) + 0.5)))}
            style={{ width: 52, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={18} color={colors.label} strokeWidth={2.2} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          {aktiviteter.map(a => (
            <Pressable key={a.id} haptic="light" onPress={() => setAktivitet(a.id)} style={chip(aktivitet === a.id)}>
              <Text style={chipTekst(aktivitet === a.id)}>{a.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          {datoer.map(d => (
            <Pressable key={d} haptic="light" onPress={() => setDato(d)} style={chip(dato === d)}>
              <Text style={chipTekst(dato === d)}>{datoTekst(new Date(d))}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <TextInput value={notat} onChangeText={setNotat} placeholder="Notat"
          style={[t.body, { height: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.fill }]} />

        <Pressable haptic="medium" disabled={!gyldig || lagrer} onPress={lagre}
          style={{ height: 50, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: gyldig ? colors.brand : colors.fill }}>
          <Text style={[t.headline, { color: gyldig ? colors.brandLabel : colors.tertiaryLabel }]}>{lagrer ? 'Lagrer …' : 'Lagre'}</Text>
        </Pressable>
      </View>
    </Ark>
  )
}

export default function TimerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const aktiviteter = useAktiviteter()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [meg, setMeg] = useState<{ id: string; name: string } | null>(null)
  const [redigerer, setRedigerer] = useState<TimeEntry | null>(null)

  useEffect(() => { getCurrentUser().then(u => u && setMeg({ id: u.id, name: u.name })) }, [])

  useEffect(() => {
    if (!id) return
    const sub = database.get<TimeEntry>('time_entries')
      .query(Q.where('order_id', id), Q.sortBy('date', Q.desc), Q.sortBy('created_at', Q.desc))
      .observeWithColumns(['hours', 'note', 'activity_id', 'invoiced_at', 'date'])
      .subscribe(setEntries)
    return () => sub.unsubscribe()
  }, [id])

  const aMap = useMemo(() => new Map(aktiviteter.map(a => [a.id, a])), [aktiviteter])

  const { sumTimer, sumOre } = useMemo(() => {
    let ts = 0, ore = 0
    for (const e of entries) {
      ts += e.hours
      const a = e.activityId ? aMap.get(e.activityId) : undefined
      if (a?.billable && a.hourlyRate != null) ore += Math.round(e.hours * tilOre(a.hourlyRate))
    }
    return { sumTimer: ts, sumOre: ore }
  }, [entries, aMap])

  // Gruppering per dag — en timeliste leses dagvis, ikke som én lang strøm.
  const dager = useMemo(() => {
    const kart = new Map<number, TimeEntry[]>()
    for (const e of entries) {
      const key = new Date(e.date).setHours(0, 0, 0, 0)
      const bøtte = kart.get(key)
      if (bøtte) bøtte.push(e); else kart.set(key, [e])
    }
    return [...kart.entries()].sort((a, b) => b[0] - a[0])
  }, [entries])

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={t.title2}>Timer</Text>
        </View>
      </View>


      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        <View style={{ marginBottom: spacing.xl }}>
          <TidForing orderId={id ?? ''} />
        </View>

        {dager.length === 0 ? (
          <View style={{ paddingHorizontal: spacing.screen + spacing.lg }}>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>
              Ingen timer
            </Text>
          </View>
        ) : (
          dager.map(([dagMs, rader]) => (
            <View key={dagMs} style={{ marginBottom: spacing.lg }}>
              <SectionHeader>
                {`${datoTekst(new Date(dagMs))}  ·  ${timerTekst(rader.reduce((a, e) => a + e.hours, 0))} t`}
              </SectionHeader>
              <ListCard>
                {rader.map((e, i) => (
                  <View key={e.id} style={i === rader.length - 1 ? undefined : {
                    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
                  }}>
                    <Foering
                      entry={e}
                      aktivitet={e.activityId ? aMap.get(e.activityId) : undefined}
                      kanSlette={e.userId === meg?.id}
                      onRediger={() => setRedigerer(e)}
                    />
                  </View>
                ))}
              </ListCard>
            </View>
          ))
        )}
      </ScrollView>
      <RedigerFoering entry={redigerer} aktiviteter={aktiviteter} onLukk={() => setRedigerer(null)} />
    </View>
  )
}
