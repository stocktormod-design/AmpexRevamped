// Oppgaveliste for ett prosjekt. Basen deler ut og følger opp, montøren
// finner sine. Rad = åpne detaljer (arket), sirkel = ferdig/åpne igjen.
import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Circle, CircleCheckBig, Plus, ScanSearch } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { GlassListGroup } from '../../../components/ui'
import { TaskPinSheet, type TaskPinSheetState } from '../../../components/task-pin-sheet'
import { database } from '../../../lib/db'
import { Task } from '../../../lib/db/models/task'
import { Room } from '../../../lib/db/models/room'
import { ProjectMember } from '../../../lib/db/models/project-member'
import { toggleTaskDone } from '../../../lib/tasks'
import { useUserId, useUserRole } from '../../../lib/auth-user'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

type Filter = 'aapne' | 'mine' | 'ferdig'
const DELER_UT = new Set(['owner', 'admin', 'bas', 'baas'])

export default function OppgaverScreen() {
  const insets = useSafeAreaInsets()
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const userId = useUserId()
  const role = useUserRole()
  const kanDeleUt = role !== null && DELER_UT.has(role)
  const [tasks, setTasks] = useState<Task[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [filter, setFilter] = useState<Filter>('aapne')
  const [sheet, setSheet] = useState<TaskPinSheetState>(null)

  useEffect(() => {
    if (!projectId) return
    const subs = [
      database.get<Task>('tasks').query(Q.where('project_id', projectId), Q.sortBy('created_at', Q.desc)).observe().subscribe(setTasks),
      database.get<Room>('rooms').query(Q.where('project_id', projectId)).observe().subscribe(setRooms),
      database.get<ProjectMember>('project_members').query(Q.where('project_id', projectId)).observe().subscribe(setMembers),
    ]
    return () => subs.forEach(s => s.unsubscribe())
  }, [projectId])

  const memberNavn = useMemo(() => new Map(members.map(m => [m.userId, m.userName || 'Ukjent'])), [members])
  const romNavn = useMemo(() => new Map(rooms.map(r => [r.id, r.name])), [rooms])
  const synlige = tasks.filter(x =>
    filter === 'ferdig' ? x.status === 'done'
    : filter === 'mine' ? x.status === 'open' && x.assignedTo === userId
    : x.status === 'open')
  const antall = { aapne: tasks.filter(x => x.status === 'open').length, mine: tasks.filter(x => x.status === 'open' && x.assignedTo === userId).length, ferdig: tasks.filter(x => x.status === 'done').length }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} pressScale={0.92}
              style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.cardGlassStrong, borderWidth: 0.5, borderColor: colors.glassEdge, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
            </Pressable>
            {kanDeleUt && projectId && (
              <Pressable haptic="medium" onPress={() => setSheet({ mode: 'ny', projectId })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brand }}>
                <Plus size={16} color={colors.brandLabel} strokeWidth={2.4} />
                <Text style={[t.subhead, { color: colors.brandLabel, fontWeight: '600' }]}>Ny oppgave</Text>
              </Pressable>
            )}
          </View>
          <Text style={[t.title1, { marginTop: spacing.lg }]}>Oppgaver</Text>

          {/* Filter: åpne · mine · ferdig */}
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md }}>
            {([['aapne', 'Åpne'], ['mine', 'Mine'], ['ferdig', 'Ferdig']] as const).map(([k, label]) => {
              const aktiv = filter === k
              return (
                <Pressable key={k} haptic="light" pressScale={0.96} onPress={() => setFilter(k)}
                  style={{ paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: aktiv ? colors.label : colors.fill }}>
                  <Text style={[t.footnote, { fontWeight: '600', color: aktiv ? colors.bg : colors.label }]}>{label} {antall[k]}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        {synlige.length === 0 ? (
          <Text style={[t.footnote, { textAlign: 'center', marginTop: spacing.xl }]}>
            {filter === 'ferdig' ? 'Ingenting er ferdig ennå.' : filter === 'mine' ? 'Ingen oppgaver til deg.' : 'Ingen åpne oppgaver.'}
          </Text>
        ) : (
          <GlassListGroup>
            {synlige.map((task, i) => {
              const done = task.status === 'done'
              const under = [
                task.assignedTo ? memberNavn.get(task.assignedTo) ?? null : 'Ingen mottaker',
                task.roomId ? romNavn.get(task.roomId) ?? null : null,
                task.fristAt ? `Frist ${task.fristAt.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}` : null,
              ].filter(Boolean).join(' · ')
              return (
                <Pressable key={task.id} haptic="light" onPress={() => setSheet({ mode: 'vis', task })}
                  style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                    i < synlige.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator }]}>
                  <Pressable haptic="light" hitSlop={10} onPress={() => toggleTaskDone(task)}>
                    {done ? <CircleCheckBig size={sizes.icon} color={colors.success} strokeWidth={2} /> : <Circle size={sizes.icon} color={colors.tertiaryLabel} strokeWidth={2} />}
                  </Pressable>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[t.body, done && { color: colors.tertiaryLabel, textDecorationLine: 'line-through' }]} numberOfLines={2}>{task.title}</Text>
                    {!!under && <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>{under}</Text>}
                  </View>
                  {task.kind === 'lidar_scan' && <ScanSearch size={16} color={done ? colors.tertiaryLabel : colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
                </Pressable>
              )
            })}
          </GlassListGroup>
        )}
      </ScrollView>
      <TaskPinSheet state={sheet} userId={userId} onClose={() => setSheet(null)} />
    </View>
  )
}
