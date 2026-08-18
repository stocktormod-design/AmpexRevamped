import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn } from 'react-native-reanimated'
import { BlurView } from 'expo-blur'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import {
  ChevronLeft, Pencil, SquareCheck, Type, Hash, Camera, Send,
  CheckCircle2, Circle,
} from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { Segmented } from '../../../components/segmented'
import { database } from '../../../lib/db'
import { FormTemplate, type FormFieldType } from '../../../lib/db/models/form-template'
import { FormRevision } from '../../../lib/db/models/form-revision'
import { FormComment } from '../../../lib/db/models/form-comment'
import { addComment, toggleResolveComment } from '../../../lib/forms'
import { formatSince } from '../../../lib/format'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../../lib/theme'

type Tab = 'skjema' | 'historikk' | 'diskusjon'

const FIELD_ICON: Record<FormFieldType, typeof Type> = {
  check: SquareCheck, text: Type, number: Hash, photo: Camera,
}
const FIELD_LABEL: Record<FormFieldType, string> = {
  check: 'Avkryssing', text: 'Tekst', number: 'Tall', photo: 'Foto',
}

export default function SkjemaDetail() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [template, setTemplate] = useState<FormTemplate | null>(null)
  const [revisions, setRevisions] = useState<FormRevision[]>([])
  const [comments, setComments] = useState<FormComment[]>([])
  const [tab, setTab] = useState<Tab>('skjema')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!id) return
    const sub = database.get<FormTemplate>('form_templates').findAndObserve(id).subscribe({
      next: setTemplate, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [id])

  useEffect(() => {
    if (!id) return
    const sub = database.get<FormRevision>('form_template_revisions')
      .query(Q.where('template_id', id), Q.sortBy('version', Q.desc))
      .observe().subscribe(setRevisions)
    return () => sub.unsubscribe()
  }, [id])

  useEffect(() => {
    if (!id) return
    const sub = database.get<FormComment>('form_comments')
      .query(Q.where('template_id', id), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setComments)
    return () => sub.unsubscribe()
  }, [id])

  const current = useMemo(
    () => revisions.find(r => r.version === template?.currentVersion) ?? revisions[0] ?? null,
    [revisions, template?.currentVersion],
  )
  const openCount = comments.filter(c => !c.resolved).length

  async function send() {
    const body = draft.trim()
    if (!template || !body) return
    setDraft('')
    await addComment(template, body)
  }

  if (!template) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm, backgroundColor: colors.canvas }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={t.title3} numberOfLines={1}>{template.title}</Text>
            <Text style={t.caption}>{template.category} · v{template.currentVersion}</Text>
          </View>
          <Pressable
            haptic="light" pressScale={0.94}
            onPress={() => router.push({ pathname: '/(app)/skjema/rediger', params: { id: template.id } })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 34, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.fill }}>
            <Pencil size={15} color={colors.label} strokeWidth={2.1} />
            <Text style={[t.subhead, { fontWeight: '600' }]}>Rediger</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: spacing.md }}>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { key: 'skjema', label: 'Skjema' },
              { key: 'historikk', label: `Historikk` },
              { key: 'diskusjon', label: openCount > 0 ? `Diskusjon · ${openCount}` : 'Diskusjon' },
            ]}
          />
        </View>
      </View>

      {/* Innhold */}
      {tab === 'skjema' ? (
        <Animated.ScrollView key="skjema" entering={FadeIn.duration(160)}
          contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }}
          showsVerticalScrollIndicator={false}>
          {current && current.items.length > 0 ? (
            <View style={[{ backgroundColor: colors.bg, borderRadius: radius.lg }, shadows.card]}>
              {current.items.map((it, i, arr) => {
                const Icon = FIELD_ICON[it.type] ?? Type
                return (
                  <View key={it.id} style={[
                    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                    i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                  ]}>
                    <View style={{ width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
                      <Icon size={16} color={colors.iconMuted} strokeWidth={2} />
                    </View>
                    <Text style={[t.body, { flex: 1 }]} numberOfLines={2}>{it.label}</Text>
                    {it.required && <Text style={[t.caption, { color: colors.danger }]}>påkrevd</Text>}
                    <Text style={[t.caption, { color: colors.tertiaryLabel, marginLeft: spacing.sm }]}>{FIELD_LABEL[it.type]}</Text>
                  </View>
                )
              })}
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingTop: spacing.xxl }}>
              <Text style={[t.footnote]}>Tomt skjema. Trykk Rediger for å legge til felt.</Text>
            </View>
          )}
        </Animated.ScrollView>
      ) : tab === 'historikk' ? (
        <Animated.ScrollView key="historikk" entering={FadeIn.duration(160)}
          contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }}
          showsVerticalScrollIndicator={false}>
          {revisions.map((r, i) => {
            const newest = i === 0
            return (
              <View key={r.id} style={{ flexDirection: 'row' }}>
                {/* Tidslinje-rail */}
                <View style={{ width: 28, alignItems: 'center' }}>
                  <View style={{
                    width: 12, height: 12, borderRadius: 6, marginTop: 4,
                    backgroundColor: newest ? colors.cta : colors.bg,
                    borderWidth: newest ? 0 : 2, borderColor: colors.separator,
                  }} />
                  {i < revisions.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: colors.separator, marginVertical: 2 }} />}
                </View>
                <View style={{ flex: 1, paddingBottom: spacing.lg, marginLeft: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={[t.headline]}>v{r.version}</Text>
                    {newest && (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.successSoft }}>
                        <Text style={[t.caption, { color: colors.success, fontWeight: '700' }]}>GJELDENDE</Text>
                      </View>
                    )}
                    <Text style={[t.caption, { color: colors.tertiaryLabel, marginLeft: 'auto' }]}>{formatSince(r.createdAt)}</Text>
                  </View>
                  <Text style={[t.subhead, { color: colors.secondaryLabel, marginTop: 3 }]}>{r.changeNote || 'Endret'}</Text>
                  <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 4 }]}>{r.items.length} felt</Text>
                </View>
              </View>
            )
          })}
        </Animated.ScrollView>
      ) : (
        <View key="diskusjon" style={{ flex: 1 }}>
          <Animated.ScrollView entering={FadeIn.duration(160)}
            contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }}
            showsVerticalScrollIndicator={false}>
            {comments.length === 0 ? (
              <View style={{ alignItems: 'center', paddingTop: spacing.xxl }}>
                <Text style={[t.footnote, { textAlign: 'center' }]}>Ingen diskusjon ennå.{'\n'}Spør om hvordan et punkt funker, eller foreslå en endring.</Text>
              </View>
            ) : (
              comments.map(c => (
                <View key={c.id} style={[
                  { backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.md + 2, marginBottom: spacing.sm },
                  c.resolved && { opacity: 0.6 },
                ]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
                    <Text style={[t.footnote, { fontWeight: '700', color: colors.label }]}>{c.authorName || 'Ukjent'}</Text>
                    <View style={{ paddingHorizontal: 5, borderRadius: radius.sm, backgroundColor: colors.fill }}>
                      <Text style={[t.caption, { color: colors.tertiaryLabel }]}>v{c.version ?? '?'}</Text>
                    </View>
                    <Text style={[t.caption, { color: colors.tertiaryLabel, marginLeft: 'auto' }]}>{formatSince(c.createdAt)}</Text>
                  </View>
                  <Text style={[t.body]}>{c.body}</Text>
                  <Pressable
                    haptic="light" hitSlop={8}
                    onPress={() => toggleResolveComment(c, c.resolved ? undefined : template.currentVersion)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm }}>
                    {c.resolved
                      ? <CheckCircle2 size={15} color={colors.success} strokeWidth={2.2} />
                      : <Circle size={15} color={colors.tertiaryLabel} strokeWidth={2} />}
                    <Text style={[t.caption, { color: c.resolved ? colors.success : colors.secondaryLabel, fontWeight: '600' }]}>
                      {c.resolved ? `Løst i v${c.resolvedRevision ?? '?'}` : 'Marker løst'}
                    </Text>
                  </Pressable>
                </View>
              ))
            )}
          </Animated.ScrollView>

          {/* Kompose-bar */}
          <BlurView tint="systemChromeMaterialLight" intensity={90}
            style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.sm, borderTopWidth: 0.5, borderTopColor: colors.separator, backgroundColor: colors.chromeGlass }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
              <TextInput
                value={draft} onChangeText={setDraft}
                placeholder="Spør eller foreslå endring…"
                placeholderTextColor={colors.tertiaryLabel}
                multiline
                style={[t.body, { flex: 1, maxHeight: 110, minHeight: 40, backgroundColor: colors.fill, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10 }]}
              />
              <Pressable
                haptic="medium" onPress={send} disabled={!draft.trim()}
                style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: draft.trim() ? colors.cta : colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                <Send size={18} color={draft.trim() ? colors.ctaLabel : colors.tertiaryLabel} strokeWidth={2.1} />
              </Pressable>
            </View>
          </BlurView>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}
