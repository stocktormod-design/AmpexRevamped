import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Plus, FileText, ChevronRight, UserPlus } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader } from '../../../components/ui'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Project, projectStatusLabel } from '../../../lib/db/models/project'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { ProjectMember } from '../../../lib/db/models/project-member'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function useMembers(projectId: string) {
  const [members, setMembers] = useState<ProjectMember[]>([])
  useEffect(() => {
    if (!projectId) return
    const sub = database.get<ProjectMember>('project_members')
      .query(Q.where('project_id', projectId), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setMembers)
    return () => sub.unsubscribe()
  }, [projectId])
  return members
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

function useDrawings(projectId: string) {
  const [drawings, setDrawings] = useState<Drawing[]>([])
  useEffect(() => {
    if (!projectId) return
    const sub = database.get<Drawing>('drawings')
      .query(Q.where('project_id', projectId), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setDrawings)
    return () => sub.unsubscribe()
  }, [projectId])
  return drawings
}

export default function ProsjektDetailScreen() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const drawings = useDrawings(id ?? '')
  const members = useMembers(id ?? '')

  useEffect(() => {
    if (!id) return
    const sub = database.get<Project>('projects').findAndObserve(id).subscribe({
      next: setProject, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [id])

  if (!project) return <View style={{ flex: 1, backgroundColor: colors.groupedBg }} />

  // Grupper tegninger på plan (rekkefølge etter første forekomst)
  const plans: string[] = []
  const byPlan = new Map<string, Drawing[]>()
  for (const d of drawings) {
    const key = d.plan || 'Uten plan'
    if (!byPlan.has(key)) { byPlan.set(key, []); plans.push(key) }
    byPlan.get(key)!.push(d)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.title1, { marginTop: spacing.lg }]}>{project.name}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {[project.customerName, project.address, projectStatusLabel[project.status]].filter(Boolean).join(' · ')}
          </Text>

          <Pressable
            haptic="medium"
            onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning-ny', params: { projectId: project.id } })}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.cta, marginTop: spacing.lg,
            }}
          >
            <Plus size={sizes.icon} color={colors.ctaLabel} strokeWidth={2.2} />
            <Text style={[t.headline, { color: colors.ctaLabel }]}>Legg til tegning</Text>
          </Pressable>
        </View>

        {/* Medlemmer */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Folk på prosjektet</SectionHeader>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginHorizontal: spacing.screen }}>
            {members.map(m => (
              <Pressable
                key={m.id}
                haptic="none"
                onLongPress={async () => { await database.write(async () => m.markAsDeleted()); syncQuietly() }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.pill, paddingLeft: spacing.xs, paddingRight: spacing.md, paddingVertical: spacing.xs }}
              >
                <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={[t.caption, { color: colors.iconMuted, fontWeight: '600' }]}>{initials(m.userName)}</Text>
                </View>
                <Text style={t.subhead} numberOfLines={1}>{m.userName}</Text>
              </Pressable>
            ))}
            <Pressable
              pressScale={0.95}
              onPress={() => router.push({ pathname: '/(app)/prosjekter/medlem', params: { projectId: project.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 0.5, borderColor: colors.border }}
            >
              <UserPlus size={16} color={colors.accent} strokeWidth={sizes.lucideStroke} />
              <Text style={[t.subhead, { color: colors.accent }]}>Legg til folk</Text>
            </Pressable>
          </View>
        </View>

        {drawings.length === 0 ? (
          <Text style={[t.footnote, { marginHorizontal: spacing.screen + spacing.lg }]}>
            Ingen tegninger ennå. Legg til tegninger per plan og fagfelt (elkraft, svakstrøm, automasjon).
          </Text>
        ) : (
          plans.map(plan => (
            <View key={plan} style={{ marginBottom: spacing.screen }}>
              <SectionHeader>{plan}</SectionHeader>
              <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
                {byPlan.get(plan)!.map((d, i, arr) => (
                  <Pressable
                    key={d.id}
                    onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning', params: { drawingId: d.id } })}
                    style={[
                      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                      i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                    ]}
                  >
                    <View style={{
                      width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm,
                      backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
                    }}>
                      <FileText size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={t.body} numberOfLines={1}>{d.name}</Text>
                      <Text style={[t.footnote, { marginTop: 1 }]}>{disciplineLabel[d.discipline] ?? d.discipline}</Text>
                    </View>
                    <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}
