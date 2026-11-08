import { useMemo, useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Pressable } from '../../../components/pressable'
import { SectionsEditor, newSection } from '../../../components/form-fields-editor'
import { createTemplate } from '../../../lib/forms'
import { validateFirmSections } from '../../../lib/forms/firm-schema'
import { FormProblems } from '../../../components/form-problems'
import type { FormSection } from '../../../lib/db/models/form-template'
import { colors, spacing, radius, sizes, paperType as t } from '../../../lib/theme'
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
  /** Første lagringsforsøk. Før det er et tomt spørsmål ikke en feil — det er
   *  noe man er i ferd med å skrive. Samme regel som på kontoret. */
  const [provd, setProvd] = useState(false)

  const problems = useMemo(() => validateFirmSections(sections), [sections])
  const antall = sections.reduce((n, s) => n + s.fields.length, 0)
  const klar = !!title.trim() && antall > 0 && problems.length === 0 && !busy

  async function create() {
    if (!klar) {
      setProvd(true)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      return
    }
    setBusy(true)
    try {
      const id = await createTemplate({ title, category, sections })
      router.replace({ pathname: '/(app)/skjema/[id]', params: { id } })
    } finally {
      setBusy(false)
    }
  }

  const hint = busy
    ? 'Lagrer …'
    : !title.trim()
      ? 'Gi skjemaet et navn'
      : antall === 0
        ? 'Legg til minst ett spørsmål'
        : problems.length > 0
          ? `${problems.length === 1 ? 'Én ting' : `${problems.length} ting`} må rettes før det kan lagres`
          : `${antall === 1 ? '1 spørsmål' : `${antall} spørsmål`} · lagres i firmaets maler`

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paperCanvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm }}>
        <Pressable onPress={() => router.back()} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.body, { color: colors.paperSecondary }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Nytt skjema</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TextInput
          value={title} onChangeText={setTitle} autoFocus
          placeholder="Skjemaets navn" placeholderTextColor={colors.paperTertiary}
          style={[t.title2, { paddingVertical: spacing.xs }]}
        />

        <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.sm, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Kategori</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {CATEGORIES.map(c => {
            const active = category === c
            return (
              <Pressable key={c} haptic="light" onPress={() => setCategory(c)}
                style={{
                  minHeight: 44, justifyContent: 'center',
                  paddingHorizontal: spacing.md, borderRadius: radius.pill,
                  backgroundColor: active ? colors.paperLabel : colors.paperBg,
                }}>
                <Text style={[t.subhead, { fontWeight: '600', color: active ? colors.paperBg : colors.paperSecondary }]}>{c}</Text>
              </Pressable>
            )
          })}
        </View>

        <View style={{ marginTop: spacing.xl }}>
          {provd && <FormProblems problems={problems} />}
          <SectionsEditor sections={sections} tittel={title} onChange={setSections} />
        </View>
      </ScrollView>

      {/* Én handling, og den ligger der tommelen er. */}
      <View style={{
        paddingHorizontal: spacing.screen, paddingTop: spacing.sm,
        paddingBottom: insets.bottom + spacing.sm,
        borderTopWidth: 0.5, borderTopColor: colors.paperSeparator,
        backgroundColor: colors.paperCanvas,
      }}>
        <Text style={[t.caption, { textAlign: 'center', marginBottom: spacing.sm, color: provd && !klar ? colors.danger : colors.paperTertiary }]}>
          {hint}
        </Text>
        <Pressable
          haptic="medium"
          onPress={create}
          disabled={busy}
          style={{
            height: sizes.ctaHeight, borderRadius: radius.xl,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: klar ? colors.paperLabel : colors.paperFill,
          }}
        >
          <Text style={[t.headline, { color: klar ? colors.paperBg : colors.paperTertiary }]}>
            {busy ? 'Lagrer …' : 'Lagre skjema'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
