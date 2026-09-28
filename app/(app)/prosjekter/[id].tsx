import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, ScrollView, Alert } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, ChevronRight, Plus, UserPlus, ScanLine, Circle, CircleCheckBig, ScanSearch, MapPin, Search, X } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader, GlassListGroup } from '../../../components/ui'
import { MappeInnhold, useMapper, mappeSti } from '../../../components/tegning-mapper'
import { DrawingThumb } from '../../../components/drawing-thumb'
import { ToolGlow } from '../../../components/tool-surface'
import { usePapirFokus } from '../../../components/papir-surface'
import { MegAvatar } from '../../../components/meg-avatar'
import { FremdriftRing } from '../../../components/fremdrift-ring'
import { ChoiceSheet } from '../../../components/sheet'
import { hentSisteTegninger } from '../../../lib/siste-tegning'
import { fremdrift, aapneTekst } from '../../../lib/prosjekt-fremdrift'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Project, projectStatusLabel } from '../../../lib/db/models/project'
import { Drawing, disciplineLabel, type Discipline } from '../../../lib/db/models/drawing'
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
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

// Nærmeste vi har til «prosjektleder» — ingen egen rolle finnes (se plan). Bekreft
// med bruker om montør skal ekskluderes helt; dette er en produktbeslutning.
const PROJECT_STATUS_ROLES = new Set(['owner', 'admin', 'bas', 'baas'])

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

