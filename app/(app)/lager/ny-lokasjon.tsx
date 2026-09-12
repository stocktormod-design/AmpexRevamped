import { useState } from 'react'
import { View, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { PapirChip, usePapirFokus } from '../../../components/papir-surface'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Location, type LocationType } from '../../../lib/db/models/location'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

export default function NyLokasjonScreen() {
  // Kremet klokke og batteri på mørk grunn — settes tilbake når skjermen forlates.
  usePapirFokus()
  const { type: typeParam } = useLocalSearchParams<{ type?: string }>()
  const [type, setType] = useState<LocationType>(typeParam === 'lager' ? 'lager' : 'bil')
  const [name, setName] = useState('')
  const [regNr, setRegNr] = useState('')
  const [trackerImei, setTrackerImei] = useState('')
  const [saving, setSaving] = useState(false)
  const canSave = name.trim().length > 0 && !saving

  async function create() {
    if (!canSave) return
    setSaving(true)
    await database.write(async () =>
      database.get<Location>('locations').create(l => {
        l.type = type
        l.name = name.trim()
        l.assignedTo = null
        l.regNr = type === 'bil' ? (regNr.trim() || null) : null
        l.trackerImei = type === 'bil' ? (trackerImei.trim() || null) : null
      }),
    )
    syncQuietly()
    router.dismiss()
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingVertical: spacing.lg }}>
        <Pressable onPress={() => router.dismiss()} hitSlop={12}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Ny lokasjon</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.screen, marginBottom: spacing.md }}>
        <PapirChip label="Sentrallager" selected={type === 'lager'} onPress={() => setType('lager')} />
        <PapirChip label="Bil" selected={type === 'bil'} onPress={() => setType('bil')} />
      </View>

      <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
        <TextInput
          value={name} onChangeText={setName}
          placeholder={type === 'lager' ? 'Navn (f.eks. Hovedlager)' : 'Navn (f.eks. Bil – Per)'}
          placeholderTextColor={colors.tertiaryLabel} autoFocus
          style={[
            t.body as TextStyle,
            { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
            type === 'bil' && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
          ]}
        />
        {type === 'bil' && (
          <>
            <TextInput
              value={regNr} onChangeText={setRegNr}
              placeholder="Reg.nr (f.eks. AB 12345)" placeholderTextColor={colors.tertiaryLabel}
              autoCapitalize="characters"
              style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, borderBottomWidth: 0.5, borderBottomColor: colors.separator }]}
            />
            <TextInput
              value={trackerImei} onChangeText={setTrackerImei}
              placeholder="Tracker-IMEI (valgfritt)" placeholderTextColor={colors.tertiaryLabel}
              keyboardType="number-pad"
              style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]}
            />
          </>
        )}
      </View>

      <Pressable
        haptic="medium" onPress={create} disabled={!canSave}
        style={{
          height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
          alignItems: 'center', justifyContent: 'center',
          marginHorizontal: spacing.screen, marginTop: spacing.xl, opacity: canSave ? 1 : 0.35,
        }}
      >
        <Text style={[t.headline, { color: colors.ctaLabel }]}>Opprett</Text>
      </Pressable>
    </KeyboardAvoidingView>
  )
}
