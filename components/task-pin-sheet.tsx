// Ark for oppgave-pins på tegning (fase 3, docs/TEGNING_MULTIVIEW_PLAN.md).
// «ny»: tittel + mottaker (prosjektmedlem) + frist-hurtigvalg → tasks-rad med
// pin-koordinat. «vis»: den tildeltes eget ark — Ferdig fjerner pinnen fra
// tegningen (status='done'; raden består for historikk, aldri DELETE).
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text, TextInput } from './text'
import { Q } from '@nozbe/watermelondb'
import { Ark } from './sheet'
import { Pressable } from './pressable'
import { database } from '../lib/db'
import { syncQuietly } from '../lib/db/sync'
import { Task } from '../lib/db/models/task'
import { ProjectMember } from '../lib/db/models/project-member'
import { colors, radius, spacing, type as t } from '../lib/theme'

export type TaskPinSheetState =
  | { mode: 'ny'; projectId: string; drawingId: string; x: number; y: number }
  | { mode: 'vis'; task: Task }
  | null

const FRISTER: { label: string; dager: number | null }[] = [
  { label: 'Ingen frist', dager: null },
  { label: 'I dag', dager: 0 },
  { label: 'I morgen', dager: 1 },
  { label: 'Om en uke', dager: 7 },
]

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable haptic="light" pressScale={0.96} onPress={onPress}
      style={{
        paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: selected ? colors.brand : colors.bg,
        borderWidth: selected ? 0 : 1, borderColor: colors.border,
      }}>
      <Text style={[t.footnote, { fontWeight: '600', color: selected ? colors.brandLabel : colors.label }]}>
        {label}
      </Text>
    </Pressable>
  )
}

export function TaskPinSheet({ state, userId, onClose }: {
  state: TaskPinSheetState
  userId: string | null
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [memberId, setMemberId] = useState<string | null>(null)
  const [frist, setFrist] = useState<number | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])

  const projectId = state?.mode === 'ny' ? state.projectId : null
  useEffect(() => {
    if (!projectId) { setMembers([]); return }
    const sub = database.get<ProjectMember>('project_members')
      .query(Q.where('project_id', projectId))
      .observe().subscribe(setMembers)
    return () => sub.unsubscribe()
  }, [projectId])

  useEffect(() => {
    if (state?.mode === 'ny') { setTitle(''); setMemberId(null); setFrist(null) }
  }, [state])

  async function lagre() {
    if (state?.mode !== 'ny' || !title.trim() || !memberId) return
    const fristAt = frist === null ? null : new Date(Date.now() + frist * 86_400_000)
    await database.write(async () => {
      await database.get<Task>('tasks').create(x => {
        x.projectId = state.projectId
        x.kind = 'general'
        x.title = title.trim()
        x.status = 'open'
        x.assignedTo = memberId
        x.createdBy = userId
        x.drawingId = state.drawingId
        x.pinX = state.x
        x.pinY = state.y
        x.fristAt = fristAt
        x.synlighet = 'tildelt' // pinnen vises KUN for mottakeren
      })
    })
    syncQuietly()
    onClose()
  }

  async function ferdig() {
    if (state?.mode !== 'vis') return
    const task = state.task
    await database.write(async () => {
      await task.update(x => { x.status = 'done'; x.doneAt = new Date() })
    })
    syncQuietly()
    onClose()
  }

  return (
    <Ark synlig={state !== null} onLukk={onClose}>
      {state?.mode === 'ny' && (
        <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
          <Text style={t.title3}>Ny oppgave her</Text>
          <TextInput
            value={title} onChangeText={setTitle} placeholder="Hva skal gjøres?"
            placeholderTextColor={colors.tertiaryLabel} autoFocus
            style={[t.body, {
              backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1,
              borderColor: colors.border, paddingHorizontal: spacing.md, height: 46, color: colors.label,
            }]}
          />
          <View>
            <Text style={[t.footnote, { color: colors.secondaryLabel, marginBottom: spacing.xs }]}>Til</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {members.map(m => (
                <Chip key={m.id} label={m.userName || 'Ukjent'} selected={memberId === m.userId}
                  onPress={() => setMemberId(m.userId)} />
              ))}
              {members.length === 0 && (
                <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>Ingen medlemmer i prosjektet</Text>
              )}
            </View>
          </View>
          <View>
            <Text style={[t.footnote, { color: colors.secondaryLabel, marginBottom: spacing.xs }]}>Frist</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {FRISTER.map(f => (
                <Chip key={f.label} label={f.label} selected={frist === f.dager} onPress={() => setFrist(f.dager)} />
              ))}
            </View>
          </View>
          <Pressable haptic="medium" onPress={lagre}
            style={{
              height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
              backgroundColor: colors.brand, opacity: title.trim() && memberId ? 1 : 0.4, marginTop: spacing.xs,
            }}>
            <Text style={[t.headline, { color: colors.brandLabel }]}>Send oppgaven</Text>
          </Pressable>
        </View>
      )}
      {state?.mode === 'vis' && (
        <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
          <Text style={t.title3}>{state.task.title}</Text>
          {!!state.task.fristAt && (
            <Text style={[t.footnote, { color: colors.secondaryLabel }]}>
              Frist {state.task.fristAt.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
            </Text>
          )}
          {!!state.task.beskrivelse && <Text style={t.body}>{state.task.beskrivelse}</Text>}
          <Pressable haptic="medium" onPress={ferdig}
            style={{
              height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
              backgroundColor: colors.brand, marginTop: spacing.xs,
            }}>
            <Text style={[t.headline, { color: colors.brandLabel }]}>Ferdig</Text>
          </Pressable>
        </View>
      )}
    </Ark>
  )
}
