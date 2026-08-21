import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { ChevronLeft, Trash2, Lock, Plus } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ListCard, SectionHeader, Chip } from '../../../components/ui'
import { ChoiceSheet } from '../../../components/sheet'
import { AmpexMarkButton } from '../../../components/ampex-mark-button'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Activity } from '../../../lib/db/models/activity'
import { TimeEntry } from '../../../lib/db/models/time-entry'
import { useAktiviteter } from '../../../lib/activities'
import { getCurrentUser } from '../../../lib/order-access'
import { formatKr, tilOre } from '../../../lib/invoicing'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/** Vanligste føringene, ett trykk unna. En halv dag og en hel dag dekker mest. */
const HURTIGTIMER = [1, 2, 3.5, 4, 7.5]

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

function Foering({ entry, aktivitet, kanSlette }: {
  entry: TimeEntry; aktivitet: Activity | undefined; kanSlette: boolean
}) {
  const laast = !!entry.invoicedAt

  async function slett() {
    if (laast) return
    await database.write(async () => { await entry.markAsDeleted() })
    syncQuietly()
  }

  const rad = (
    <View style={{
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
    </View>
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

export default function TimerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const aktiviteter = useAktiviteter()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [valgtAktivitet, setValgtAktivitet] = useState<string | null>(null)
  const [timer, setTimer] = useState('')
  const [notat, setNotat] = useState('')
  const [dato, setDato] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [lagrer, setLagrer] = useState(false)
  const [meg, setMeg] = useState<{ id: string; name: string } | null>(null)
  const [velgerDato, setVelgerDato] = useState(false)

  useEffect(() => { getCurrentUser().then(u => u && setMeg({ id: u.id, name: u.name })) }, [])

  useEffect(() => {
    if (!id) return
    const sub = database.get<TimeEntry>('time_entries')
      .query(Q.where('order_id', id), Q.sortBy('date', Q.desc), Q.sortBy('created_at', Q.desc))
      .observeWithColumns(['hours', 'note', 'activity_id', 'invoiced_at'])
      .subscribe(setEntries)
    return () => sub.unsubscribe()
  }, [id])

  // Første fakturerbare aktivitet som standard — montasje i praksis.
  useEffect(() => {
    if (!valgtAktivitet && aktiviteter.length) {
      setValgtAktivitet((aktiviteter.find(a => a.billable) ?? aktiviteter[0]).id)
    }
  }, [aktiviteter, valgtAktivitet])

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

  const timerTall = parseFloat(timer.replace(',', '.'))
  const kanFoere = !!id && !!meg && Number.isFinite(timerTall) && timerTall > 0 && timerTall <= 24 && !lagrer

  async function foer() {
    if (!kanFoere || !meg) return
    setLagrer(true)
    try {
      await database.write(async () => {
        await database.get<TimeEntry>('time_entries').create(e => {
          e.orderId = id as string
          e.userId = meg.id
          e.userName = meg.name || 'Meg'
          e.date = dato
          e.hours = timerTall
          e.note = notat.trim() || null
          e.activityId = valgtAktivitet
        })
      })
      syncQuietly()
      setTimer(''); setNotat('')
    } finally { setLagrer(false) }
  }

  // Bakover i tid er det eneste realistiske: man fører gårsdagens timer, ikke
  // morgendagens. Sju dager dekker en glemt uke.
  //
  // Eget ark og ikke Alert: Android viser MAKS TRE knapper, så sju datoer ble
  // til fire tapte valg der.
  const datoValg = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
    return { verdi: d.getTime(), etikett: datoTekst(d) }
  })

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ChevronLeft size={26} color={colors.label} strokeWidth={sizes.lucideStroke} />
          </Pressable>
          <Text style={t.headline}>Timer</Text>
        </View>
        {/* Merket ER assistenten: «før sju og en halv time montasje» gjør det samme. */}
        <AmpexMarkButton />
      </View>

      <ChoiceSheet<number>
        synlig={velgerDato}
        tittel="Dato"
        valg={datoValg}
        valgt={dato.getTime()}
        onVelg={ms => { setDato(new Date(ms)); setVelgerDato(false) }}
        onAvbryt={() => setVelgerDato(false)}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.xl }}>
          <Text style={t.display}>{timerTekst(sumTimer)} t</Text>
          {sumOre > 0 && (
            <Text style={[t.footnote, { marginTop: spacing.xs }]}>{formatKr(sumOre)} eks. mva</Text>
          )}
        </View>

        {/* Føringsflaten. Ligger ØVERST fordi det er det man kom hit for å gjøre. */}
        <ListCard style={{ marginBottom: spacing.xl }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md }}>
            {aktiviteter.map(a => (
              <Chip
                key={a.id}
                label={a.name}
                selected={valgtAktivitet === a.id}
                onPress={() => setValgtAktivitet(a.id)}
              />
            ))}
          </View>

          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
            paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
          }}>
            {HURTIGTIMER.map(h => (
              <Chip
                key={h}
                label={`${timerTekst(h)} t`}
                selected={timerTall === h}
                onPress={() => setTimer(String(h))}
              />
            ))}
          </View>

          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
            borderTopWidth: 0.5, borderTopColor: colors.separator,
          }}>
            <Pressable onPress={() => setVelgerDato(true)} hitSlop={8}>
              <Text style={[t.body, { color: colors.brand }]}>{datoTekst(dato)}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <TextInput
              value={timer}
              onChangeText={setTimer}
              placeholder="0"
              placeholderTextColor={colors.tertiaryLabel}
              keyboardType="decimal-pad"
              selectTextOnFocus
              style={[t.title3, { minWidth: 56, textAlign: 'right', fontVariant: ['tabular-nums'] }]}
            />
            <Text style={[t.body, { color: colors.secondaryLabel }]}>t</Text>
          </View>

          <TextInput
            value={notat}
            onChangeText={setNotat}
            placeholder="Hva ble gjort — kunden ser dette på fakturaen"
            placeholderTextColor={colors.tertiaryLabel}
            style={[t.body, {
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
              borderTopWidth: 0.5, borderTopColor: colors.separator,
            }]}
            returnKeyType="done"
            onSubmitEditing={foer}
          />

          <Pressable
            haptic="medium"
            onPress={foer}
            disabled={!kanFoere}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              height: sizes.ctaHeight, backgroundColor: colors.cta, opacity: kanFoere ? 1 : 0.35,
            }}
          >
            <Plus size={18} color={colors.ctaLabel} strokeWidth={sizes.lucideStroke} />
            <Text style={[t.headline, { color: colors.ctaLabel }]}>Før timer</Text>
          </Pressable>
        </ListCard>

        {dager.length === 0 ? (
          <View style={{ paddingHorizontal: spacing.screen + spacing.lg }}>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>
              Ingen timer ført ennå.
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
                    />
                  </View>
                ))}
              </ListCard>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}
