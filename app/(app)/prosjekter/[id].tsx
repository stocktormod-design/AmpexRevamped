import { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Plus, Layers, ChevronRight, UserPlus, ScanLine, Circle, CircleCheckBig, ScanSearch } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader, GlassListGroup } from '../../../components/ui'
import { MappeInnhold, useMapper } from '../../../components/tegning-mapper'
import { ToolGlow } from '../../../components/tool-surface'
import { usePapirFokus } from '../../../components/papir-surface'
import { MegAvatar } from '../../../components/meg-avatar'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Project, projectStatusLabel } from '../../../lib/db/models/project'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { ProjectMember } from '../../../lib/db/models/project-member'
import { Room } from '../../../lib/db/models/room'
import { FireDevice } from '../../../lib/db/models/fire-device'
import { Task } from '../../../lib/db/models/task'
import { toggleTaskDone } from '../../../lib/tasks'
import { useUserId, useUserRole } from '../../../lib/auth-user'
import { TaskPinSheet, type TaskPinSheetState } from '../../../components/task-pin-sheet'
import { useVoiceSession } from '../../../lib/ai/voice-session'
import { loadDraft } from '../../../lib/ai/voice-drafts'
import { runProjectStatusQuery, type ProjectStatusOutcome } from '../../../lib/ai/project-status'
import { speak } from '../../../lib/ai/voice-speaker'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../../lib/theme'

// Nærmeste vi har til «prosjektleder» — ingen egen rolle finnes (se plan). Bekreft
// med bruker om montør skal ekskluderes helt; dette er en produktbeslutning.
const PROJECT_STATUS_ROLES = new Set(['owner', 'admin', 'bas', 'baas'])

/** Glass-listegruppe — skygge på wrapper, klipping+fyll på inner (samme mønster som GlassCard). */

/** Kompakt glass-empty for Rom/Tegninger — ikon + kort tekst, valgfri kobber-CTA. */
function GlassEmpty({ Icon, text, cta }: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  text: string
  cta?: { label: string; onPress: () => void }
}) {
  return (
    <View style={{
      marginHorizontal: spacing.screen, borderRadius: radius.hero, overflow: 'hidden',
      backgroundColor: colors.cardGlassStrong, borderWidth: 0.5, borderColor: colors.glassEdge,
      alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.xl,
    }}>
      <View style={{
        width: sizes.iconChip, height: sizes.iconChip, borderRadius: radius.pill,
        backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
      }}>
        <Icon size={sizes.iconLg - 4} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
      </View>
      <Text style={[t.footnote, { textAlign: 'center' }]}>{text}</Text>
      {cta && (
        <Pressable
          haptic="medium"
          onPress={cta.onPress}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
            height: sizes.ctaHeight - 10, paddingHorizontal: spacing.lg, borderRadius: radius.xl,
            backgroundColor: colors.brand, marginTop: spacing.md,
          }}
        >
          <Plus size={sizes.icon - 4} color="#fff" strokeWidth={2.2} />
          <Text style={[t.subhead, { color: '#fff', fontWeight: '600' }]}>{cta.label}</Text>
        </Pressable>
      )}
    </View>
  )
}

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

function useRooms(projectId: string) {
  const [rooms, setRooms] = useState<Room[]>([])
  useEffect(() => {
    if (!projectId) return
    const sub = database.get<Room>('rooms')
      .query(Q.where('project_id', projectId), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setRooms)
    return () => sub.unsubscribe()
  }, [projectId])
  return rooms
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

function useTasks(projectId: string) {
  const [tasks, setTasks] = useState<Task[]>([])
  useEffect(() => {
    if (!projectId) return
    const sub = database.get<Task>('tasks')
      .query(Q.where('project_id', projectId), Q.sortBy('created_at', Q.desc))
      .observe().subscribe(setTasks)
    return () => sub.unsubscribe()
  }, [projectId])
  return tasks
}

async function toggleScanResponsible(member: ProjectMember, members: ProjectMember[]) {
  const turningOn = !member.isScanResponsible
  await database.write(async () => {
    // Én ansvarlig per prosjekt: skru av de andre når vi setter en ny
    if (turningOn) {
      for (const m of members) {
        if (m.id !== member.id && m.isScanResponsible) await m.update(x => { x.isScanResponsible = false })
      }
    }
    await member.update(x => { x.isScanResponsible = turningOn })
  })
  syncQuietly()
}

/** Lenke til detektorlista — vises kun når prosjektet har brannkomponenter. */
function DetektorlisteRow({ projectId }: { projectId: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const sub = database.get<FireDevice>('fire_devices')
      .query(Q.where('project_id', projectId))
      .observeCount().subscribe(setCount)
    return () => sub.unsubscribe()
  }, [projectId])
  if (count === 0) return null
  return (
    <Pressable
      haptic="light" pressScale={0.98}
      onPress={() => router.push({ pathname: '/(app)/prosjekter/detektorliste', params: { projectId } })}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
        height: 44, borderRadius: radius.lg, paddingHorizontal: spacing.md,
        backgroundColor: colors.fill,
      }}
    >
      <Layers size={sizes.icon - 2} color={colors.brand} strokeWidth={2} />
      <Text style={[t.subhead, { flex: 1 }]}>Detektorliste</Text>
      <Text style={t.footnote}>{count}</Text>
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={2} />
    </Pressable>
  )
}

