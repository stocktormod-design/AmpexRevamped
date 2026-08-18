import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, Mic } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { getPreferredVoice, setPreferredVoice, VOICE_OPTIONS } from '../../lib/ai/voice-prefs'
import { colors, spacing, radius, type as t } from '../../lib/theme'

export default function Screen() {
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
      <Text style={[t.largeTitle, { marginBottom: spacing.xl }]}>Meg</Text>

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
