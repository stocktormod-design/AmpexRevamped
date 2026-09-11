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
import { Room } from '../lib/db/models/room'
import { colors, radius, spacing, type as t } from '../lib/theme'

export type TaskPinSheetState =
  /** Ny oppgave. Fra tegning: med pin (drawingId/x/y). Fra prosjekt eller rom: uten. */
  | { mode: 'ny'; projectId: string; drawingId?: string; x?: number; y?: number; roomId?: string }
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
  const [beskrivelse, setBeskrivelse] = useState('')
  const [roomId, setRoomId] = useState<string | null>(null)
  const [skann, setSkann] = useState(false) // kind = lidar_scan
  const [rooms, setRooms] = useState<Room[]>([])

  const projectId = state?.mode === 'ny' ? state.projectId : null
  useEffect(() => {
    if (!projectId) { setMembers([]); return }
    const sub = database.get<ProjectMember>('project_members')
      .query(Q.where('project_id', projectId))
      .observe().subscribe(setMembers)
    return () => sub.unsubscribe()
  }, [projectId])

  useEffect(() => {
    if (!projectId) { setRooms([]); return }
    const sub = database.get<Room>('rooms')
      .query(Q.where('project_id', projectId), Q.sortBy('name', Q.asc))
      .observe().subscribe(setRooms)
    return () => sub.unsubscribe()
  }, [projectId])

  useEffect(() => {
    if (state?.mode === 'ny') {
      setTitle(''); setMemberId(null); setFrist(null); setBeskrivelse(''); setSkann(false)
      setRoomId(state.roomId ?? null)
    }
  }, [state])

  // Skann-oppgave: tittelen gir seg selv av rommet.
  const romnavn = rooms.find(r => r.id === roomId)?.name
  const effTittel = skann && romnavn ? `LiDAR-skann: ${romnavn}` : title.trim()
  const kanSende = !!effTittel && !!memberId && (!skann || !!roomId)

  async function lagre() {
    if (state?.mode !== 'ny' || !kanSende) return
    const fristAt = frist === null ? null : new Date(Date.now() + frist * 86_400_000)
    await database.write(async () => {
      await database.get<Task>('tasks').create(x => {
        x.projectId = state.projectId
        x.kind = skann ? 'lidar_scan' : 'general'
        x.title = effTittel
        x.status = 'open'
        x.assignedTo = memberId
        x.createdBy = userId
        x.roomId = roomId
        x.beskrivelse = beskrivelse.trim() || null
        if (state.drawingId && state.x !== undefined && state.y !== undefined) {
          x.drawingId = state.drawingId
          x.pinX = state.x
          x.pinY = state.y
          x.synlighet = 'tildelt' // pinnen vises KUN for mottakeren
        }
        x.fristAt = fristAt
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
          <Text style={t.title3}>{state.drawingId ? 'Ny oppgave her' : 'Ny oppgave'}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <Chip label="Oppgave" selected={!skann} onPress={() => setSkann(false)} />
            <Chip label="LiDAR-skann av rom" selected={skann} onPress={() => setSkann(true)} />
          </View>
          {!skann && (
            <TextInput
              value={title} onChangeText={setTitle} placeholder="Hva skal gjøres?"
              placeholderTextColor={colors.tertiaryLabel} autoFocus
              style={[t.body, {
                backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1,
                borderColor: colors.border, paddingHorizontal: spacing.md, height: 46, color: colors.label,
              }]}
            />
          )}
          {rooms.length > 0 && (
            <View>
              <Text style={[t.footnote, { color: colors.secondaryLabel, marginBottom: spacing.xs }]}>{skann ? 'Rom som skal skannes' : 'Rom (valgfritt)'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {!skann && <Chip label="Ingen" selected={roomId === null} onPress={() => setRoomId(null)} />}
                {rooms.map(r => (
                  <Chip key={r.id} label={r.name} selected={roomId === r.id} onPress={() => setRoomId(r.id)} />
                ))}
              </View>
            </View>
          )}
          <TextInput
            value={beskrivelse} onChangeText={setBeskrivelse} placeholder="Notat til den som får oppgaven"
            placeholderTextColor={colors.tertiaryLabel} multiline
            style={[t.body, {
              backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1,
              borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 64, color: colors.label,
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
              backgroundColor: colors.brand, opacity: kanSende ? 1 : 0.4, marginTop: spacing.xs,
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
