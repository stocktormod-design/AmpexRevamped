import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { Q } from '@nozbe/watermelondb'
import { Check, ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react-native'
import { Text, TextInput } from './text'
import { Pressable } from './pressable'
import { ChoiceSheet } from './sheet'
import { database } from '../lib/db'
import { syncQuietly } from '../lib/db/sync'
import { TimeEntry } from '../lib/db/models/time-entry'
import { useAktiviteter } from '../lib/activities'
import { getCurrentUser } from '../lib/order-access'
import { formatKr, tilOre } from '../lib/invoicing'
import { colors, spacing, radius, type as t } from '../lib/theme'

/**
 * TID — tilstanden først, redigeringen foldet inn.
 *
 * Overskriftsraden viser det som ER ført (som Teslas «Klima 21°»). Under står
 * én kontrollinje: timetypen som en pille, varigheten med −/+, og «Før».
 * Timetypene folder ut som rader UNDER pillen når du trykker på den — ett
 * trykk velger og folder inn igjen. Ingen stoppeklokke. Dato og notat er
 * unntak og ligger bak én liten lenke. Ingen kort rundt: hårlinjer og luft.
 */
const HURTIGTIMER = [1, 2, 4, 7.5]

export function timerTekst(n: number): string {
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

export function useOrdreTimer(orderId: string) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  useEffect(() => {
    if (!orderId) return
    const sub = database.get<TimeEntry>('time_entries')
      .query(Q.where('order_id', orderId), Q.sortBy('date', Q.desc), Q.sortBy('created_at', Q.desc))
      .observeWithColumns(['hours', 'note', 'activity_id', 'invoiced_at'])
      .subscribe(setEntries)
    return () => sub.unsubscribe()
  }, [orderId])
  return entries
}

/** Seksjonshode uten eyebrow: navnet i normal vekt, verdien til høyre. */
export function SeksjonsRad({ navn, verdi, onPress }: { navn: string; verdi: string; onPress?: () => void }) {
  return (
    <Pressable haptic="light" onPress={onPress} disabled={!onPress}
      style={{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: spacing.screen, paddingTop: spacing.xl, paddingBottom: spacing.sm }}>
      <Text style={[t.title3, { flex: 1 }]}>{navn}</Text>
      <Text style={[t.title3, { fontVariant: ['tabular-nums'], color: colors.secondaryLabel }]}>{verdi}</Text>
      {onPress && <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={2} style={{ marginLeft: 4, alignSelf: 'center' }} />}
    </Pressable>
  )
}

export function TidForing({ orderId, onSum }: { orderId: string; onSum?: () => void }) {
  const aktiviteter = useAktiviteter()
  const entries = useOrdreTimer(orderId)
  const [valgtAktivitet, setValgtAktivitet] = useState<string | null>(null)
  const [timer, setTimer] = useState('')
  const [notat, setNotat] = useState('')
  const [dato, setDato] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [lagrer, setLagrer] = useState(false)
  const [meg, setMeg] = useState<{ id: string; name: string } | null>(null)
  const [velgerDato, setVelgerDato] = useState(false)
  const [velgerType, setVelgerType] = useState(false)
  const [ekstra, setEkstra] = useState(false)

  useEffect(() => { getCurrentUser().then(u => u && setMeg({ id: u.id, name: u.name })) }, [])
  useEffect(() => {
    if (!valgtAktivitet && aktiviteter.length) setValgtAktivitet((aktiviteter.find(a => a.billable) ?? aktiviteter[0]).id)
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

  const timerTall = parseFloat(timer.replace(',', '.'))
  const kanFoere = !!orderId && !!meg && Number.isFinite(timerTall) && timerTall > 0 && timerTall <= 24 && !lagrer
  const valgt = valgtAktivitet ? aMap.get(valgtAktivitet) : undefined

  async function foer() {
    if (!kanFoere || !meg) return
    setLagrer(true)
    try {
      await database.write(async () => {
        await database.get<TimeEntry>('time_entries').create(e => {
          e.orderId = orderId
          e.userId = meg.id
          e.userName = meg.name || 'Meg'
          e.date = dato
          e.hours = timerTall
          e.note = notat.trim() || null
          e.activityId = valgtAktivitet
        })
      })
      syncQuietly()
      setTimer(''); setNotat(''); setEkstra(false)
    } finally { setLagrer(false) }
  }

  const datoValg = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
    return { verdi: d.getTime(), etikett: datoTekst(d) }
  })

  const sumTekst = sumTimer > 0 ? `${timerTekst(sumTimer)} t${sumOre > 0 ? ` · ${formatKr(sumOre)}` : ''}` : '0 t'

  return (
    <View>
      <SeksjonsRad navn="Tid" verdi={sumTekst} onPress={entries.length > 0 ? onSum : undefined} />

      {/* Kontrollinja: type · varighet · før */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.screen }}>
        <Pressable haptic="light" pressScale={0.97} onPress={() => setVelgerType(v => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingLeft: spacing.md, paddingRight: spacing.sm, borderRadius: radius.md, backgroundColor: colors.fill, maxWidth: 160 }}>
          <Text style={[t.subhead, { fontWeight: '600', color: colors.label, flexShrink: 1 }]} numberOfLines={1}>{valgt?.name ?? 'Timetype'}</Text>
          <ChevronDown size={15} color={colors.secondaryLabel} strokeWidth={2.2} style={{ transform: [{ rotate: velgerType ? '180deg' : '0deg' }] }} />
        </Pressable>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, height: 40, borderRadius: radius.md, backgroundColor: colors.fill }}>
          <Pressable haptic="light" hitSlop={6} onPress={() => setTimer(String(Math.max(0, (Number.isFinite(timerTall) ? timerTall : 0) - 0.5)))}
            style={{ width: 36, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Minus size={16} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <TextInput value={timer} onChangeText={setTimer} placeholder="0" placeholderTextColor={colors.tertiaryLabel}
            keyboardType="decimal-pad" selectTextOnFocus
            style={[t.headline, { minWidth: 34, textAlign: 'center', fontVariant: ['tabular-nums'] }]} />
          <Text style={[t.footnote, { color: colors.secondaryLabel, marginRight: 2 }]}>t</Text>
          <Pressable haptic="light" hitSlop={6} onPress={() => setTimer(String(Math.min(24, (Number.isFinite(timerTall) ? timerTall : 0) + 0.5)))}
            style={{ width: 36, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={16} color={colors.label} strokeWidth={2.2} />
          </Pressable>
        </View>
        <Pressable haptic="medium" pressScale={0.96} onPress={foer} disabled={!kanFoere}
          style={{ height: 40, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.label, alignItems: 'center', justifyContent: 'center', opacity: kanFoere ? 1 : 0.3 }}>
          <Text style={[t.subhead, { fontWeight: '600', color: '#FFFFFF' }]}>Før</Text>
        </Pressable>
      </View>

      {/* Timetypene folder ut under pillen. Ett trykk velger. */}
      {velgerType && (
        <View style={{ marginHorizontal: spacing.screen, marginTop: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.fill, overflow: 'hidden' }}>
          {aktiviteter.map((a, i) => {
            const er = valgtAktivitet === a.id
            return (
              <Pressable key={a.id} haptic="light" onPress={() => { setValgtAktivitet(a.id); setVelgerType(false) }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, height: 44, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(29,29,31,0.06)' }}>
                <Text style={[t.body, { flex: 1, color: colors.label, fontWeight: er ? '600' : '400' }]} numberOfLines={1}>{a.name}</Text>
                <Text style={[t.footnote, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>
                  {a.billable ? (a.hourlyRate != null ? `${a.hourlyRate} kr/t` : 'Fakturerbar') : 'Ikke fakturerbar'}
                </Text>
                {er && <Check size={16} color={colors.label} strokeWidth={2.5} />}
              </Pressable>
            )
          })}
        </View>
      )}

      {/* Hurtigvalg + unntakene (dato/notat) på én stille linje */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.screen, marginTop: spacing.sm }}>
        {HURTIGTIMER.map(h => (
          <Pressable key={h} haptic="light" onPress={() => setTimer(String(h))} hitSlop={6}
            style={{ height: 28, paddingHorizontal: spacing.sm + 2, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: timerTall === h ? colors.label : 'transparent', borderWidth: 1, borderColor: timerTall === h ? colors.label : colors.separator }}>
            <Text style={[t.caption, { fontWeight: '600', color: timerTall === h ? '#FFFFFF' : colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>{timerTekst(h)} t</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable haptic="light" onPress={() => setEkstra(v => !v)} hitSlop={8}>
          <Text style={[t.caption, { color: colors.secondaryLabel, fontWeight: '600' }]}>{ekstra ? 'Skjul' : `${datoTekst(dato)} · notat`}</Text>
        </Pressable>
      </View>
      {ekstra && (
        <View style={{ marginHorizontal: spacing.screen, marginTop: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.fill, overflow: 'hidden' }}>
          <Pressable haptic="light" onPress={() => setVelgerDato(true)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, height: 44 }}>
            <Text style={[t.footnote, { width: 56, color: colors.secondaryLabel }]}>Dato</Text>
            <Text style={[t.body, { flex: 1, color: colors.label }]}>{datoTekst(dato)}</Text>
            <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={2} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, height: 44, borderTopWidth: 1, borderTopColor: 'rgba(29,29,31,0.06)' }}>
            <Text style={[t.footnote, { width: 56, color: colors.secondaryLabel }]}>Notat</Text>
            <TextInput value={notat} onChangeText={setNotat} placeholder="Hva ble gjort — kunden ser dette" placeholderTextColor={colors.tertiaryLabel}
              style={[t.body, { flex: 1 }]} returnKeyType="done" onSubmitEditing={foer} />
          </View>
        </View>
      )}

      <ChoiceSheet<number> synlig={velgerDato} tittel="Dato" valg={datoValg} valgt={dato.getTime()}
        onVelg={ms => { setDato(new Date(ms)); setVelgerDato(false) }} onAvbryt={() => setVelgerDato(false)} />
    </View>
  )
}
