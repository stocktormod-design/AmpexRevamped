import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { Text, TextInput } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, ChevronDown, Plus, Check } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { database } from '../../lib/db'
import { syncQuietly } from '../../lib/db/sync'
import { Deviation } from '../../lib/db/models/deviation'
import { ALVORLIGHET_VEKT, alvorlighetLabel, lukkAvvik, meldAvvik, type Alvorlighet } from '../../lib/avvik'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

/**
 * AVVIK — meld det, og lukk det med et tiltak (2026-09-17).
 *
 * Det første DLE ser etter er om avvik faktisk meldes; det første montøren
 * trenger er at det tar ti sekunder. Derfor er «Meld avvik» det ene store
 * på skjermen, og skjemaet er én linje pluss alvorlighet. Resten er valgfritt.
 *
 * Alt går gjennom den lokale basen (regel 2) — et avvik meldt i en kjeller
 * uten dekning ligger trygt til nettet er tilbake. Kontoret ser det i
 * Internkontroll v2 → Avvik og kan lukke det derfra, eller montøren lukker
 * det selv her når det er rettet. Lukking uten tiltak stoppes i basen.
 */

const GRADER: Alvorlighet[] = ['lav', 'middels', 'hoy', 'kritisk']

function useAlleAvvik(): Deviation[] {
  const [rader, setRader] = useState<Deviation[]>([])
  useEffect(() => {
    const sub = database.get<Deviation>('deviations').query(Q.sortBy('funnet_at', Q.desc)).observe().subscribe(setRader)
    return () => sub.unsubscribe()
  }, [])
  return rader
}

const DATO = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' })

function Gradmerke({ grad }: { grad: Alvorlighet }) {
  const varsel = grad === 'kritisk' || grad === 'hoy'
  return (
    <View style={{
      paddingHorizontal: spacing.sm + 2, paddingVertical: 2, borderRadius: radius.pill,
      backgroundColor: grad === 'kritisk' ? colors.warning : varsel ? colors.warningSoft : colors.fill,
    }}>
      <Text style={[t.caption, { color: grad === 'kritisk' ? colors.bg : varsel ? colors.warning : colors.secondaryLabel }]}>
        {alvorlighetLabel[grad]}
      </Text>
    </View>
  )
}

function Skjema({ ferdig }: { ferdig: () => void }) {
  const [tittel, setTittel] = useState('')
  const [grad, setGrad] = useState<Alvorlighet>('middels')
  const [sted, setSted] = useState('')
  const [beskrivelse, setBeskrivelse] = useState('')
  const [jobber, setJobber] = useState(false)
  const klar = tittel.trim().length > 0 && !jobber

  async function send() {
    if (!klar) return
    setJobber(true)
    try {
      await meldAvvik({ tittel, alvorlighet: grad, sted, beskrivelse })
      syncQuietly()
      ferdig()
    } finally {
      setJobber(false)
    }
  }

  return (
    <View style={{
      marginHorizontal: spacing.screen, marginBottom: spacing.lg,
      backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.label, borderRadius: radius.lg, overflow: 'hidden',
    }}>
      <TextInput
        autoFocus
        value={tittel}
        onChangeText={setTittel}
        placeholder="Hva er galt?"
        placeholderTextColor={colors.tertiaryLabel}
        returnKeyType="done"
        style={[t.headline, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        {GRADER.map(g => {
          const valgt = g === grad
          return (
            <Pressable
              key={g}
              haptic="light"
              pressScale={0.95}
              onPress={() => setGrad(g)}
              style={{
                paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
                backgroundColor: valgt ? colors.cta : colors.fill,
              }}
            >
              <Text style={[t.caption, { color: valgt ? colors.bg : colors.secondaryLabel }]}>{alvorlighetLabel[g]}</Text>
            </Pressable>
          )
        })}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.separator }}>
        <TextInput
          value={sted}
          onChangeText={setSted}
          placeholder="Hvor (ordre, adresse, rom)"
          placeholderTextColor={colors.tertiaryLabel}
          style={[t.body, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
        />
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.separator }}>
        <TextInput
          value={beskrivelse}
          onChangeText={setBeskrivelse}
          placeholder="Hva ble funnet, og hvordan (valgfritt)"
          placeholderTextColor={colors.tertiaryLabel}
          multiline
          style={[t.body, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 72, textAlignVertical: 'top' }]}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.separator }}>
        <Pressable
          haptic="medium"
          onPress={send}
          disabled={!klar}
          style={{
            flex: 1, minHeight: sizes.touchTarget, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
            backgroundColor: klar ? colors.cta : colors.fill,
          }}
        >
          <Text style={[t.bodyMedium, { color: klar ? colors.bg : colors.tertiaryLabel }]}>{jobber ? 'Melder …' : 'Meld avviket'}</Text>
        </Pressable>
        <Pressable haptic="light" onPress={ferdig} style={{ minHeight: sizes.touchTarget, paddingHorizontal: spacing.lg, justifyContent: 'center' }}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
      </View>
    </View>
  )
}

