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
import { useUserRole } from '../../../lib/auth-user'
import { kan } from '../../../lib/kontor-tilgang'

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
  const rolle = useUserRole()
  // Alle som har `skjema.les` ser malene; bare de med `skjema.skriv` får
  // opprette og importere. RLS isolerer firmaene — dette styrer flaten.
  const kanSkrive = kan(rolle, 'skjema.skriv')

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
          <Pressable onPress={() => router.back()} haptic="light" pressScale={0.92}
            style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.display, { marginTop: spacing.md }]}>Skjema</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>Sjekklistene firmaet fyller ut på jobb</Text>

          {/* «Nytt skjema» er den ene fylte handlingen. Import er en stille
              andrelinje: de fleste firma har skjemaene sine fra før, men den
              som lager et nytt skal ikke måtte velge mellom to likestilte. */}
          {kanSkrive && (
            <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
              <Pressable
                haptic="medium"
                onPress={() => router.push('/(app)/skjema/ny')}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                  height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
                }}
              >
                <Plus size={sizes.icon} color={colors.ctaLabel} strokeWidth={2.2} />
                <Text style={[t.headline, { color: colors.ctaLabel }]}>Nytt skjema</Text>
              </Pressable>
              <Pressable
                haptic="light"
                onPress={() => router.push('/(app)/skjema/importer')}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                  minHeight: 44, borderRadius: radius.lg,
                }}
              >
                <FileUp size={17} color={colors.secondaryLabel} strokeWidth={2.2} />
                <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>Importer PDF eller bilde</Text>
              </Pressable>
            </View>
          )}
        </View>

        {templates.length === 0 ? (
          <View style={{ paddingTop: spacing.xxl, paddingHorizontal: spacing.screen }}>
            <View style={{
              backgroundColor: colors.bg, borderRadius: radius.lg,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
              alignItems: 'center',
            }}>
              <View style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                <FileCheck2 size={26} color={colors.secondaryLabel} strokeWidth={1.6} />
              </View>
              <Text style={[t.headline, { marginTop: spacing.md }]}>Ingen skjema ennå</Text>
              <Text style={[t.footnote, { textAlign: 'center', marginTop: spacing.xs, lineHeight: 20 }]}>
                Et skjema er en sjekkliste du fyller ut på jobben — for eksempel
                «Sluttkontroll bolig» med spørsmål om tavle, jordfeilvern og stikkontakter.
              </Text>
            </View>
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
                        { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
                        i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                      ]}
                    >
                      <View style={{ flex: 1, marginRight: spacing.sm }}>
                        <Text style={t.bodyMedium} numberOfLines={1}>{tpl.title}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3 }}>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.fill }}>
                            <Text style={[t.caption, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>v{tpl.currentVersion}</Text>
                          </View>
                          <Text style={t.footnote}>{fields === 1 ? '1 spørsmål' : `${fields} spørsmål`}</Text>
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
