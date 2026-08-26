import { useEffect, useState } from 'react'
import { View, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Columns2, FileText, Upload, Pencil } from 'lucide-react-native'
import { useSharedValue } from 'react-native-reanimated'
import { Pressable } from '../../../components/pressable'
import { DrawingPane } from '../../../components/drawing-pane'
import { TaskPinSheet, type TaskPinSheetState } from '../../../components/task-pin-sheet'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { Task } from '../../../lib/db/models/task'
import { uploadDrawingPdf, getLocalPdf } from '../../../lib/drawings-storage'
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
        {localUri && (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable onPress={() => router.push({ pathname: '/(app)/prosjekter/multiview', params: { projectId: drawing.projectId, drawingId: drawing.id } })} pressScale={0.92}
              style={[panel, { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }]}>
              <Columns2 size={sizes.icon - 1} color={colors.paperLabel} strokeWidth={2.1} />
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning-edit', params: { drawingId: drawing.id } })} pressScale={0.92}
              style={[panel, { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }]}>
              <Pencil size={sizes.icon - 1} color={colors.paperLabel} strokeWidth={2.1} />
            </Pressable>
          </View>
        )}
      </View>

      {/* Swap-navbar: flytende lyse pill-øyer, bytt tegning i planen */}
      {siblings.length > 1 && (
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
