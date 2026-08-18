import { useEffect, useState } from 'react'
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Pressable } from '../../../components/pressable'
import { FieldsEditor } from '../../../components/form-fields-editor'
import { database } from '../../../lib/db'
import { FormTemplate, type FormField } from '../../../lib/db/models/form-template'
import { FormRevision } from '../../../lib/db/models/form-revision'
import { saveRevision } from '../../../lib/forms'
import { colors, spacing, radius, type as t } from '../../../lib/theme'

export default function RedigerSkjema() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [template, setTemplate] = useState<FormTemplate | null>(null)
  const [items, setItems] = useState<FormField[]>([])
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

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
      if (mounted) { setItems(cur ? cur.items : []); setLoaded(true) }
    })()
    return () => { mounted = false }
  }, [id])

  async function save() {
    if (!template || !note.trim() || busy) return
    setBusy(true)
    try {
      await saveRevision(template, items, note)
      router.back()
    } finally {
      setBusy(false)
    }
  }

  const nextVersion = (template?.currentVersion ?? 0) + 1
  const canSave = !!note.trim() && !busy

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm }}>
        <Pressable hitSlop={8} onPress={() => router.back()}><Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text></Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={t.headline}>Rediger skjema</Text>
          {template && <Text style={t.caption}>lagres som v{nextVersion}</Text>}
        </View>
        <Pressable hitSlop={8} onPress={save} disabled={!canSave}>
          <Text style={[t.body, { color: canSave ? colors.brand : colors.tertiaryLabel, fontWeight: '600' }]}>Lagre</Text>
        </Pressable>
      </View>

      {loaded && (
        <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={[t.caption, { textTransform: 'uppercase', marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Hvorfor endrer du dette?</Text>
          <TextInput
            value={note} onChangeText={setNote}
            placeholder="F.eks. «Punkt om jording var uklart, omformulert etter innspill fra montør»"
            placeholderTextColor={colors.tertiaryLabel} multiline
            style={[t.body, { backgroundColor: colors.bg, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 72 }]}
          />
          <Text style={[t.footnote, { marginTop: spacing.xs, marginLeft: spacing.xs }]}>Lagres i historikken slik at alle ser hvorfor.</Text>

          <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Felt</Text>
          <FieldsEditor items={items} onChange={setItems} />
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  )
}
