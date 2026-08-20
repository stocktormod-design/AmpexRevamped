import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft, ChevronRight, ChevronLeft as Prev } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { SectionHeader, AmbientBackdrop } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import {
  DAGER, flyttUke, formatTimer, ukeEtikett, ukenummer, ukeStart, useUkeliste,
} from '../../lib/timesheet'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../lib/theme'

/** Normal norsk arbeidsuke. Brukes kun som referanselinje i søylene. */
const NORMALUKE = 37.5

/**
 * Mine timer — én person, én uke.
 *
 * Dette er lønnsgrunnlaget, og det er spørsmålet hver eneste fredag. Ordrene
 * svarer på hva jobben koster; denne svarer på hva uken ble.
 */
export default function MineTimer() {
  const insets = useSafeAreaInsets()
  const [meg, setMeg] = useState<string | null>(null)
  const [start, setStart] = useState(() => ukeStart(new Date()))
  const uke = useUkeliste(meg, start)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMeg(data.session?.user.id ?? null))
  }, [])

  const idag = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }, [])
  const maksDag = Math.max(NORMALUKE / 5, ...uke.dager.map(d => d.timer))

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AmbientBackdrop height={300} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.display, { marginTop: spacing.lg }]}>Mine timer</Text>
        </View>

        {/* Ukevelger */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          marginHorizontal: spacing.screen, marginTop: spacing.lg,
          backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.sm,
        }}>
          <Pressable haptic="light" pressScale={0.92} onPress={() => setStart(s => flyttUke(s, -1))}
            style={{ width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}>
            <Prev size={18} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={t.headline}>{ukeEtikett(start)}</Text>
            <Text style={t.caption}>
              {`Uke ${ukenummer(start)} · ${start.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}–${uke.dager[6].dato.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}`}
            </Text>
          </View>
          <Pressable haptic="light" pressScale={0.92} onPress={() => setStart(s => flyttUke(s, 1))}
            style={{ width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronRight size={18} color={colors.label} strokeWidth={2.2} />
          </Pressable>
        </View>

        {/* Sum + søyler */}
        <View style={[{
          marginHorizontal: spacing.screen, marginTop: spacing.md,
          backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.lg,
        }, shadows.card]}>
          {/* Ukesummen er lønnsgrunnlaget — skjermens ene hovedsak. */}
          <Text style={[t.caption, { textTransform: 'uppercase', letterSpacing: 0.6 }]}>Denne uken</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 }}>
            <Text style={[t.display, { fontVariant: ['tabular-nums'] }]}>{formatTimer(uke.sumTimer)}</Text>
            <Text style={t.footnote}>{`av ${formatTimer(NORMALUKE)} normal`}</Text>
          </View>
          {uke.ikkeFakturerbare > 0 && (
            <Text style={[t.footnote, { color: colors.warning, marginTop: 2 }]}>
              {`${formatTimer(uke.ikkeFakturerbare)} er ikke fakturerbart`}
            </Text>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: 116, marginTop: spacing.lg }}>
            {uke.dager.map((d, i) => {
              const erIdag = d.dato.getTime() === idag
              const helg = i >= 5
              return (
                <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: 4 }]}>
                    {d.timer > 0 ? String(Math.round(d.timer * 10) / 10).replace('.', ',') : ''}
                  </Text>
                  <View style={{
                    width: '100%',
                    // Minimum 3 px så en dag med 0,25 t fortsatt er synlig.
                    height: Math.max(d.timer > 0 ? 3 : 0, (d.timer / maksDag) * 74),
                    borderRadius: radius.sm,
                    backgroundColor: helg ? colors.warning : colors.brand,
                  }} />
                  <Text style={[t.caption, {
                    marginTop: spacing.xs,
                    color: erIdag ? colors.label : colors.tertiaryLabel,
                    fontWeight: erIdag ? '700' : '400',
                  }]}>
                    {DAGER[i]}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>

        {uke.sumTimer === 0 ? (
          <Text style={[t.footnote, { textAlign: 'center', marginTop: spacing.xxl }]}>
            Ingen timer ført denne uken.
          </Text>
        ) : (
          <>
            <SectionHeader>Hva uken gikk med til</SectionHeader>
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
              {uke.perOrdre.map((o, i, arr) => (
                <Pressable
                  key={o.orderId}
                  onPress={() => router.push({ pathname: '/(app)/ordre/[id]', params: { id: o.orderId } })}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                    i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                  ]}
                >
                  <Text style={[t.body, { flex: 1 }]} numberOfLines={1}>{o.tittel}</Text>
                  <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatTimer(o.timer)}</Text>
                  <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} style={{ marginLeft: spacing.sm }} />
                </Pressable>
              ))}
            </View>

            <SectionHeader>Per aktivitet</SectionHeader>
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
              {uke.perAktivitet.map((a, i, arr) => (
                <View key={a.aktivitetId ?? 'ingen'} style={[
                  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
                  i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                ]}>
                  <Text style={[t.body, { flex: 1 }]} numberOfLines={1}>{a.navn}</Text>
                  <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatTimer(a.timer)}</Text>
                </View>
              ))}
            </View>

            <SectionHeader>Dag for dag</SectionHeader>
            <View style={{ marginHorizontal: spacing.screen, gap: spacing.sm }}>
              {uke.dager.filter(d => d.linjer.length > 0).map(d => (
                <View key={d.dato.toISOString()} style={{ backgroundColor: colors.bg, borderRadius: radius.lg, overflow: 'hidden' }}>
                  <View style={{
                    flexDirection: 'row', justifyContent: 'space-between',
                    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
                    backgroundColor: colors.fill,
                  }}>
                    <Text style={[t.subhead, { fontWeight: '600' }]}>
                      {d.dato.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' })}
                    </Text>
                    <Text style={[t.subhead, { fontWeight: '600' }]}>{formatTimer(d.timer)}</Text>
                  </View>
                  {d.linjer.map(l => (
                    <Pressable
                      key={l.id}
                      onPress={() => router.push({ pathname: '/(app)/ordre/timer', params: { id: l.orderId } })}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={t.body} numberOfLines={1}>
                          {uke.perOrdre.find(o => o.orderId === l.orderId)?.tittel ?? 'Ordre'}
                        </Text>
                        {!!l.note && <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 1 }]} numberOfLines={1}>{l.note}</Text>}
                      </View>
                      <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatTimer(l.hours)}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}
