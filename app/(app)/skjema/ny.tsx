import { useState } from 'react'
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { FieldsEditor } from '../../../components/form-fields-editor'
import { createTemplate } from '../../../lib/forms'
import type { FormField } from '../../../lib/db/models/form-template'
import { colors, spacing, radius, type as t } from '../../../lib/theme'

const CATEGORIES = ['Sluttkontroll', 'Risiko / SJA', 'HMS', 'Måleprotokoll', 'Egenkontroll', 'Diverse']

export default function NyttSkjema() {
  const insets = useSafeAreaInsets()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Sluttkontroll')
  const [items, setItems] = useState<FormField[]>([])
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      const id = await createTemplate({ title, category, items })
      router.replace({ pathname: '/(app)/skjema/[id]', params: { id } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm }}>
        <Pressable hitSlop={8} onPress={() => router.back()}><Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text></Pressable>
        <Text style={t.headline}>Nytt skjema</Text>
        <Pressable hitSlop={8} onPress={create} disabled={!title.trim() || busy}>
          <Text style={[t.body, { color: title.trim() ? colors.brand : colors.tertiaryLabel, fontWeight: '600' }]}>Opprett</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TextInput
          value={title} onChangeText={setTitle} autoFocus
          placeholder="Tittel, f.eks. Sluttkontroll bolig" placeholderTextColor={colors.tertiaryLabel}
          style={[t.title3, { backgroundColor: colors.bg, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
        />

        <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Kategori</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {CATEGORIES.map(c => {
            const active = category === c
            return (
              <Pressable key={c} haptic="light" onPress={() => setCategory(c)}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: active ? colors.label : colors.bg }}>
                <Text style={[t.subhead, { fontWeight: '600', color: active ? colors.bg : colors.secondaryLabel }]}>{c}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Felt</Text>
        <FieldsEditor items={items} onChange={setItems} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
