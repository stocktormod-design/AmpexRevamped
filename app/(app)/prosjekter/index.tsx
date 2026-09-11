import { useEffect, useMemo, useState } from 'react'
import { View, FlatList } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Plus } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { MegAvatar } from '../../../components/meg-avatar'
import { PapirScreen } from '../../../components/papir-surface'
import { DrawingThumb } from '../../../components/drawing-thumb'
import { database } from '../../../lib/db'
import { Project, projectStatusLabel } from '../../../lib/db/models/project'
import { Drawing } from '../../../lib/db/models/drawing'
import { Task } from '../../../lib/db/models/task'
import { ProjectMember } from '../../../lib/db/models/project-member'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../../lib/theme'

function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    const sub = database.get<Project>('projects')
      .query(Q.where('status', Q.notEq('arkivert')), Q.sortBy('created_at', Q.desc))
      .observe().subscribe(setProjects)
    return () => sub.unsubscribe()
  }, [])
  return projects
}

/** Alt som hører til prosjektene, gruppert — én observasjon per tabell, ikke per kort. */
function useProsjektInnhold() {
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  useEffect(() => {
    const s1 = database.get<Drawing>('drawings').query(Q.sortBy('created_at', Q.asc)).observe().subscribe(setDrawings)
    const s2 = database.get<Task>('tasks').query(Q.where('status', 'open')).observe().subscribe(setTasks)
    const s3 = database.get<ProjectMember>('project_members').query().observe().subscribe(setMembers)
    return () => { s1.unsubscribe(); s2.unsubscribe(); s3.unsubscribe() }
  }, [])
  return useMemo(() => {
    const d = new Map<string, Drawing[]>(), tk = new Map<string, number>(), m = new Map<string, number>()
    for (const x of drawings) d.set(x.projectId, [...(d.get(x.projectId) ?? []), x])
    for (const x of tasks) tk.set(x.projectId, (tk.get(x.projectId) ?? 0) + 1)
    for (const x of members) m.set(x.projectId, (m.get(x.projectId) ?? 0) + 1)
    return { drawings: d, openTasks: tk, members: m }
  }, [drawings, tasks, members])
}

function tall(n: number, en: string, flere: string) {
  return `${n} ${n === 1 ? en : flere}`
}

/**
 * Prosjektkortet: tegningene ØVERST som bilde, deretter navn og de tre tallene
 * du faktisk styrer etter. En tynn rad med navn + «Aktiv» sa ingenting om
 * hva som lå bak — og tegningene er det du åpner prosjektet for.
 */
function ProsjektKort({ project, drawings, openTasks, members }: {
  project: Project; drawings: Drawing[]; openTasks: number; members: number
}) {
  const aktiv = project.status === 'aktiv'
  const under = [project.customerName, project.address].filter(Boolean).join(' · ')
  const meta = [
    tall(drawings.length, 'tegning', 'tegninger'),
    openTasks > 0 ? tall(openTasks, 'åpen oppgave', 'åpne oppgaver') : null,
    members > 0 ? tall(members, 'person', 'folk') : null,
  ].filter(Boolean).join('  ·  ')
  const strip = drawings.slice(0, 3)
  return (
    <Pressable
      haptic="light" pressScale={0.985}
      onPress={() => router.push(`/(app)/prosjekter/${project.id}`)}
      style={[{ marginHorizontal: spacing.screen, marginBottom: spacing.md, borderRadius: radius.hero }, shadows.card]}
    >
      <View style={{
        borderRadius: radius.hero, overflow: 'hidden', backgroundColor: colors.bg,
        borderWidth: 1, borderColor: colors.separator,
      }}>
        {strip.length > 0 && (
          <View style={{ flexDirection: 'row', height: 150, gap: 2, backgroundColor: colors.separator }}>
            {strip.map(d => <DrawingThumb key={d.id} filePath={d.filePath} style={{ flex: 1 }} />)}
          </View>
        )}
        <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={t.title3} numberOfLines={2}>{project.name}</Text>
              {!!under && <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={1}>{under}</Text>}
            </View>
            {/* Status er en stripe, ikke en prikk: messing = aktiv, ellers stille. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginTop: 4 }}>
              <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: aktiv ? colors.brand : colors.separator }} />
              <Text style={[t.caption, { color: aktiv ? colors.label : colors.secondaryLabel }]}>
                {projectStatusLabel[project.status]}
              </Text>
            </View>
          </View>
          <Text style={[t.caption, { marginTop: spacing.sm + 2, color: colors.secondaryLabel }]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

export default function ProsjekterScreen() {
  const insets = useSafeAreaInsets()
  const projects = useProjects()
  const innhold = useProsjektInnhold()

  return (
    <PapirScreen>
      <FlatList
        data={projects}
        keyExtractor={p => p.id}
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{
            flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
            paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
          }}>
            <Text style={[t.display, { color: colors.label }]}>Prosjekter</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
            <MegAvatar />
            <Pressable
              haptic="medium" pressScale={0.92}
              onPress={() => router.push('/(app)/prosjekter/ny')}
              style={{
                width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.brandSoft,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Plus size={sizes.icon} color={colors.brand} strokeWidth={2.2} />
            </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <ProsjektKort
            project={item}
            drawings={innhold.drawings.get(item.id) ?? []}
            openTasks={innhold.openTasks.get(item.id) ?? 0}
            members={innhold.members.get(item.id) ?? 0}
          />
        )}
        ListEmptyComponent={
          <View style={{
            borderRadius: radius.hero, marginHorizontal: spacing.screen, alignItems: 'center',
            paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl,
            borderWidth: 1, borderColor: colors.separator, borderStyle: 'dashed',
          }}>
            <Text style={[t.headline, { color: colors.label }]}>Ingen prosjekter</Text>
            <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: spacing.xs, textAlign: 'center' }]}>
              Opprett et prosjekt for å legge til tegninger.
            </Text>
          </View>
        }
      />
    </PapirScreen>
  )
}
