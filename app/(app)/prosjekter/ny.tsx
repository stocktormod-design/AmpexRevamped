import { useState } from 'react'
import { View, Text, TextInput, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { router } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Project } from '../../../lib/db/models/project'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

export default function NyProsjektScreen() {
  const [name, setName] = useState('')
  const [customer, setCustomer] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const canSave = name.trim().length > 0 && !saving

  async function create() {
    if (!canSave) return
    setSaving(true)
    const created = await database.write(async () =>
      database.get<Project>('projects').create(p => {
        p.name = name.trim()
        p.customerName = customer.trim() || null
        p.address = address.trim() || null
        p.status = 'aktiv'
      }),
    )
    syncQuietly()
    router.dismiss()
    router.push(`/(app)/prosjekter/${created.id}`)
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingVertical: spacing.lg }}>
        <Pressable onPress={() => router.dismiss()} hitSlop={12}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Nytt prosjekt</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
        <TextInput value={name} onChangeText={setName} placeholder="Navn (påkrevd)" placeholderTextColor={colors.tertiaryLabel} autoFocus
          style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, borderBottomWidth: 0.5, borderBottomColor: colors.separator }]} />
        <TextInput value={customer} onChangeText={setCustomer} placeholder="Kunde" placeholderTextColor={colors.tertiaryLabel}
          style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, borderBottomWidth: 0.5, borderBottomColor: colors.separator }]} />
        <TextInput value={address} onChangeText={setAddress} placeholder="Adresse" placeholderTextColor={colors.tertiaryLabel}
          style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]} />
      </View>

      <Pressable haptic="medium" onPress={create} disabled={!canSave}
        style={{ height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.screen, marginTop: spacing.xl, opacity: canSave ? 1 : 0.35 }}>
        <Text style={[t.headline, { color: colors.ctaLabel }]}>Opprett prosjekt</Text>
      </Pressable>
    </KeyboardAvoidingView>
  )
}
