import { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Plus, FileCheck2, ChevronRight, MessageCircle, FileUp } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { FormTemplate } from '../../../lib/db/models/form-template'
import { FormRevision } from '../../../lib/db/models/form-revision'
import { FormComment } from '../../../lib/db/models/form-comment'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../../lib/theme'

function useTemplates() {
  const [rows, setRows] = useState<FormTemplate[]>([])
  useEffect(() => {
    const sub = database.get<FormTemplate>('form_templates')
      .query(Q.sortBy('category', Q.asc), Q.sortBy('title', Q.asc))
      .observe().subscribe(setRows)
    return () => sub.unsubscribe()
  }, [])
  return rows
}

/** Antall felt i gjeldende revisjon, per skjema. */
function useItemCounts() {
  const [map, setMap] = useState<Record<string, number>>({})
  useEffect(() => {
    const sub = database.get<FormRevision>('form_template_revisions').query().observe().subscribe(revs => {
      const best: Record<string, FormRevision> = {}
      for (const r of revs) {
        const cur = best[r.templateId]
        if (!cur || r.version > cur.version) best[r.templateId] = r
      }
      const counts: Record<string, number> = {}
      for (const id in best) counts[id] = best[id].items.length
      setMap(counts)
    })
    return () => sub.unsubscribe()
  }, [])
  return map
}

/** Antall åpne (uløste) diskusjoner per skjema. */
function useOpenCounts() {
  const [map, setMap] = useState<Record<string, number>>({})
  useEffect(() => {
    const sub = database.get<FormComment>('form_comments')
      .query(Q.where('resolved', false)).observe().subscribe(rows => {
        const counts: Record<string, number> = {}
        for (const c of rows) counts[c.templateId] = (counts[c.templateId] ?? 0) + 1
        setMap(counts)
      })
    return () => sub.unsubscribe()
  }, [])
  return map
}

export default function SkjemaIndex() {
  const insets = useSafeAreaInsets()
  const templates = useTemplates()
  const itemCounts = useItemCounts()
  const openCounts = useOpenCounts()

  // Grupper på kategori (rekkefølge etter første forekomst)
  const cats: string[] = []
  const byCat = new Map<string, FormTemplate[]>()
  for (const tpl of templates) {
    const k = tpl.category || 'Diverse'
    if (!byCat.has(k)) { byCat.set(k, []); cats.push(k) }
    byCat.get(k)!.push(tpl)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.display, { marginTop: spacing.lg }]}>Skjema</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs, maxWidth: 320 }]}>
            Levende dokumentasjon. Endre, diskuter og revider — alt med logg og begrunnelse.
          </Text>

          {/* Import står SIDE OM SIDE med «nytt», ikke gjemt i en meny. De aller
              fleste firma har skjemaene sine fra før — å be dem taste dem inn
              på nytt er å be dem la være å ta i bruk systemet. */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
            <Pressable
              haptic="medium"
              onPress={() => router.push('/(app)/skjema/importer')}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.cta,
              }}
            >
              <FileUp size={sizes.icon} color={colors.ctaLabel} strokeWidth={2.2} />
              <Text style={[t.headline, { color: colors.ctaLabel }]}>Importer</Text>
            </Pressable>
            <Pressable
              haptic="medium"
              onPress={() => router.push('/(app)/skjema/ny')}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                height: sizes.ctaHeight - 6, paddingHorizontal: spacing.lg, borderRadius: radius.xl,
                backgroundColor: colors.bg,
              }}
            >
              <Plus size={sizes.icon} color={colors.label} strokeWidth={2.2} />
              <Text style={[t.headline, { color: colors.label }]}>Nytt</Text>
            </Pressable>
          </View>
        </View>

        {templates.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: spacing.xxl * 1.5, paddingHorizontal: spacing.xl }}>
            <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
              <FileCheck2 size={30} color={colors.secondaryLabel} strokeWidth={1.6} />
            </View>
            <Text style={[t.headline, { marginTop: spacing.lg }]}>Ingen skjema ennå</Text>
            <Text style={[t.footnote, { marginTop: spacing.xs, textAlign: 'center', lineHeight: 19 }]}>
              Importer skjemaet dere alt bruker — PDF eller bilde — eller lag firmaets første fra bunnen.
            </Text>
          </View>
        ) : (
          cats.map((cat, ci) => (
            <Animated.View key={cat} entering={FadeInDown.springify().delay(60 + ci * 40)} style={{ marginTop: spacing.xl }}>
              <Text style={[t.caption, { textTransform: 'uppercase', marginHorizontal: spacing.screen + spacing.lg, marginBottom: spacing.sm }]}>
                {cat}
              </Text>
              <View style={[{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen }, shadows.card]}>
                {byCat.get(cat)!.map((tpl, i, arr) => {
                  const open = openCounts[tpl.id] ?? 0
                  const fields = itemCounts[tpl.id] ?? 0
                  return (
                    <Pressable
                      key={tpl.id}
                      onPress={() => router.push({ pathname: '/(app)/skjema/[id]', params: { id: tpl.id } })}
                      style={[
                        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 3 },
                        i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                      ]}
                    >
                      <View style={{ width: sizes.iconChip - 6, height: sizes.iconChip - 6, borderRadius: radius.md, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
                        <FileCheck2 size={sizes.icon} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                      </View>
                      <View style={{ flex: 1, marginRight: spacing.sm }}>
                        <Text style={t.bodyMedium} numberOfLines={1}>{tpl.title}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3 }}>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.fill }}>
                            <Text style={[t.caption, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>v{tpl.currentVersion}</Text>
                          </View>
                          <Text style={t.footnote}>{fields} felt</Text>
                          {open > 0 && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <MessageCircle size={12} color={colors.iconMuted} strokeWidth={2.4} />
                              <Text style={[t.footnote, { color: colors.secondaryLabel, fontWeight: '600' }]}>{open}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                    </Pressable>
                  )
                })}
              </View>
            </Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  )
}
