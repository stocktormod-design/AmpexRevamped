import { useState } from 'react'
import { View, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Room } from '../../../lib/db/models/room'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

export default function RomNyScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const [plan, setPlan] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const canSave = name.trim().length > 0 && plan.trim().length > 0 && !saving

  async function create() {
    if (!canSave || !projectId) return
    setSaving(true)
    await database.write(async () =>
      database.get<Room>('rooms').create(r => {
        r.projectId = projectId
        r.plan = plan.trim()
        r.name = name.trim()
        r.progress = null
        r.scanPath = null
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
        <Text style={t.headline}>Nytt rom</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
        <TextInput value={plan} onChangeText={setPlan} placeholder="Plan (f.eks. 1. etasje)" placeholderTextColor={colors.tertiaryLabel} autoFocus
          style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, borderBottomWidth: 0.5, borderBottomColor: colors.separator }]} />
        <TextInput value={name} onChangeText={setName} placeholder="Romnavn (f.eks. Stue, Bad, Teknisk)" placeholderTextColor={colors.tertiaryLabel}
          style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]} />
      </View>

      <Pressable haptic="medium" onPress={create} disabled={!canSave}
        style={{ height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.screen, marginTop: spacing.xl, opacity: canSave ? 1 : 0.35 }}>
        <Text style={[t.headline, { color: colors.ctaLabel }]}>Opprett rom</Text>
      </Pressable>
    </KeyboardAvoidingView>
  )
}