function useDevices(projectId: string) {
  const [devices, setDevices] = useState<FireDevice[]>([])
  useEffect(() => {
    if (!projectId) return
    const sub = database.get<FireDevice>('fire_devices')
      .query(Q.where('project_id', projectId))
      .observeWithColumns(['placed_at']).subscribe(setDevices)
    return () => sub.unsubscribe()
  }, [projectId])
  return devices
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

const aapneTegning = (d: Drawing) => router.push({ pathname: '/(app)/prosjekter/tegning', params: { drawingId: d.id } })

/** Én tegning som rad — brukt av søket og fag-filteret. Stien sier hvor den bor. */
function TegningRad({ d, sti, siste }: { d: Drawing; sti: string; siste: boolean }) {
  return (
    <Pressable haptic="light" onPress={() => aapneTegning(d)}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
        !siste && { borderBottomWidth: 1, borderBottomColor: colors.separator }]}>
      <DrawingThumb filePath={d.filePath} px={240} style={{ width: 56, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.separator }} />
      <View style={{ flex: 1 }}>
        <Text style={t.bodyMedium} numberOfLines={1}>{d.name}</Text>
        <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
          {[sti || null, disciplineLabel[d.discipline] ?? d.discipline, d.plan || null].filter(Boolean).join(' · ')}
        </Text>
      </View>
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
  const devices = useDevices(id ?? '')
  const role = useUserRole()
  const canAskStatus = role !== null && PROJECT_STATUS_ROLES.has(role)
  // Bas/PL/eier deler ut oppgaver; montør ser og lukker sine.
  const kanDeleUt = canAskStatus
  const userId = useUserId()
  const [taskSheet, setTaskSheet] = useState<TaskPinSheetState>(null)
  const [medlemValg, setMedlemValg] = useState<ProjectMember | null>(null)
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

  // ── FINNE TEGNINGEN (Tormod 2026-09-24: «kjempe oversiktlig og lett å finne
  // fram tegninger»). Tre veier inn, raskest først: sist åpnet · søk · fag.
  // Mappetreet under er for å bla, ikke for å lete. ──
  const [sisteIder, setSisteIder] = useState<string[]>([])
  useFocusEffect(useCallback(() => {
    if (id) hentSisteTegninger(id).then(setSisteIder)
  }, [id]))
  const sist = sisteIder.map(x => drawings.find(d => d.id === x)).filter((d): d is Drawing => !!d)

  const [sok, setSok] = useState('')
  const [fag, setFag] = useState<Discipline | null>(null)
  const sti = (d: Drawing) => mappeSti(d.folderId ?? null, mapper).join(' / ')
  const fagMedAntall = useMemo(() => {
    const n = new Map<Discipline, number>()
    for (const d of drawings) n.set(d.discipline, (n.get(d.discipline) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1])
  }, [drawings])
  const treff = useMemo(() => {
    const ord = sok.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!ord.length && !fag) return null
    return drawings.filter(d => {
      if (fag && d.discipline !== fag) return false
      const hay = [d.name, d.plan, disciplineLabel[d.discipline], mappeSti(d.folderId ?? null, mapper).join(' ')].join(' ').toLowerCase()
      return ord.every(o => hay.includes(o))
    })
  }, [sok, fag, drawings, mapper])

  if (!project) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />

  const naa = new Date()
  const tall = fremdrift(
    devices.map(d => ({ montert: !!d.placedAt })),
    tasks.map(x => ({ apen: x.status === 'open', frist: x.fristAt })),
    naa,
  )
  const underlinje = [project.customerName, project.address, projectStatusLabel[project.status]].filter(Boolean).join(' · ')

  /** Oppgave festet på en tegning: åpne tegningen. Ellers oppgavearket. */
  function aapneOppgave(task: Task) {
    const d = task.drawingId && task.pinX !== null ? drawings.find(x => x.id === task.drawingId) : null
    if (d?.filePath) aapneTegning(d)
    else setTaskSheet({ mode: 'vis', task })
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ToolGlow height={360} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>{underlinje}</Text>

          {/* Det ene tallet. Med brannkomponenter åpner det detektorlista. */}
          {tall && (
            <Pressable haptic="light" pressScale={0.98} disabled={!devices.length}
              onPress={() => router.push({ pathname: '/(app)/prosjekter/detektorliste', params: { projectId: project.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg }}>
              <FremdriftRing andel={tall.andel} storrelse={48} tekst={`${Math.round(tall.andel * 100)}`} />
              <View style={{ flex: 1 }}>
                <Text style={[t.headline, { fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{tall.hoved}</Text>
                <Text style={[t.footnote, { marginTop: 1 }, tall.forfalt > 0 && { color: colors.danger }]} numberOfLines={1}>{aapneTekst(tall)}</Text>
              </View>
              {devices.length > 0 && <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={2} />}
            </Pressable>
          )}
        </View>

        {/* Søk i ALLE tegningene — navn, plan, fag og mappe. Finner på tvers av treet. */}
        {drawings.length > 0 && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.screen, marginBottom: spacing.md,
            height: 44, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.fill,
          }}>
            <Search size={17} color={colors.secondaryLabel} strokeWidth={2} />
            <TextInput value={sok} onChangeText={setSok} placeholder={`Søk i ${drawings.length} ${drawings.length === 1 ? 'tegning' : 'tegninger'}`}
              placeholderTextColor={colors.tertiaryLabel} returnKeyType="search" autoCorrect={false}
              style={[t.body, { flex: 1, color: colors.label, paddingVertical: 0 }]} />
            {!!sok && (
              <Pressable haptic="light" hitSlop={10} onPress={() => setSok('')}>
                <X size={16} color={colors.secondaryLabel} strokeWidth={2.2} />
              </Pressable>
            )}
          </View>
        )}

        {/* Fag med antall — ett trykk snevrer inn, ett til slipper. Bare når det finnes mer enn ett fag. */}
        {fagMedAntall.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.screen }} style={{ marginBottom: spacing.lg, flexGrow: 0 }}>
            {fagMedAntall.map(([f, n]) => {
              const valgt = fag === f
              return (
                <Pressable key={f} haptic="light" pressScale={0.96} onPress={() => setFag(valgt ? null : f)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: spacing.md, borderRadius: radius.pill,
                    backgroundColor: valgt ? colors.label : colors.bg, borderWidth: valgt ? 0 : 1, borderColor: colors.separator,
                  }}>
                  <Text style={[t.subhead, { fontWeight: '600', color: valgt ? '#FFFFFF' : colors.label }]}>{disciplineLabel[f] ?? f}</Text>
                  <Text style={[t.subhead, { color: valgt ? 'rgba(255,255,255,0.7)' : colors.tertiaryLabel, fontVariant: ['tabular-nums'] }]}>{n}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        )}

        {treff ? (
          /* Søk/fag aktivt: én flat liste på tvers av mappene, stien under hvert navn. */
          <View style={{ marginBottom: spacing.screen }}>
            <SectionHeader>{`${treff.length} ${treff.length === 1 ? 'tegning' : 'tegninger'}`}</SectionHeader>
            {treff.length === 0 ? (
              <Text style={[t.footnote, { marginHorizontal: spacing.screen + spacing.xs }]}>Ingen tegning passer. Prøv et annet ord, eller et annet fag.</Text>
            ) : (
              <View style={{ marginHorizontal: spacing.screen, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator }}>
                {treff.map((d, i) => <TegningRad key={d.id} d={d} sti={sti(d)} siste={i === treff.length - 1} />)}
              </View>
            )}
          </View>
        ) : (
          <>
            {/* Sist åpnet — den du så på i går er nesten alltid den du leter etter i dag. */}
            {sist.length > 0 && (
              <View style={{ marginBottom: spacing.screen }}>
                <SectionHeader>Sist åpnet</SectionHeader>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm + 2, paddingHorizontal: spacing.screen }}>
                  {sist.map(d => (
                    <Pressable key={d.id} haptic="light" pressScale={0.97} onPress={() => aapneTegning(d)}
                      style={{ width: 168, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator }}>
                      <DrawingThumb filePath={d.filePath} px={400} style={{ height: 104 }} />
                      <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.separator }}>
                        <Text style={t.subhead} numberOfLines={1}>{d.name}</Text>
                        <Text style={[t.caption, { marginTop: 1, color: colors.secondaryLabel }]} numberOfLines={1}>
                          {sti(d) || disciplineLabel[d.discipline] || d.plan}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Alle tegningene — mapper (bygg → fag) som rader, tegningene som fliser. For å bla. */}
            <View style={{ marginBottom: spacing.screen }}>
              <SectionHeader>{sist.length ? 'Alle tegninger' : 'Tegninger'}</SectionHeader>
              <MappeInnhold projectId={project.id} parentId={null} mapper={mapper} tegninger={drawings} userId={userId} />
            </View>
          </>
        )}

        {/* Oppgaver — basen deler ut, montøren lukker. Rad med pin åpner tegningen, sirkel = ferdig. */}
        {(tasks.length > 0 || kanDeleUt) && (
          <View style={{ marginBottom: spacing.screen }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: spacing.screen + spacing.lg, marginBottom: spacing.sm - 1 }}>
              {/* Overskriften åpner hele oppgavelista (filtre: åpne/mine/ferdig). */}
              <Pressable onPress={() => router.push({ pathname: '/(app)/prosjekter/oppgaver', params: { projectId: project.id } })} hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={[t.eyebrow, { textTransform: 'uppercase' }]}>Oppgaver</Text>
                {tasks.length > 0 && <ChevronRight size={12} color={colors.tertiaryLabel} strokeWidth={2.2} />}
              </Pressable>
              {/* Pluss i hodet KUN når seksjonen har innhold; tom seksjon er selv handlingen (ui-rydding 2026-09-02). */}
              {kanDeleUt && tasks.length > 0 && (
                <Pressable onPress={() => setTaskSheet({ mode: 'ny', projectId: project.id })} hitSlop={8}>
                  <Text style={[t.caption, { color: colors.brand, fontWeight: '600' }]}>+ Ny oppgave</Text>
                </Pressable>
              )}
            </View>
            {tasks.length === 0 ? (
              /* Én stiplet rad som ER handlingen — ikke en fylt knapp nr. 2 på skjermen. */
              <Pressable haptic="light" pressScale={0.98}
                onPress={() => setTaskSheet({ mode: 'ny', projectId: project.id })}
                style={{
                  marginHorizontal: spacing.screen, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.separator, borderStyle: 'dashed',
                  flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
                }}>
                <Plus size={sizes.icon - 2} color={colors.secondaryLabel} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={t.bodyMedium}>Ny oppgave</Text>
                  <Text style={[t.footnote, { marginTop: 1 }]}>Del ut til folk på prosjektet, gjerne knyttet til et rom</Text>
                </View>
              </Pressable>
            ) : (
              <GlassListGroup>
                {[...tasks].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)).map((task, i, arr) => {
                  const done = task.status === 'done'
                  const forfalt = !done && !!task.fristAt && task.fristAt < naa
                  const paaTegning = !!task.drawingId && task.pinX !== null
                  const under = [
                    task.assignedTo ? memberNavn.get(task.assignedTo) ?? null : 'Ingen mottaker',
                    task.roomId ? romNavn.get(task.roomId) ?? null : null,
                    task.fristAt ? `Frist ${task.fristAt.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}` : null,
                  ].filter(Boolean).join(' · ')
                  return (
                    <Pressable
                      key={task.id}
                      haptic="light"
                      onPress={() => aapneOppgave(task)}
                      style={[
                        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                        i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                      ]}
                    >
                      <Pressable haptic="light" hitSlop={10} onPress={() => toggleTaskDone(task)}>
                        {done
                          ? <CircleCheckBig size={sizes.icon} color={colors.success} strokeWidth={2} />
                          : <Circle size={sizes.icon} color={forfalt ? colors.danger : colors.tertiaryLabel} strokeWidth={2} />}
                      </Pressable>
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={[t.body, done && { color: colors.tertiaryLabel, textDecorationLine: 'line-through' }]} numberOfLines={2}>
                          {task.title}
                        </Text>
                        {!!under && <Text style={[t.footnote, { marginTop: 1 }, forfalt && { color: colors.danger }]} numberOfLines={1}>{under}</Text>}
                      </View>
                      {paaTegning && !done && <MapPin size={16} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
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

        {/* Folk — trykk åpner valgene (LiDAR-ansvarlig, fjern). Ingen skjulte gester. */}
        <View style={{ marginBottom: spacing.screen }}>
          <SectionHeader>Folk på prosjektet</SectionHeader>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginHorizontal: spacing.screen }}>
            {members.map(m => {
              const responsible = !!m.isScanResponsible
              return (
                <Pressable
                  key={m.id}
                  haptic="light"
                  onPress={() => setMedlemValg(m)}
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
      </ScrollView>

      <TaskPinSheet state={taskSheet} userId={userId} onClose={() => setTaskSheet(null)} />
      <ChoiceSheet
        synlig={!!medlemValg}
        tittel={medlemValg?.userName || 'Person'}
        valg={[
          { verdi: 'ansvarlig' as const, etikett: medlemValg?.isScanResponsible ? 'Ikke LiDAR-ansvarlig lenger' : 'Gjør til LiDAR-ansvarlig', underetikett: 'Én per prosjekt — får skann-oppgavene' },
          { verdi: 'fjern' as const, etikett: 'Fjern fra prosjektet' },
        ]}
        onVelg={valg => {
          const m = medlemValg
          setMedlemValg(null)
          if (!m) return
          if (valg === 'ansvarlig') { void toggleScanResponsible(m, members); return }
          Alert.alert(`Fjerne ${m.userName || 'personen'}?`, 'Oppgavene de har fått står igjen.', [
            { text: 'Avbryt', style: 'cancel' },
            { text: 'Fjern', style: 'destructive', onPress: async () => { await database.write(async () => m.markAsDeleted()); syncQuietly() } },
          ])
        }}
        onAvbryt={() => setMedlemValg(null)}
      />
    </View>
  )
}
