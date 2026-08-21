import { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Plus, Layers, ChevronRight, UserPlus, DoorOpen, ScanLine, Circle, CircleCheckBig, ScanSearch } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader } from '../../../components/ui'
import { ToolGlow } from '../../../components/tool-surface'
import { AmpexMarkButton } from '../../../components/ampex-mark-button'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Project, projectStatusLabel } from '../../../lib/db/models/project'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { ProjectMember } from '../../../lib/db/models/project-member'
import { Room, overallProgress } from '../../../lib/db/models/room'
import { Task } from '../../../lib/db/models/task'
import { toggleTaskDone } from '../../../lib/tasks'
import { useUserRole } from '../../../lib/auth-user'
import { useVoiceSession } from '../../../lib/ai/voice-session'
import { loadDraft } from '../../../lib/ai/voice-drafts'
import { runProjectStatusQuery, type ProjectStatusOutcome } from '../../../lib/ai/project-status'
import { speak } from '../../../lib/ai/voice-speaker'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../../lib/theme'

// Nærmeste vi har til «prosjektleder» — ingen egen rolle finnes (se plan). Bekreft
// med bruker om montør skal ekskluderes helt; dette er en produktbeslutning.
const PROJECT_STATUS_ROLES = new Set(['owner', 'admin', 'bas', 'baas'])

/** Glass-listegruppe — skygge på wrapper, klipping+fyll på inner (samme mønster som GlassCard). */
function GlassListGroup({ children }: { children: React.ReactNode }) {
  return (
    <View style={[{ marginHorizontal: spacing.screen, borderRadius: radius.hero }, shadows.card]}>
      <View style={{
        backgroundColor: colors.cardGlassStrong, borderRadius: radius.hero, overflow: 'hidden',
        borderWidth: 0.5, borderColor: colors.glassEdge,
      }}>
        {children}
      </View>
    </View>
  )
}

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