export default function ProsjektDetailScreen() {
  usePapirFokus() // hvit grunn → mørk statuslinje
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const { mapper, tegninger: drawings } = useMapper(id ?? '')
  const members = useMembers(id ?? '')
  const rooms = useRooms(id ?? '')
  const tasks = useTasks(id ?? '')
  const role = useUserRole()
  const canAskStatus = role !== null && PROJECT_STATUS_ROLES.has(role)
  // Bas/PL/eier deler ut oppgaver; montør ser og lukker sine.
  const kanDeleUt = canAskStatus
  const userId = useUserId()
  const [taskSheet, setTaskSheet] = useState<TaskPinSheetState>(null)
  const memberNavn = new Map(members.map(m => [m.userId, m.userName || 'Ukjent']))
  const romNavn = new Map(rooms.map(r => [r.id, r.name]))
  const { lastCompletedSessionId, clearLastCompleted } = useVoiceSession()
  const [statusProcessing, setStatusProcessing] = useState(false)
  const [statusOutcome, setStatusOutcome] = useState<ProjectStatusOutcome | null>(null)

  useEffect(() => {
    if (!id) return
    const sub = database.get<Project>('projects').findAndObserve(id).subscribe({
      next: setProject, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [id])

  // Egen assistent-økt for prosjektstatus ble nettopp avsluttet — spør Gemini
  // (aggregeringen er allerede lokal, se lib/ai/project-status.ts) og les svaret høyt.
  useEffect(() => {
    if (!lastCompletedSessionId || !id) return
    const sessionId = lastCompletedSessionId
    let mounted = true
    ;(async () => {
      const draft = await loadDraft(sessionId)
      if (!draft || draft.routeContext.screen !== 'prosjekt' || draft.routeContext.projectId !== id) return
      clearLastCompleted()
      // Samme rolle-gating som mic-knappen — rist virker fortsatt (global gest), men
      // spørringen kjøres ikke for en rolle uten tilgang (se plan: Fase 3 rolle-gating).
      if (!canAskStatus) return
      setStatusProcessing(true)
      const outcome = await runProjectStatusQuery(draft)
      if (!mounted) return
      setStatusProcessing(false)
      setStatusOutcome(outcome)
      if (outcome.kind === 'answered') speak(outcome.spokenReply)
    })()
    return () => { mounted = false }
  }, [lastCompletedSessionId, id, clearLastCompleted])

  if (!project) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ToolGlow height={360} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} pressScale={0.92}
              style={{
                width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.cardGlassStrong,
                borderWidth: 0.5, borderColor: colors.glassEdge, alignItems: 'center', justifyContent: 'center',
              }}>
              <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
            </Pressable>
            {canAskStatus && <MegAvatar />}
          </View>

          {statusProcessing && (
            <View style={{
              backgroundColor: colors.brandSoft, borderRadius: radius.md,
              marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
            }}>
              <Text style={[t.footnote, { color: colors.brand }]}>Ser på fremdriften …</Text>
            </View>
          )}

          {statusOutcome && (
            <Pressable
              onPress={() => setStatusOutcome(null)}
              style={{
                backgroundColor: statusOutcome.kind === 'answered' ? colors.brandSoft : colors.warningSoft,
                borderRadius: radius.md, marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
              }}
            >
              <Text style={[t.subhead, { color: statusOutcome.kind === 'answered' ? colors.brand : colors.label }]}>
                {statusOutcome.kind === 'answered' ? statusOutcome.spokenReply : 'Fikk ikke svart — prøv igjen.'}
              </Text>
            </Pressable>
          )}

          <Text style={[t.title1, { marginTop: spacing.lg }]}>{project.name}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {[project.customerName, project.address, projectStatusLabel[project.status]].filter(Boolean).join(' · ')}
          </Text>

          <DetektorlisteRow projectId={project.id} />
        </View>

        {/* Tegninger — det du kom hit for. Derfor først. Mapper (bygg → fag) som
            rader, tegningene på rota som fliser; handlingene ligger på nivået. */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Tegninger</SectionHeader>
          <MappeInnhold projectId={project.id} parentId={null} mapper={mapper} tegninger={drawings} userId={userId} />
        </View>
        {/* Medlemmer — trykk for å sette LiDAR-ansvarlig, hold for å fjerne */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Folk på prosjektet</SectionHeader>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginHorizontal: spacing.screen }}>
            {members.map(m => {
              const responsible = !!m.isScanResponsible
              return (
              <Pressable
                key={m.id}
                haptic="light"
                onPress={() => toggleScanResponsible(m, members)}
                onLongPress={async () => { await database.write(async () => m.markAsDeleted()); syncQuietly() }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill,
                  paddingLeft: spacing.xs, paddingRight: spacing.md, paddingVertical: spacing.xs,
                  backgroundColor: responsible ? colors.brandSoft : colors.cardGlassStrong,
                  borderWidth: 0.5, borderColor: responsible ? colors.brand : colors.glassEdge,
                }}
              >
                <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: responsible ? colors.brand : colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                  {responsible
                    ? <ScanLine size={16} color="#fff" strokeWidth={2.2} />
                    : <Text style={[t.caption, { color: colors.iconMuted, fontWeight: '600' }]}>{initials(m.userName)}</Text>}
                </View>
                <Text style={[t.subhead, responsible && { color: colors.brand, fontWeight: '600' }]} numberOfLines={1}>{m.userName}</Text>
              </Pressable>
              )
            })}
            <Pressable
              pressScale={0.95}
              onPress={() => router.push({ pathname: '/(app)/prosjekter/medlem', params: { projectId: project.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.cardGlassStrong, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 0.5, borderColor: colors.glassEdge }}
            >
              <UserPlus size={16} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
              <Text style={[t.subhead, { color: colors.secondaryLabel }]}>Legg til folk</Text>
            </Pressable>
          </View>
          {members.length > 0 && (
            <Text style={[t.caption, { marginHorizontal: spacing.screen + spacing.xs, marginTop: spacing.sm, color: colors.tertiaryLabel }]}>
              Trykk på en person for å gjøre dem LiDAR-ansvarlig
            </Text>
          )}
        </View>

        {/* Oppgaver — basen deler ut, montøren lukker. Rad = åpne, sirkel = ferdig. */}
        {(tasks.length > 0 || kanDeleUt) && (
          <View style={{ marginBottom: spacing.screen }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: spacing.screen + spacing.lg, marginBottom: spacing.sm - 1 }}>
              <Text style={[t.eyebrow, { textTransform: 'uppercase' }]}>Oppgaver</Text>
              {kanDeleUt && (
                <Pressable onPress={() => setTaskSheet({ mode: 'ny', projectId: project.id })} hitSlop={8}>
                  <Text style={[t.caption, { color: colors.brand, fontWeight: '600' }]}>+ Ny oppgave</Text>
                </Pressable>
              )}
            </View>
            {tasks.length === 0 ? (
              <GlassEmpty
                Icon={CircleCheckBig}
                text="Del ut oppgaver til folk på prosjektet, gjerne knyttet til et rom."
                cta={{ label: 'Ny oppgave', onPress: () => setTaskSheet({ mode: 'ny', projectId: project.id }) }}
              />
            ) : (
              <GlassListGroup>
                {[...tasks].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)).map((task, i, arr) => {
                  const done = task.status === 'done'
                  const under = [
                    task.assignedTo ? memberNavn.get(task.assignedTo) ?? null : 'Ingen mottaker',
                    task.roomId ? romNavn.get(task.roomId) ?? null : null,
                    task.fristAt ? `Frist ${task.fristAt.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}` : null,
                  ].filter(Boolean).join(' · ')
                  return (
                    <Pressable
                      key={task.id}
                      haptic="light"
                      onPress={() => setTaskSheet({ mode: 'vis', task })}
                      style={[
                        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                        i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                      ]}
                    >
                      <Pressable haptic="light" hitSlop={10} onPress={() => toggleTaskDone(task)}>
                        {done
                          ? <CircleCheckBig size={sizes.icon} color={colors.success} strokeWidth={2} />
                          : <Circle size={sizes.icon} color={colors.tertiaryLabel} strokeWidth={2} />}
                      </Pressable>
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={[t.body, done && { color: colors.tertiaryLabel, textDecorationLine: 'line-through' }]} numberOfLines={2}>
                          {task.title}
                        </Text>
                        {!!under && <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>{under}</Text>}
                      </View>
                      {task.kind === 'lidar_scan' && (
                        <ScanSearch size={16} color={done ? colors.tertiaryLabel : colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                      )}
                    </Pressable>
                  )
                })}
              </GlassListGroup>
            )}
          </View>
        )}

      </ScrollView>
      <TaskPinSheet state={taskSheet} userId={userId} onClose={() => setTaskSheet(null)} />
    </View>
  )
}
