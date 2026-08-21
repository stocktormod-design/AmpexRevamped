import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, Mic, Users, Timer, ChevronRight, CalendarClock, ShieldCheck, Archive, CloudOff } from 'lucide-react-native'
import { router } from 'expo-router'
import { Pressable } from '../../components/pressable'
import { AmpexMarkButton } from '../../components/ampex-mark-button'
import { useTilGodkjenning, useKanGodkjenne } from '../../lib/approvals'
import { useSynkStatus } from '../../lib/db/sync'
import { PALETTER, lagretPalett, velgPalett, type PalettId } from '../../lib/palett'
import { getPreferredVoice, setPreferredVoice, VOICE_OPTIONS } from '../../lib/ai/voice-prefs'
import { colors, spacing, radius, type as t } from '../../lib/theme'

export default function Screen() {
  const tilGodkjenning = useTilGodkjenning()
  const synk = useSynkStatus()
  const kanGodkjenne = useKanGodkjenne()
  const insets = useSafeAreaInsets()
  const [voice, setVoice] = useState<string | null>(null)
  const [palett, setPalett] = useState<PalettId>('naavaerende')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getPreferredVoice().then(v => {
      setVoice(v)
      setLoaded(true)
    })
    lagretPalett().then(setPalett).catch(() => {})
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
        Gjelder fra neste samtale — trykk på Ampex-merket for å starte en.
      </Text>

      {/* MIDLERTIDIG: palettprøving. Slettes sammen med lib/palett.ts når én
          er valgt og verdiene er skrevet inn i lib/tokens.js. Ligger her og
          ikke bak en dev-flagg fordi den som skal VELGE er deg, på en telefon,
          i det lyset appen faktisk brukes i. */}
      <Text style={[t.footnote, { color: colors.secondaryLabel, fontWeight: '600', textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
        Fargeprøve
      </Text>
      <View style={{ backgroundColor: '#fff', borderRadius: radius.xl, overflow: 'hidden' }}>
        {PALETTER.map((p, i) => {
          const aktiv = palett === p.id
          return (
            <Pressable
              key={p.id}
              haptic="medium"
              onPress={() => { setPalett(p.id); void velgPalett(p.id) }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
                borderBottomWidth: i < PALETTER.length - 1 ? 0.5 : 0,
                borderBottomColor: colors.separator,
              }}
            >
              {/* Prøvene tegnes med paletten sine EGNE hex-verdier, ikke med
                  temaet — ellers ville alle tre sett like ut. */}
              <View style={{ flexDirection: 'row' }}>
                {p.proever.map((farge, n) => (
                  <View
                    key={farge}
                    style={{
                      width: 22, height: 22, borderRadius: 11, backgroundColor: farge,
                      borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)',
                      marginLeft: n === 0 ? 0 : -7,
                    }}
                  />
                ))}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { fontWeight: aktiv ? '700' : '400' }]}>{p.navn}</Text>
                <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: 1, lineHeight: 18 }]}>
                  {p.beskrivelse}
                </Text>
              </View>
              {aktiv && <Check size={18} color={colors.brand} strokeWidth={2.6} />}
            </Pressable>
          )
        })}
      </View>

      {/* Synken er usynlig (regel 2) og skal forbli det. Men blir vi AVVIST av
          serveren tre ganger på rad, er det en defekt, ikke en kjeller — og da
          må noen få vite at arbeidet står på telefonen og ikke kommer videre.
          Uten nett teller ikke: det er normaltilstanden appen er bygget for. */}
      {synk?.nivaa === 'blokkert' && (
        <View style={{ backgroundColor: '#fff', borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xl, flexDirection: 'row', gap: spacing.md }}>
          <CloudOff size={20} color={colors.danger} strokeWidth={2.2} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={[t.body, { fontWeight: '600' }]}>{synk.tekst}</Text>
            <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: 2 }]}>
              Ingenting er tapt — alt ligger lagret på telefonen. Men det kommer ikke fram før dette er rettet.
            </Text>
            {synk.detalj && (
              <Text style={[t.caption, { color: colors.secondaryLabel, marginTop: spacing.sm }]}>{synk.detalj}</Text>
            )}
          </View>
        </View>
      )}
      {synk && synk.nivaa !== 'blokkert' && (
        <Text style={[t.caption, { color: colors.secondaryLabel, marginTop: spacing.xl, textAlign: 'center' }]}>
          {synk.tekst}
        </Text>
      )}
    </ScrollView>
  )
}