function Rad({ avvik }: { avvik: Deviation }) {
  const [apen, setApen] = useState(false)
  const [tiltak, setTiltak] = useState('')
  const [jobber, setJobber] = useState(false)
  const apent = avvik.status === 'apent'
  const linje = [
    avvik.sted,
    avvik.erForfalt ? `Frist passert ${DATO.format(avvik.fristAt!)}` : avvik.fristAt ? `Frist ${DATO.format(avvik.fristAt)}` : `Meldt ${DATO.format(avvik.funnetAt)}`,
  ].filter(Boolean).join(' · ')

  async function lukk() {
    if (!tiltak.trim() || jobber) return
    setJobber(true)
    try {
      await lukkAvvik(avvik, tiltak)
      syncQuietly()
      setApen(false)
    } finally {
      setJobber(false)
    }
  }

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.separator }}>
      <Pressable haptic="light" onPress={() => setApen(v => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}>
        <View style={{ flex: 1 }}>
          <Text style={[t.bodyMedium, { color: apent ? colors.label : colors.secondaryLabel }]} numberOfLines={apen ? undefined : 1}>{avvik.tittel}</Text>
          <Text style={[t.footnote, { marginTop: 2, color: avvik.erForfalt ? colors.warning : colors.secondaryLabel }]} numberOfLines={1}>
            {apent ? linje : `Lukket ${avvik.lukketAt ? DATO.format(avvik.lukketAt) : ''}`}
          </Text>
        </View>
        {apent ? <Gradmerke grad={avvik.alvorlighet} /> : <Check size={16} color={colors.success} strokeWidth={2.2} />}
        <ChevronDown size={16} color={colors.tertiaryLabel} strokeWidth={2.2} style={{ transform: [{ rotate: apen ? '180deg' : '0deg' }] }} />
      </Pressable>

      {apen && (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md }}>
          {!!avvik.beskrivelse && <Text style={[t.body, { color: colors.secondaryLabel }]}>{avvik.beskrivelse}</Text>}
          {!!avvik.tiltak && (
            <View>
              <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: 2 }]}>TILTAK</Text>
              <Text style={[t.body, { color: colors.label }]}>{avvik.tiltak}</Text>
            </View>
          )}
          {apent && (
            <View style={{ borderWidth: 1, borderColor: colors.separator, borderRadius: radius.md, overflow: 'hidden' }}>
              <TextInput
                value={tiltak}
                onChangeText={setTiltak}
                placeholder="Hva ble gjort for å rette det?"
                placeholderTextColor={colors.tertiaryLabel}
                multiline
                style={[t.body, { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, minHeight: 60, textAlignVertical: 'top' }]}
              />
              <Pressable
                haptic="medium"
                onPress={lukk}
                disabled={!tiltak.trim() || jobber}
                style={{
                  minHeight: sizes.touchTarget, alignItems: 'center', justifyContent: 'center',
                  borderTopWidth: 1, borderTopColor: colors.separator,
                  backgroundColor: tiltak.trim() ? colors.cta : colors.bg,
                }}
              >
                <Text style={[t.bodyMedium, { color: tiltak.trim() ? colors.bg : colors.tertiaryLabel }]}>
                  {jobber ? 'Lukker …' : 'Lukk avviket'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  )
}

export default function AvvikScreen() {
  const insets = useSafeAreaInsets()
  const alle = useAlleAvvik()
  const [melder, setMelder] = useState(false)
  const [visLukkede, setVisLukkede] = useState(false)

  const apne = useMemo(
    () => alle.filter(a => a.status === 'apent').sort((a, b) => ALVORLIGHET_VEKT[a.alvorlighet] - ALVORLIGHET_VEKT[b.alvorlighet]),
    [alle],
  )
  const lukkede = useMemo(() => alle.filter(a => a.status === 'lukket'), [alle])

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <Pressable onPress={() => router.back()} pressScale={0.92} hitSlop={8}
          style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
        </Pressable>
        <Text style={[t.title2, { flex: 1 }]}>Avvik</Text>
        {!melder && (
          <Pressable
            haptic="medium"
            onPress={() => setMelder(true)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38,
              paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.cta,
            }}
          >
            <Plus size={16} color={colors.bg} strokeWidth={2.4} />
            <Text style={[t.bodyMedium, { color: colors.bg }]}>Meld avvik</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        {melder && <Skjema ferdig={() => setMelder(false)} />}

        {apne.length === 0 && !melder ? (
          <View style={{ alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl }}>
            <Text style={[t.headline, { color: colors.label }]}>Ingen åpne avvik</Text>
            <Text style={[t.footnote, { marginTop: spacing.xs, textAlign: 'center' }]}>
              Ser du noe som er feil, meld det med én gang. Det tar ti sekunder, og det er slik systemet lever.
            </Text>
          </View>
        ) : apne.length > 0 ? (
          <View style={{
            backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg,
            marginHorizontal: spacing.screen, overflow: 'hidden',
          }}>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs }}>
              <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.tertiaryLabel }]}>
                {apne.length === 1 ? '1 åpent' : `${apne.length} åpne`}
              </Text>
            </View>
            {apne.map(a => <Rad key={a.id} avvik={a} />)}
          </View>
        ) : null}

        {lukkede.length > 0 && (
          <View style={{ marginTop: spacing.lg, marginHorizontal: spacing.screen }}>
            <Pressable haptic="light" onPress={() => setVisLukkede(v => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: sizes.touchTarget, paddingHorizontal: spacing.xs }}>
              <Text style={[t.footnote, { flex: 1 }]}>{lukkede.length === 1 ? '1 lukket' : `${lukkede.length} lukkede`}</Text>
              <ChevronDown size={16} color={colors.tertiaryLabel} strokeWidth={2.2} style={{ transform: [{ rotate: visLukkede ? '180deg' : '0deg' }] }} />
            </Pressable>
            {visLukkede && (
              <View style={{ backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg, overflow: 'hidden' }}>
                {lukkede.map(a => <Rad key={a.id} avvik={a} />)}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
