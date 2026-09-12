import { useCallback, useEffect, useState } from 'react'
import { View, ScrollView, Alert } from 'react-native'
import { Text } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { setStatusBarStyle } from 'expo-status-bar'
import { Check, CloudOff } from 'lucide-react-native'
import { router, useFocusEffect } from 'expo-router'
import { Pressable } from '../../components/pressable'
import { AmpexMarkButton } from '../../components/ampex-mark-button'
import { BilKort } from '../../components/bil-kort'
import { useTilGodkjenning, useKanGodkjenne } from '../../lib/approvals'
import { useSynkStatus } from '../../lib/db/sync'
import { useUserId } from '../../lib/auth-user'
import { supabase } from '../../lib/supabase'
import { getPreferredVoice, setPreferredVoice, VOICE_OPTIONS } from '../../lib/ai/voice-prefs'
import { trykkProve, nullstillTrykk, type TrykkProve } from '../../lib/perf'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

/** Avlesning av trykk-køen. Ett trykk = oppdater, langt trykk = nullstill. */
function TrykkMaaler() {
  const [prove, setProve] = useState<TrykkProve | null>(() => trykkProve())
  return (
    <Pressable
      haptic="none"
      onPress={() => setProve(trykkProve())}
      onLongPress={() => { nullstillTrykk(); setProve(null) }}
      style={{ marginTop: spacing.md, paddingVertical: spacing.sm }}
    >
      <Text style={[t.caption, { color: colors.tertiaryLabel, textAlign: 'center' }]}>
        {prove
          ? `trykk-kø: median ${prove.median} ms · p90 ${prove.p90} ms · verst ${prove.verst} ms (${prove.antall})`
          : 'trykk-kø: ingen målinger · trykk her for å oppdatere'}
      </Text>
    </Pressable>
  )
}

export default function Screen() {
  // Papir-grunn → mørk statuslinje mens fanen er i fokus.
  useFocusEffect(useCallback(() => { setStatusBarStyle('dark') }, []))
  const userId = useUserId()
  const tilGodkjenning = useTilGodkjenning()
  const synk = useSynkStatus()
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
      contentContainerStyle={{
        paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.screen,
        paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl }}>
        <Text style={t.display}>Meg</Text>
        <View />
      </View>

      {/* Bilen · lageret ditt på hjul. Regnr → Vegvesen-oppslag → silhuett i
          bilens faktiske farge. */}
      <BilKort userId={userId} />

      {/* Faglig godkjenning står først når noe faktisk venter · det er en
          forskriftsfestet oppgave med en kø, ikke en innstilling. Er køen tom,
          eller er du ikke faglig ansvarlig, tar den ingen plass. */}
      {kanGodkjenne && tilGodkjenning.length > 0 && (
        <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.xl }}>
          <Pressable
            haptic="light"
            onPress={() => router.push('/(app)/godkjenning')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[t.body]}>Til godkjenning</Text>
            </View>
            <View style={{
              minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7,
              backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={[t.caption, { color: colors.ctaLabel, fontWeight: '700' }]}>{tilGodkjenning.length}</Text>
            </View>
          </Pressable>
        </View>
      )}

      {/* Mine timer står ØVERST og ikke under registrene: det er det eneste her
          en montør åpner mer enn én gang i uken. */}
      <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.xl }}>
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/mine-timer')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[t.body]}>Mine timer</Text>
          </View>
        </Pressable>
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/arkiv')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
            borderTopWidth: 1, borderTopColor: colors.separator,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[t.body]}>Gamle jobber</Text>
          </View>
        </Pressable>
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/skanner')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
            borderTopWidth: 1, borderTopColor: colors.separator,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[t.body]}>Skann</Text>
          </View>
        </Pressable>
      </View>

      {/* Registrene. Ligger her fordi de settes opp sjelden og brukes via ordren. */}
      <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.tertiaryLabel, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
        Register
      </Text>
      <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.xl }}>
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/kunder')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6,
          }}
        >
          <Text style={[t.body, { flex: 1, color: colors.label }]}>Kunder</Text>
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
          <View style={{ flex: 1 }}>
            <Text style={[t.body]}>Aktiviteter og timepriser</Text>
          </View>
        </Pressable>
      </View>

      <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.tertiaryLabel, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
        AI-assistentens stemme
      </Text>
      <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg, overflow: 'hidden' }}>
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
                  <Text style={[t.body, { color: colors.label, fontWeight: active ? '700' : '400' }]}>{row.label}</Text>
                </View>
                {active && <Check size={18} color={colors.brand} strokeWidth={2.6} />}
              </Pressable>
            )
          })}
      </View>
      <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: spacing.sm }]}>
        Gjelder fra neste samtale · trykk på Ampex-merket for å starte en.
      </Text>

      {/* Synken er usynlig (regel 2) og skal forbli det. Men blir vi AVVIST av
          serveren tre ganger på rad, er det en defekt, ikke en kjeller · og da
          må noen få vite at arbeidet står på telefonen og ikke kommer videre.
          Uten nett teller ikke: det er normaltilstanden appen er bygget for. */}
      {synk?.nivaa === 'blokkert' && (
        <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.xl, flexDirection: 'row', gap: spacing.md }}>
          <CloudOff size={20} color={colors.danger} strokeWidth={2.2} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={[t.body, { color: colors.label, fontWeight: '600' }]}>{synk.tekst}</Text>
            <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: 2 }]}>
              Ingenting er tapt · alt ligger lagret på telefonen. Men det kommer ikke fram før dette er rettet.
            </Text>
            {synk.detalj && (
              <Text style={[t.caption, { color: colors.secondaryLabel, marginTop: spacing.sm }]}>{synk.detalj}</Text>
            )}
          </View>
        </View>
      )}
      {synk && synk.nivaa !== 'blokkert' && (
        <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: spacing.xl, textAlign: 'center' }]}>
          {synk.tekst}
        </Text>
      )}

      {/* TRYKK-KØEN (kun __DEV__, se lib/perf.ts). Trykk rundt i appen, kom hit
          og trykk her for å lese av hvor lenge trykkene lå og ventet på
          JS-tråden. Ingen løkke som oppdaterer seg selv · den leses av på
          forespørsel, så den koster ingenting mens den står der (regel 10). */}
      {/* Utlogging. Nederst og rolig: det er ikke en handling man gjør i løpet av
          dagen. Lokale data blir stående på telefonen; logger en annen bruker fra et
          annet firma inn, nullstiller company-guard basen før synk. */}
      <Pressable
        haptic="light"
        onPress={() => Alert.alert('Logge ut?', 'Du kan logge inn igjen med samme bruker.', [
          { text: 'Avbryt', style: 'cancel' },
          { text: 'Logg ut', style: 'destructive', onPress: () => { void supabase.auth.signOut({ scope: 'local' }).then(() => router.replace('/(auth)/login')) } },
        ])}
        style={{
          marginTop: spacing.xxl, paddingVertical: spacing.md, alignItems: 'center',
          borderRadius: radius.lg, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.bg,
        }}
      >
        <Text style={[t.body, { color: colors.danger }]}>Logg ut</Text>
      </Pressable>

      {__DEV__ && <TrykkMaaler />}
    </ScrollView>
  )
}
