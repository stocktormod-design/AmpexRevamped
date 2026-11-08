import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Q } from '@nozbe/watermelondb'
import { Pressable } from '../../../components/pressable'
import { SectionsEditor, newSection } from '../../../components/form-fields-editor'
import { database } from '../../../lib/db'
import { FormTemplate, type FormSection } from '../../../lib/db/models/form-template'
import { FormRevision } from '../../../lib/db/models/form-revision'
import { saveRevision } from '../../../lib/forms'
import { validateFirmSections } from '../../../lib/forms/firm-schema'
import { FormProblems } from '../../../components/form-problems'
import { colors, spacing, radius, sizes, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

export default function RedigerSkjema() {
  // Mørk klokke og batteri: dette er papir, ikke brun grunn.
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [template, setTemplate] = useState<FormTemplate | null>(null)
  const [sections, setSections] = useState<FormSection[]>([])
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [provd, setProvd] = useState(false)

  useEffect(() => {
    if (!id) return
    let mounted = true
    ;(async () => {
      const tpl = await database.get<FormTemplate>('form_templates').find(id).catch(() => null)
      if (!mounted || !tpl) { router.back(); return }
      setTemplate(tpl)
      const revs = await database.get<FormRevision>('form_template_revisions')
        .query(Q.where('template_id', id), Q.sortBy('version', Q.desc)).fetch()
      const cur = revs.find(r => r.version === tpl.currentVersion) ?? revs[0]
      // Gamle v1-revisjoner løftes til én seksjon av cur.sections. Redigeres
      // de nå, lagres de som v2 — revisjonen de kom fra står urørt.
      if (mounted) {
        const loadedSections = cur ? cur.sections : []
        setSections(loadedSections.length > 0 ? loadedSections : [newSection()])
        setLoaded(true)
      }
    })()
    return () => { mounted = false }
  }, [id])

  const nextVersion = (template?.currentVersion ?? 0) + 1
  const problems = useMemo(() => validateFirmSections(sections), [sections])
  const antall = sections.reduce((n, s) => n + s.fields.length, 0)
  const klar = !!note.trim() && antall > 0 && problems.length === 0 && !busy

  async function save() {
    if (!template || !klar) {
      setProvd(true)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      return
    }
    setBusy(true)
    try {
      await saveRevision(template, sections, note)
      router.back()
    } finally {
      setBusy(false)
    }
  }

  const hint = busy
    ? 'Lagrer …'
    : !note.trim()
      ? 'Skriv én linje om hva du endrer'
      : antall === 0
        ? 'Legg til minst ett spørsmål'
        : problems.length > 0
          ? `${problems.length === 1 ? 'Én ting' : `${problems.length} ting`} må rettes før det kan lagres`
          : `Lagres som v${nextVersion}. v${template?.currentVersion ?? 1} blir stående.`

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paperCanvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm }}>
        <Pressable onPress={() => router.back()} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.body, { color: colors.paperSecondary }]}>Avbryt</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={t.headline}>Rediger skjema</Text>
          {template && <Text style={t.caption}>v{template.currentVersion} → v{nextVersion}</Text>}
        </View>
        <View style={{ width: 56 }} />
      </View>

      {loaded && (
        <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={[t.caption, { textTransform: 'uppercase', marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
            Hva endrer du?
          </Text>
          <TextInput
            value={note} onChangeText={setNote}
            placeholder="F.eks. «La til måling av jordfeilbryter»"
            placeholderTextColor={colors.paperTertiary} multiline
            style={[t.body, {
              backgroundColor: colors.paperBg, borderRadius: radius.lg,
              borderWidth: provd && !note.trim() ? 1 : 0,
              borderColor: colors.danger,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 72,
            }]}
          />
          <Text style={[t.caption, { color: colors.paperTertiary, marginTop: spacing.xs, marginLeft: spacing.xs, lineHeight: 17 }]}>
            Montørene ser hvorfor malen ble endret, og hvert utfylte skjema husker versjonen det ble fylt ut mot.
          </Text>

          <View style={{ marginTop: spacing.xl }}>
            {provd && <FormProblems problems={problems} />}
            <SectionsEditor sections={sections} tittel={template?.title} onChange={setSections} />
          </View>
        </ScrollView>
      )}

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
          onPress={save}
          disabled={busy}
          style={{
            height: sizes.ctaHeight, borderRadius: radius.xl,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: klar ? colors.paperLabel : colors.paperFill,
          }}
        >
          <Text style={[t.headline, { color: klar ? colors.paperBg : colors.paperTertiary }]}>
            {busy ? 'Lagrer …' : `Lagre som v${nextVersion}`}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