export default function ProsjektDetailScreen() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const drawings = useDrawings(id ?? '')
  const members = useMembers(id ?? '')
  const rooms = useRooms(id ?? '')
  const tasks = useTasks(id ?? '')
  const role = useUserRole()
  const canAskStatus = role !== null && PROJECT_STATUS_ROLES.has(role)
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

  // Grupper tegninger på plan (rekkefølge etter første forekomst)
  const plans: string[] = []
  const byPlan = new Map<string, Drawing[]>()
  for (const d of drawings) {
    const key = d.plan || 'Uten plan'
    if (!byPlan.has(key)) { byPlan.set(key, []); plans.push(key) }
    byPlan.get(key)!.push(d)
  }

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
            {canAskStatus && <AmpexMarkButton />}
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

          <Pressable
            haptic="medium"
            onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning-ny', params: { projectId: project.id } })}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.brand, marginTop: spacing.lg,
            }}
          >
            <Plus size={sizes.icon} color="#fff" strokeWidth={2.2} />
            <Text style={[t.headline, { color: '#fff' }]}>Legg til tegning</Text>
          </Pressable>
        </View>

        {/* Medlemmer — trykk for å sette LiDAR-ansvarlig, hold for å fjerne */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Folk på prosjektet</SectionHeader>
          <Text style={[t.footnote, { marginHorizontal: spacing.screen + spacing.lg, marginTop: -spacing.xs, marginBottom: spacing.sm }]}>
            Trykk for LiDAR-ansvarlig
          </Text>
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
        </View>

        {/* Oppgaver — prosjektets to-do (inkl. LiDAR-forespørsler) */}
        {tasks.length > 0 && (
          <View style={{ marginBottom: spacing.screen }}>
            <SectionHeader>Oppgaver</SectionHeader>
            <GlassListGroup>
              {[...tasks].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)).map((task, i, arr) => {
                const done = task.status === 'done'
                return (
                  <Pressable
                    key={task.id}
                    haptic="light"
                    onPress={() => toggleTaskDone(task)}
                    style={[
                      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                      i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                    ]}
                  >
                    {done
                      ? <CircleCheckBig size={sizes.icon} color={colors.success} strokeWidth={2} />
                      : <Circle size={sizes.icon} color={colors.tertiaryLabel} strokeWidth={2} />}
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[t.body, done && { color: colors.tertiaryLabel, textDecorationLine: 'line-through' }]} numberOfLines={2}>
                        {task.title}
                      </Text>
                    </View>
                    {task.kind === 'lidar_scan' && (
                      <ScanSearch size={16} color={done ? colors.tertiaryLabel : colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                    )}
                  </Pressable>
                )
              })}
            </GlassListGroup>
          </View>
        )}

        {/* Rom — framdrift per rom (× fagfelt), grunnlag for LiDAR-skann */}
        <View style={{ marginBottom: spacing.screen }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: spacing.screen + spacing.lg, marginBottom: spacing.sm - 1 }}>
            <Text style={[t.caption, { textTransform: 'uppercase' }]}>Rom</Text>
            <Pressable onPress={() => router.push({ pathname: '/(app)/prosjekter/rom-ny', params: { projectId: project.id } })} hitSlop={8}>
              <Text style={[t.caption, { color: colors.secondaryLabel, textTransform: 'uppercase' }]}>Legg til</Text>
            </Pressable>
          </View>
          {rooms.length === 0 ? (
            <GlassEmpty
              Icon={DoorOpen}
              text="Spor framdrift per fagfelt og LiDAR-skanne."
              cta={{ label: 'Legg til rom', onPress: () => router.push({ pathname: '/(app)/prosjekter/rom-ny', params: { projectId: project.id } }) }}
            />
          ) : (
            <GlassListGroup>
              {rooms.map((r, i) => {
                const pct = overallProgress(r.progressMap)
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => router.push({ pathname: '/(app)/prosjekter/rom', params: { roomId: r.id } })}
                    style={[
                      { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                      i < rooms.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
                        <DoorOpen size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={t.body} numberOfLines={1}>{r.name}</Text>
                        <Text style={[t.footnote, { marginTop: 1 }]}>{r.plan}</Text>
                      </View>
                      <Text style={[t.bodyMedium, { color: colors.label, fontVariant: ['tabular-nums'], marginRight: spacing.sm }]}>{pct}%</Text>
                      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                    </View>
                    <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.fill, overflow: 'hidden', marginTop: spacing.sm, marginLeft: sizes.iconChip - 8 + spacing.md }}>
                      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: colors.label, borderRadius: radius.pill }} />
                    </View>
                  </Pressable>
                )
              })}
            </GlassListGroup>
          )}
        </View>

        {/* Tegninger — planen er inngangen; du bytter tegning i vieweren (swap-navbar) */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Tegninger</SectionHeader>
          {drawings.length === 0 ? (
            <GlassEmpty Icon={Layers} text="Ingen tegninger ennå. Per plan og fagfelt." />
          ) : (
            <GlassListGroup>
              {plans.map((plan, i) => {
                const list = byPlan.get(plan)!
                return (
                  <Pressable
                    key={plan}
                    onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning', params: { drawingId: list[0].id } })}
                    style={[
                      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                      i < plans.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                    ]}
                  >
                    <View style={{
                      width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm,
                      backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
                    }}>
                      <Layers size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                    </View>
                    <View style={{ flex: 1, marginRight: spacing.md }}>
                      <Text style={t.bodyMedium} numberOfLines={1}>{plan}</Text>
                      <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
                        {list.map(d => d.name).join(' · ')}
                      </Text>
                    </View>
                    <Text style={[t.footnote, { color: colors.tertiaryLabel, marginRight: spacing.sm }]}>
                      {`${list.length} tegn.`}
                    </Text>
                    <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                  </Pressable>
                )
              })}
            </GlassListGroup>
          )}
        </View>
      </ScrollView>
    </View>
  )
}
