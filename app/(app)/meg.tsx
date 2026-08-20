import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, Mic, Users, Timer, ChevronRight, CalendarClock, ShieldCheck, Archive } from 'lucide-react-native'
import { router } from 'expo-router'
import { Pressable } from '../../components/pressable'
import { AmpexMarkButton } from '../../components/ampex-mark-button'
import { useTilGodkjenning, useKanGodkjenne } from '../../lib/approvals'
import { getPreferredVoice, setPreferredVoice, VOICE_OPTIONS } from '../../lib/ai/voice-prefs'
import { colors, spacing, radius, type as t } from '../../lib/theme'

export default function Screen() {
  const tilGodkjenning = useTilGodkjenning()
  const kanGodkjenne = useKanGodkjenne()
  const insets = useSafeAreaInsets()
  const [voice, setVoice] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getPreferredVoice().then(v => {
      setVoice(v)
      setLoaded(true)
    })
  }, [])

  async function choose(id: string | null) {
    setVoice(id)
    await setPreferredVoice(id)
  }

  const rows: { id: string | null; label: string; description: string }[] = [
    { id: null, label: 'Standard', description: 'Firmaets standardstemme' },
    ...VOICE_OPTIONS,
  ]

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.xxl }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl }}>
        <Text style={t.display}>Meg</Text>
        <AmpexMarkButton />
      </View>

      {/* Faglig godkjenning står først når noe faktisk venter — det er en
          forskriftsfestet oppgave med en kø, ikke en innstilling. Er køen tom,
          eller er du ikke faglig ansvarlig, tar den ingen plass. */}
      {kanGodkjenne && tilGodkjenning.length > 0 && (
        <View style={{ backgroundColor: '#fff', borderRadius: radius.xl, overflow: 'hidden', marginBottom: spacing.xl }}>
          <Pressable
            haptic="light"
            onPress={() => router.push('/(app)/godkjenning')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
            }}
          >
            <ShieldCheck size={18} color={colors.brand} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={t.body}>Til godkjenning</Text>
              <Text style={[t.footnote, { color: colors.secondaryLabel }]}>
                {`${tilGodkjenning.length} ${tilGodkjenning.length === 1 ? 'ordre venter' : 'ordrer venter'} på deg`}
              </Text>
            </View>
            <View style={{
              minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7,
              backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={[t.caption, { color: '#fff', fontWeight: '700' }]}>{tilGodkjenning.length}</Text>
            </View>
            <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={2.2} />
          </Pressable>
        </View>
      )}

      {/* Mine timer står ØVERST og ikke under registrene: det er det eneste her
          en montør åpner mer enn én gang i uken. */}
      <View style={{ backgroundColor: '#fff', borderRadius: radius.xl, overflow: 'hidden', marginBottom: spacing.xl }}>
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/mine-timer')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
          }}
        >
          <CalendarClock size={18} color={colors.iconMuted} strokeWidth={2.2} />
          <View style={{ flex: 1 }}>
            <Text style={t.body}>Mine timer</Text>
            <Text style={[t.footnote, { color: colors.secondaryLabel }]}>Uke for uke — grunnlaget for lønn</Text>
          </View>
          <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={2.2} />
        </Pressable>
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/arkiv')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
            borderTopWidth: 0.5, borderTopColor: colors.separator,
          }}
        >
          <Archive size={18} color={colors.iconMuted} strokeWidth={2.2} />
          <View style={{ flex: 1 }}>
            <Text style={t.body}>Gamle jobber</Text>
            <Text style={[t.footnote, { color: colors.secondaryLabel }]}>Arkivet — filtrert på kunde og år</Text>
          </View>
          <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* Registrene. Ligger her fordi de settes opp sjelden og brukes via ordren. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginBottom: spacing.sm }}>
        <Users size={15} color={colors.secondaryLabel} strokeWidth={2.2} />
        <Text style={[t.footnote, { color: colors.secondaryLabel, fontWeight: '600', textTransform: 'uppercase' }]}>
          Register
        </Text>
      </View>
      <View style={{ backgroundColor: '#fff', borderRadius: radius.xl, overflow: 'hidden', marginBottom: spacing.xl }}>
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/kunder')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
          }}
        >
          <Users size={18} color={colors.iconMuted} strokeWidth={2.2} />
          <Text style={[t.body, { flex: 1 }]}>Kunder</Text>
          <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={2.2} />
        </Pressable>
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/aktiviteter')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
            borderTopWidth: 1, borderTopColor: colors.border,
          }}
        >
          <Timer size={18} color={colors.iconMuted} strokeWidth={2.2} />
          <View style={{ flex: 1 }}>
            <Text style={t.body}>Aktiviteter og timepriser</Text>
            <Text style={[t.footnote, { color: colors.secondaryLabel }]}>Avgjør hva en time koster på fakturaen</Text>
          </View>
          <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginBottom: spacing.sm }}>
        <Mic size={15} color={colors.secondaryLabel} strokeWidth={2.2} />
        <Text style={[t.footnote, { color: colors.secondaryLabel, fontWeight: '600', textTransform: 'uppercase' }]}>
          AI-assistentens stemme
        </Text>
      </View>
      <View style={{ backgroundColor: '#fff', borderRadius: radius.xl, overflow: 'hidden' }}>
        {loaded &&
          rows.map((row, i) => {
            const active = voice === row.id
            return (
              <Pressable
                key={row.id ?? 'standard'}
                haptic="light"
                onPress={() => choose(row.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm + 4,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  gap: spacing.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[t.body, { fontWeight: active ? '700' : '400' }]}>{row.label}</Text>
                  <Text style={[t.footnote, { color: colors.secondaryLabel }]}>{row.description}</Text>
                </View>
                {active && <Check size={18} color={colors.brand} strokeWidth={2.6} />}
              </Pressable>
            )
          })}
      </View>
      <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: spacing.sm }]}>
        Gjelder fra neste samtale (rist for å starte en ny).
      </Text>
    </ScrollView>
  )
}
