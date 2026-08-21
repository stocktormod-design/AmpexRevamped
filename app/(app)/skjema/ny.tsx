import { useMemo, useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { SectionsEditor, newSection } from '../../../components/form-fields-editor'
import { createTemplate } from '../../../lib/forms'
import { validateFirmSections } from '../../../lib/forms/firm-schema'
import { FormProblems } from '../../../components/form-problems'
import type { FormSection } from '../../../lib/db/models/form-template'
import { colors, spacing, radius, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

const CATEGORIES = ['Sluttkontroll', 'Risiko / SJA', 'HMS', 'Måleprotokoll', 'Egenkontroll', 'Diverse']

export default function NyttSkjema() {
  // Mørk klokke og batteri: dette er papir, ikke brun grunn.
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Sluttkontroll')
  const [sections, setSections] = useState<FormSection[]>(() => [newSection()])
  const [busy, setBusy] = useState(false)
  const problems = useMemo(() => validateFirmSections(sections), [sections])
  const canSave = !!title.trim() && problems.length === 0 && !busy

  async function create() {
    if (!canSave) return
    setBusy(true)
    try {
      const id = await createTemplate({ title, category, sections })
      router.replace({ pathname: '/(app)/skjema/[id]', params: { id } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paperCanvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm }}>
        <Pressable hitSlop={8} onPress={() => router.back()}><Text style={[t.body, { color: colors.paperSecondary }]}>Avbryt</Text></Pressable>
        <Text style={t.headline}>Nytt skjema</Text>
        <Pressable hitSlop={8} onPress={create} disabled={!canSave}>
          <Text style={[t.body, { color: canSave ? colors.brand : colors.paperTertiary, fontWeight: '600' }]}>Opprett</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TextInput
          value={title} onChangeText={setTitle} autoFocus
          placeholder="Tittel, f.eks. Sluttkontroll bolig" placeholderTextColor={colors.paperTertiary}
          style={[t.title3, { backgroundColor: colors.paperBg, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
        />

        <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Kategori</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {CATEGORIES.map(c => {
            const active = category === c
            return (
              <Pressable key={c} haptic="light" onPress={() => setCategory(c)}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: active ? colors.paperLabel : colors.paperBg }}>
                <Text style={[t.subhead, { fontWeight: '600', color: active ? colors.paperBg : colors.paperSecondary }]}>{c}</Text>
              </Pressable>
            )
          })}
        </View>

        <View style={{ marginTop: spacing.xl }}>
          <FormProblems problems={problems} />
          <SectionsEditor sections={sections} onChange={setSections} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
