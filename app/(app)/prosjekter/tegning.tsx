import { useEffect, useState } from 'react'
import { View, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Check, ChevronLeft, Columns2, FileText, Hand, MousePointer2, Pencil, Slash, Undo2, Upload, Waypoints } from 'lucide-react-native'
import { useSharedValue } from 'react-native-reanimated'
import { Pressable } from '../../../components/pressable'
import { DrawingPane, type EditTool } from '../../../components/drawing-pane'
import { TaskPinSheet, type TaskPinSheetState } from '../../../components/task-pin-sheet'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { DrawingMarkup, type Stroke } from '../../../lib/db/models/drawing-markup'
import { Task } from '../../../lib/db/models/task'
import { uploadDrawingPdf, getLocalPdf } from '../../../lib/drawings-storage'
import { loadDraft, saveDraft, clearDraft } from '../../../lib/markup-drafts'
import { useUserId } from '../../../lib/auth-user'
import { colors, spacing, radius, sizes, shadows, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

// Forma-lys arbeidsflate — matcher editoren
const WORKSPACE = '#E7E7EC'
const PANEL = 'rgba(252,252,253,0.96)'

export default function TegningViewer() {
  // Mørk klokke og batteri: dette er papir, ikke brun grunn.
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const { drawingId } = useLocalSearchParams<{ drawingId: string }>()
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [siblings, setSiblings] = useState<Drawing[]>([])
  const [localUri, setLocalUri] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const userId = useUserId()
  const win = useWindowDimensions()

  // Vieweren kjører på DrawingPane (rasterert side + eid transform + Skia) —
  // samme komponent som multiview. NB: kun side 1 inntil sideveksler bygges.
  const scale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  useEffect(() => { scale.value = 1; tx.value = 0; ty.value = 0 }, [drawingId, scale, tx, ty])

  // ── Edit-modus (Autodesk-mønstrene: samme lerret, verktøylinje til høyre,
  // kontekstuell redigering ved valg — se research i TEGNING_MULTIVIEW_PLAN) ──
  const [editMode, setEditMode] = useState(false)
  const [tool, setTool] = useState<EditTool>('penn')
  const [color, setColor] = useState('#FF3B30')
  const [penWidth, setPenWidth] = useState(4)
  const [draft, setDraft] = useState<Stroke[]>([])
  useEffect(() => {
    if (!drawingId) { setDraft([]); return }
    loadDraft(drawingId).then(setDraft)
  }, [drawingId])
  function changeDraft(next: Stroke[]) {
    setDraft(next)
    if (drawingId) saveDraft(drawingId, next).catch(() => {})
  }
  async function publish() {
    if (!drawing || draft.length === 0) { setEditMode(false); return }
    // Rad-formen fra v32: ÉN NY rad per publisering (aldri overskriv andres) —
    // fikser at samtidige publiseringer mistet strøk i blob-formen.
    await database.write(async () => {
      await database.get<DrawingMarkup>('drawing_markup').create(m => {
        m.drawingId = drawing.id
        m.data = JSON.stringify(draft)
        m.kind = 'stroke'
        m.createdBy = userId
      })
    })
    await clearDraft(drawing.id)
    setDraft([])
    syncQuietly()
    setEditMode(false)
  }

  // Oppgave-pins: KUN mine åpne (synlighet er tildelt-bare, plan-avgjørelse).
  const [myTasks, setMyTasks] = useState<Task[]>([])
  const [pinSheet, setPinSheet] = useState<TaskPinSheetState>(null)
  useEffect(() => {
    if (!drawingId || !userId) { setMyTasks([]); return }
    const sub = database.get<Task>('tasks')
      .query(Q.where('drawing_id', drawingId), Q.where('assigned_to', userId), Q.where('status', 'open'))
      .observe().subscribe(setMyTasks)
    return () => sub.unsubscribe()
  }, [drawingId, userId])

  // Aktiv tegning
  useEffect(() => {
    if (!drawingId) return
    const sub = database.get<Drawing>('drawings').findAndObserve(drawingId).subscribe({
      next: setDrawing, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [drawingId])

  // Søsken i samme plan (for swap-navbaren) — planen er inngangen fra prosjektet
  const planKey = drawing?.plan
  useEffect(() => {
    const projectId = drawing?.projectId
    if (!projectId || planKey == null) return
    const sub = database.get<Drawing>('drawings')
      .query(Q.where('project_id', projectId), Q.where('plan', planKey), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setSiblings)
    return () => sub.unsubscribe()
  }, [drawing?.projectId, planKey])

  // Hent PDF lokalt (cache) når tegningen har en fil
  const filePath = drawing?.filePath
  useEffect(() => {
    let mounted = true
    if (!filePath) { setLocalUri(null); return }
    setBusy(true)
    getLocalPdf(filePath)
      .then(uri => { if (mounted) setLocalUri(uri) })
      .catch(() => { if (mounted) setLocalUri(null) })
      .finally(() => { if (mounted) setBusy(false) })
    return () => { mounted = false }
  }, [filePath])

  async function pickAndUpload() {
    if (!drawing) return
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
    if (res.canceled || !res.assets?.[0]) return
    setBusy(true)
    try {
      const key = await uploadDrawingPdf(drawing.id, res.assets[0].uri)
      await database.write(async () => { await drawing.update(d => { d.filePath = key }) })
      syncQuietly()
    } finally {
      setBusy(false)
    }
  }

  if (!drawing) return <View style={{ flex: 1, backgroundColor: WORKSPACE }} />
  const panel = { backgroundColor: PANEL, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)', ...shadows.card } as const

  return (
    <View style={{ flex: 1, backgroundColor: WORKSPACE }}>
      {/* Lerret — DrawingPane (rasterert side + Skia-overlay). Langtrykk = ny
          oppgave-pin her; tap på pin = mitt oppgaveark. */}
      {localUri ? (
        <DrawingPane
          drawing={drawing}
          width={win.width} height={win.height}
          transform={{ scale, tx, ty }}
          pins={myTasks.filter(x => x.pinX !== null && x.pinY !== null).map(x => ({ id: x.id, x: x.pinX!, y: x.pinY! }))}
          edit={editMode ? { tool, color, width: penWidth, draft, onDraftChange: changeDraft } : undefined}
          onLongPress={pt => setPinSheet({ mode: 'ny', projectId: drawing.projectId, drawingId: drawing.id, x: pt.x, y: pt.y })}
          onTapPin={id => {
            const task = myTasks.find(x => x.id === id)
            if (task) setPinSheet({ mode: 'vis', task })
          }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          {busy ? (
            <ActivityIndicator color={colors.paperSecondary} />
          ) : (
            <>
              <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={30} color={colors.paperSecondary} strokeWidth={1.6} />
              </View>
              <Text style={[t.body, { color: colors.paperSecondary, marginTop: spacing.lg, textAlign: 'center' }]}>
                Ingen PDF lastet opp ennå
              </Text>
              <Pressable
                haptic="medium" onPress={pickAndUpload}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brand }}
              >
                <Upload size={sizes.icon - 2} color={colors.brandLabel} strokeWidth={sizes.lucideStroke} />
                <Text style={[t.headline, { color: colors.brandLabel }]}>Legg til PDF</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* Topp-pill (venstre) + rediger-øy (høyre) */}
      <View style={{ position: 'absolute', top: insets.top + spacing.sm, left: spacing.screen, right: spacing.screen, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }} pointerEvents="box-none">
        <View style={[panel, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 5, paddingRight: spacing.md, height: 44, borderRadius: radius.pill, maxWidth: '80%' }]}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.paperLabel} strokeWidth={2.2} />
          </Pressable>
          <View style={{ flexShrink: 1 }}>
            <Text style={[t.subhead, { fontWeight: '700' }]} numberOfLines={1}>{drawing.name}</Text>
            <Text style={t.caption} numberOfLines={1}>
              {[drawing.plan, disciplineLabel[drawing.discipline] ?? drawing.discipline].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        {localUri && !editMode && (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable onPress={() => router.push({ pathname: '/(app)/prosjekter/multiview', params: { projectId: drawing.projectId, drawingId: drawing.id } })} pressScale={0.92}
              style={[panel, { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }]}>
              <Columns2 size={sizes.icon - 1} color={colors.paperLabel} strokeWidth={2.1} />
            </Pressable>
            <Pressable onPress={() => setEditMode(true)} pressScale={0.92}
              style={[panel, { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }]}>
              <Pencil size={sizes.icon - 1} color={colors.paperLabel} strokeWidth={2.1} />
            </Pressable>
          </View>
        )}
        {localUri && editMode && (
          <Pressable haptic="medium" onPress={publish} pressScale={0.92}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
              paddingHorizontal: spacing.lg, height: 44, borderRadius: radius.pill,
              backgroundColor: colors.brand, ...shadows.card,
            }}>
            <Check size={sizes.icon - 2} color={colors.brandLabel} strokeWidth={2.4} />
            <Text style={[t.headline, { color: colors.brandLabel }]}>
              {draft.length > 0 ? `Publiser (${draft.length})` : 'Ferdig'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Verktøylinje (edit): vertikal høyre-rail — ACC/Bluebeam-plasseringen;
          velg gir kontekstuell redigering (grips + slett i DrawingPane). */}
      {editMode && (
        <View style={{ position: 'absolute', right: spacing.sm, top: '50%', transform: [{ translateY: -140 }] }} pointerEvents="box-none">
          <View style={[panel, { borderRadius: radius.pill, padding: 5, gap: 2 }]}>
            {([
              ['velg', MousePointer2],
              ['penn', Pencil],
              ['linje', Slash],
              ['sloyfe', Waypoints],
              ['pan', Hand],
            ] as const).map(([tl, Icon]) => (
              <Pressable key={tl} haptic="light" pressScale={0.92} onPress={() => setTool(tl)}
                style={{
                  width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: tool === tl ? colors.paperLabel : 'transparent',
                }}>
                <Icon size={19} color={tool === tl ? '#fff' : colors.paperLabel} strokeWidth={2.1} />
              </Pressable>
            ))}
          </View>
        </View>
      )}
      {/* Bunn-rail (edit): farger + bredder + angre */}
      {editMode && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.md, alignItems: 'center' }} pointerEvents="box-none">
          <View style={[panel, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, paddingHorizontal: spacing.md, height: 48 }]}>
            {['#FF3B30', '#0A84FF', '#34C759', '#FFD60A', '#000000'].map(c => (
              <Pressable key={c} haptic="light" onPress={() => setColor(c)}
                style={{
                  width: 24, height: 24, borderRadius: 12, backgroundColor: c,
                  borderWidth: color === c ? 3 : 1,
                  borderColor: color === c ? colors.paperLabel : 'rgba(0,0,0,0.15)',
                }} />
            ))}
            <View style={{ width: 0.5, height: 24, backgroundColor: 'rgba(0,0,0,0.12)' }} />
            {[2, 4, 8].map(w => (
              <Pressable key={w} haptic="light" onPress={() => setPenWidth(w)}
                style={{
                  width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: penWidth === w ? colors.paperFill : 'transparent',
                }}>
                <View style={{ width: 14, height: w, borderRadius: w / 2, backgroundColor: colors.paperLabel }} />
              </Pressable>
            ))}
            <View style={{ width: 0.5, height: 24, backgroundColor: 'rgba(0,0,0,0.12)' }} />
            <Pressable haptic="light" onPress={() => changeDraft(draft.slice(0, -1))}
              style={{ width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', opacity: draft.length ? 1 : 0.35 }}>
              <Undo2 size={18} color={colors.paperLabel} strokeWidth={2.1} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Swap-navbar: flytende lyse pill-øyer, bytt tegning i planen */}
      {!editMode && siblings.length > 1 && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.sm }} pointerEvents="box-none">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm }}>
            {siblings.map(d => {
              const active = d.id === drawing.id
              return (
                <Pressable
                  key={d.id} pressScale={0.95} haptic="light"
                  onPress={() => router.setParams({ drawingId: d.id })}
                  style={[panel, {
                    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg,
                    backgroundColor: active ? colors.paperLabel : PANEL, borderColor: active ? colors.paperLabel : 'rgba(0,0,0,0.08)',
                  }]}
                >
                  <Text style={[t.footnote, { fontWeight: '700', color: active ? '#fff' : colors.paperLabel }]} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text style={[t.caption, { color: active ? 'rgba(255,255,255,0.6)' : colors.paperTertiary }]} numberOfLines={1}>
                    {disciplineLabel[d.discipline] ?? d.discipline}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}

      <TaskPinSheet state={pinSheet} userId={userId} onClose={() => setPinSheet(null)} />
    </View>
  )
}
