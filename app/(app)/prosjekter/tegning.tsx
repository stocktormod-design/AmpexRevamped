import { useEffect, useRef, useState } from 'react'
import { View, ScrollView, ActivityIndicator, Alert, Platform, useWindowDimensions } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Check, ChevronDown, ChevronLeft, Columns2, Grid2x2, ScanLine, FileText, Flame, LayoutGrid, Link, Link2Off, MousePointer2, Pencil, Plus, Undo2, Upload, Waypoints } from 'lucide-react-native'
import { useSharedValue } from 'react-native-reanimated'
import { Pressable } from '../../../components/pressable'
import { DrawingPane, type EditTool, type PaneDelta } from '../../../components/drawing-pane'
import { TaskPinSheet, type TaskPinSheetState } from '../../../components/task-pin-sheet'
import { Ark, ChoiceSheet } from '../../../components/sheet'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { Room, tilPunkter } from '../../../lib/db/models/room'
import { finnRomPaaTegning, kanDeleIRom } from '../../../lib/rom-fra-tegning'
import { requestLidarScan } from '../../../lib/tasks'
import { DrawingMarkup, type Stroke } from '../../../lib/db/models/drawing-markup'
import { DrawingLoop } from '../../../lib/db/models/drawing-loop'
import { FireDevice } from '../../../lib/db/models/fire-device'
import { FireDeviceSheet } from '../../../components/fire-device-sheet'
import { Task } from '../../../lib/db/models/task'
import { uploadDrawingPdf, getLocalPdf } from '../../../lib/drawings-storage'
import { loadDraft, saveDraft, clearDraft } from '../../../lib/markup-drafts'
import { useUserId } from '../../../lib/auth-user'
import { colors, spacing, radius, sizes, shadows, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

// Forma-lys arbeidsflate — matcher editoren
const WORKSPACE = '#E7E7EC'
const PANEL = 'rgba(252,252,253,0.96)'

/** Verktøy-/modusknapp i bunnflata. Aktiv = fylt blekk. */
function Knapp({ Icon, aktiv, onPress }: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  aktiv: boolean
  onPress: () => void
}) {
  return (
    <Pressable haptic="light" pressScale={0.92} onPress={onPress}
      style={{ width: 42, height: 42, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: aktiv ? colors.paperLabel : 'transparent' }}>
      <Icon size={19} color={aktiv ? '#fff' : colors.paperLabel} strokeWidth={2.1} />
    </Pressable>
  )
}

/** Navnepille inne i en rute — trykk for å bytte tegning i ruta. */
function RutePill({ tekst, top, onPress }: { tekst: string; top: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} pressScale={0.95}
      style={{
        position: 'absolute', top, left: spacing.screen, maxWidth: '70%',
        paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill, justifyContent: 'center',
        backgroundColor: PANEL, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)', ...shadows.card,
      }}>
      <Text style={[t.caption, { fontWeight: '700' }]} numberOfLines={1}>{tekst}</Text>
    </Pressable>
  )
}

export default function TegningViewer() {
  // Mørk klokke og batteri: dette er papir, ikke brun grunn.
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const { drawingId, split: splitParam, rom: romParam, delInn } = useLocalSearchParams<{ drawingId: string; split?: string; rom?: string; delInn?: string }>()
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
  const [tool, setTool] = useState<EditTool>('ingen')
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
    if (!drawing || draft.length === 0) return
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
  }

  // ── Brannkomponenter (fase 4): stempel-plassering med AUTO-TAG (neste ledige
  // adresse på sløyfe 01 — «plasser 40 detektorer uten å skrive ett tall»),
  // detaljer via velg-tapp. Arket åpnes IKKE per plassering (stempel-flyt). ──
  const [deviceSheet, setDeviceSheet] = useState<FireDevice | null>(null)
  async function placeDevice(pt: { x: number; y: number }) {
    if (!drawing) return
    const all = await database.get<FireDevice>('fire_devices')
      .query(Q.where('project_id', drawing.projectId)).fetch()
    let max = 0
    for (const d of all) {
      const m = /^01\.(\d+)$/.exec(d.tag)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    await database.write(async () => {
      await database.get<FireDevice>('fire_devices').create(d => {
        d.projectId = drawing.projectId
        d.drawingId = drawing.id
        d.x = pt.x; d.y = pt.y
        d.kind = 'royk'
        d.tag = `01.${String(max + 1).padStart(3, '0')}`
        d.createdBy = userId
      })
    })
    syncQuietly()
  }
  async function openDevice(id: string) {
    try { setDeviceSheet(await database.get<FireDevice>('fire_devices').find(id)) } catch {}
  }

  // Oppgave-pins: KUN mine åpne (synlighet er tildelt-bare, plan-avgjørelse).
  const [myTasks, setMyTasks] = useState<Task[]>([])
  const [pinSheet, setPinSheet] = useState<TaskPinSheetState>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [romEdit, setRomEdit] = useState(romParam === '1')
  useEffect(() => { if (romParam !== undefined) setRomEdit(romParam === '1') }, [romParam])
  const [romPanel, setRomPanel] = useState<Room | null>(null)
  const [skannBer, setSkannBer] = useState(false)
  const [deler, setDeler] = useState(false)
  const [maalestokk, setMaalestokk] = useState(50)

  // ── Sløyfene på tegningen: kjeden bygges i lerretet, men KONTROLLENE hører
  // hjemme i verktøylinja (ny sløyfe, angre siste node). Uten «ny sløyfe» kunne
  // du aldri starte sløyfe nr. 2 — alt havnet i den samme kjeden.
  const [loops, setLoops] = useState<DrawingLoop[]>([])
  useEffect(() => {
    if (!drawingId) { setLoops([]); return }
    const sub = database.get<DrawingLoop>('drawing_loops')
      .query(Q.where('drawing_id', drawingId), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setLoops)
    return () => sub.unsubscribe()
  }, [drawingId])
  const aktivSloyfe = loops.length ? loops[loops.length - 1] : null
  async function nySloyfe() {
    if (!drawing) return
    const nr = loops.reduce((m, l) => Math.max(m, l.number ?? 0), 0) + 1
    await database.write(async () => {
      await database.get<DrawingLoop>('drawing_loops').create(l => {
        l.drawingId = drawing.id
        l.name = `Sløyfe ${nr}`
        l.number = nr
        l.color = color
        l.nodes = JSON.stringify([])
      })
    })
    syncQuietly()
  }
  async function angreNode() {
    const l = aktivSloyfe
    if (!l) return
    const n = l.nodeList
    await database.write(async () => {
      if (n.length <= 1 && loops.length > 1) await l.markAsDeleted()
      else await l.update(x => { x.nodes = JSON.stringify(n.slice(0, -1)) })
    })
    syncQuietly()
  }

  // ── Delt skjerm: et VERKTØY i tegningen, ikke en egen skjerm. Tegningen du
  // ser på blir øverste halvdel, du velger nederste. Skillelinja bærer låsen.
  // Visning: én rute · to (over/under) · fire (2×2, kun iPad). Telefonen veksler
  // én↔to; på iPad sykler knappen én → to → fire (Tormod 2026-09-06).
  type Visning = 'en' | 'to' | 'fire'
  const erPad = Platform.OS === 'ios' && (Platform as { isPad?: boolean }).isPad === true
  const [visning, setVisning] = useState<Visning>(splitParam === '1' ? 'to' : 'en')
  useEffect(() => { if (splitParam !== undefined) setVisning(splitParam === '1' ? 'to' : 'en') }, [splitParam])
  const split = visning !== 'en'
  /** Tegningene i rute 2–4 (rute 1 er `drawing`). */
  const [ruter, setRuter] = useState<(string | null)[]>([null, null, null])
  const [locked, setLocked] = useState(true)
  const [picking, setPicking] = useState<number | null>(null)
  const scale2 = useSharedValue(1), tx2 = useSharedValue(0), ty2 = useSharedValue(0)
  const scale3 = useSharedValue(1), tx3 = useSharedValue(0), ty3 = useSharedValue(0)
  const scale4 = useSharedValue(1), tx4 = useSharedValue(0), ty4 = useSharedValue(0)
  const alleTransformer = [
    { scale, tx, ty }, { scale: scale2, tx: tx2, ty: ty2 }, { scale: scale3, tx: tx3, ty: ty3 }, { scale: scale4, tx: tx4, ty: ty4 },
  ]
  const nullstill = () => { for (const m of alleTransformer) { m.scale.value = 1; m.tx.value = 0; m.ty.value = 0 } }
  function nesteVisning() {
    setRomEdit(false); setTool('ingen')
    nullstill()
    setVisning(v => erPad ? (v === 'en' ? 'to' : v === 'to' ? 'fire' : 'en') : (v === 'en' ? 'to' : 'en'))
  }
  /** Låst: de andre rutene står stille under gesten og hopper etter når du slipper. */
  function syncFra(fra: number, d: PaneDelta) {
    if (!locked || !split) return
    const antall = visning === 'fire' ? 4 : 2
    for (let i = 0; i < antall; i++) {
      if (i === fra) continue
      const m = alleTransformer[i]
      m.scale.value = Math.min(Math.max(m.scale.value * d.ds, 1), 8)
      m.tx.value += d.dtx
      m.ty.value += d.dty
    }
  }
  useEffect(() => {
    if (!drawingId || !userId) { setMyTasks([]); return }
    const sub = database.get<Task>('tasks')
      .query(Q.where('drawing_id', drawingId), Q.where('assigned_to', userId), Q.where('status', 'open'))
      .observe().subscribe(setMyTasks)
    return () => sub.unsubscribe()
  }, [drawingId, userId])

  // Rommene på denne tegningen — usynlige treffområder, synlige i romredigering
  useEffect(() => {
    if (!drawingId) { setRooms([]); return }
    const sub = database.get<Room>('rooms')
      .query(Q.where('drawing_id', drawingId))
      .observe().subscribe(setRooms)
    return () => sub.unsubscribe()
  }, [drawingId])

  /** Lagrer et rom sin form etter at et hjørne er dratt. */
  async function lagreRomForm(id: string, punkter: [number, number][]) {
    const rom = rooms.find(r => r.id === id)
    if (!rom) return
    await database.write(async () => { await rom.update(r => { r.shape = JSON.stringify({ points: punkter }) }) })
    syncQuietly()
  }

  const delInnKjørt = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (delInn && delInn !== '0' && localUri && drawing && delInnKjørt.current !== delInn) { delInnKjørt.current = delInn; setRomEdit(true); void delIRom() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delInn, localUri, drawing?.id])

  /** Kjører romdelingen på tegningen og lager ett rom per forslag. */
  async function delIRom() {
    if (!drawing || !localUri || deler) return
    setDeler(true)
    try {
      const forslag = await finnRomPaaTegning(localUri, { maalestokk })
      if (!forslag.length) { Alert.alert('Fant ingen rom', 'Sjekk at målestokken stemmer med tegningen.'); return }
      forslag.sort((a, b) => b.areal - a.areal)
      await database.write(async () => {
        await database.batch(...forslag.map((f, i) => database.get<Room>('rooms').prepareCreate(r => {
          r.projectId = drawing.projectId
          r.drawingId = drawing.id
          r.plan = drawing.plan
          r.name = f.navn ?? `Rom ${i + 1}`
          r.shape = JSON.stringify({ points: f.punkter })
        })))
      })
      syncQuietly()
    } catch (e) {
      Alert.alert('Romdelingen stoppet', e instanceof Error ? e.message : String(e))
    } finally {
      setDeler(false)
    }
  }

  // Aktiv tegning
  useEffect(() => {
    if (!drawingId) return
    const sub = database.get<Drawing>('drawings').findAndObserve(drawingId).subscribe({
      next: setDrawing, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [drawingId])

  // Alle tegningene i prosjektet — grunnlaget for bytte-linja nederst. Uten
  // denne var det umulig å komme til tegning nummer to i det hele tatt.
  const projectId = drawing?.projectId
  useEffect(() => {
    if (!projectId) { setSiblings([]); return }
    const sub = database.get<Drawing>('drawings')
      .query(Q.where('project_id', projectId), Q.sortBy('plan', Q.asc), Q.sortBy('name', Q.asc))
      .observe().subscribe(setSiblings)
    return () => sub.unsubscribe()
  }, [projectId])

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
  const flerePlaner = new Set(siblings.map(d => d.plan)).size > 1
  const DELER = 36
  const TOPP = insets.top + spacing.xs + 48 + spacing.xs // toppbaren skal ikke ligge over rutene
  const paneH = (win.height - TOPP - DELER) / 2
  const ruteH = paneH
  const ruteW = (win.width - DELER) / 2
  const rutenavn = (d: Drawing) => [d.name, flerePlaner ? d.plan : null].filter(Boolean).join(' · ')
  const panel = { backgroundColor: PANEL, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)', ...shadows.card } as const
  const laasPille = (
    <Pressable haptic="light" pressScale={0.92} onPress={() => setLocked(v => !v)}
      style={[panel, {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill,
        backgroundColor: locked ? colors.paperLabel : PANEL,
      }]}>
      {locked ? <Link size={15} color="#fff" strokeWidth={2.4} /> : <Link2Off size={15} color={colors.paperLabel} strokeWidth={2.2} />}
      <Text style={[t.caption, { fontWeight: '700', color: locked ? '#fff' : colors.paperLabel }]}>{locked ? 'Låst' : 'Fri'}</Text>
    </Pressable>
  )
  /** Rute i (0 = tegningen du kom fra, 1–3 = valgte). Tom rute = «Velg tegning». */
  function rute(i: number, w: number, h: number) {
    const d = i === 0 ? drawing : (ruter[i - 1] ? siblings.find(x => x.id === ruter[i - 1]) ?? null : null)
    const m = alleTransformer[i]
    if (!d) {
      return (
        <Pressable onPress={() => setPicking(i)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
          <View style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={26} color={colors.paperSecondary} strokeWidth={2} />
          </View>
          <Text style={[t.subhead, { color: colors.paperSecondary, fontWeight: '600' }]}>Velg tegning</Text>
        </Pressable>
      )
    }
    return (
      <>
        <DrawingPane
          drawing={d} width={w} height={h}
          transform={m}
          onGestureEnd={delta => syncFra(i, delta)}
          rooms={i === 0 ? rooms.map(r => ({ id: r.id, navn: r.name, punkter: r.shapePoints ?? [] })).filter(r => r.punkter.length >= 3) : undefined}
          onRoomLongPress={i === 0 ? id => setRomPanel(rooms.find(r => r.id === id) ?? null) : undefined}
        />
        {i > 0 && <RutePill tekst={rutenavn(d)} top={spacing.sm} onPress={() => setPicking(i)} />}
      </>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: WORKSPACE }}>
      {/* Lerret — DrawingPane (rasterert side + Skia-overlay). Langtrykk = ny
          oppgave-pin her; tap på pin = mitt oppgaveark. */}
      {localUri ? (
        split ? (
          <View style={{ flex: 1, paddingTop: TOPP }}>
            {visning === 'fire' ? (
              <>
                <View style={{ flexDirection: 'row', height: ruteH }}>
                  <View style={{ width: ruteW, overflow: 'hidden' }}>{rute(0, ruteW, ruteH)}</View>
                  <View style={{ width: DELER }} />
                  <View style={{ width: ruteW, overflow: 'hidden' }}>{rute(1, ruteW, ruteH)}</View>
                </View>
                <View style={{ height: DELER }} />
                <View style={{ flexDirection: 'row', height: ruteH }}>
                  <View style={{ width: ruteW, overflow: 'hidden' }}>{rute(2, ruteW, ruteH)}</View>
                  <View style={{ width: DELER }} />
                  <View style={{ width: ruteW, overflow: 'hidden' }}>{rute(3, ruteW, ruteH)}</View>
                </View>
                {/* Kryss + lås i midten */}
                <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: TOPP, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ruteH + DELER / 2, height: 1, backgroundColor: 'rgba(0,0,0,0.18)' }} />
                  <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: ruteW + DELER / 2, width: 1, backgroundColor: 'rgba(0,0,0,0.18)' }} />
                  {laasPille}
                </View>
              </>
            ) : (
              <>
                <View style={{ height: paneH, overflow: 'hidden' }}>{rute(0, win.width, paneH)}</View>
                <View style={{ height: DELER, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ position: 'absolute', left: 0, right: 0, top: DELER / 2, height: 1, backgroundColor: 'rgba(0,0,0,0.18)' }} />
                  {laasPille}
                </View>
                <View style={{ height: paneH, overflow: 'hidden' }}>{rute(1, win.width, paneH)}</View>
              </>
            )}
          </View>
        ) : (
          <DrawingPane
          drawing={drawing}
          width={win.width} height={win.height}
          transform={{ scale, tx, ty }}
          pins={myTasks.filter(x => x.pinX !== null && x.pinY !== null).map(x => ({ id: x.id, x: x.pinX!, y: x.pinY! }))}
          edit={{ tool, color, width: penWidth, draft, onDraftChange: changeDraft, onPlaceDevice: placeDevice, onTapDevice: openDevice }}
          rooms={rooms.map(r => ({ id: r.id, navn: r.name, punkter: r.shapePoints ?? [] })).filter(r => r.punkter.length >= 3)}
          roomEdit={romEdit}
          maalestokk={maalestokk}
          onRoomShape={lagreRomForm}
          onRoomLongPress={id => setRomPanel(rooms.find(r => r.id === id) ?? null)}
          onNavigate={() => setTool('ingen')}
          onLongPress={pt => setPinSheet({ mode: 'ny', projectId: drawing.projectId, drawingId: drawing.id, x: pt.x, y: pt.y })}
          onTapPin={id => {
            const task = myTasks.find(x => x.id === id)
            if (task) setPinSheet({ mode: 'vis', task })
          }}
        />
        )
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

      {/* TOPPBAR (Tormod 2026-09-06: «ikke pillen top left, det burde være en bar»):
          tilbake · tegningene i prosjektet som chips (trykk = bytt) · visning. */}
      <View style={{ position: 'absolute', top: insets.top + spacing.xs, left: spacing.sm, right: spacing.sm }} pointerEvents="box-none">
        <View style={[panel, { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: 5, height: 48, borderRadius: radius.xl }]}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.paperLabel} strokeWidth={2.2} />
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}
            contentContainerStyle={{ alignItems: 'center', gap: 4, paddingHorizontal: 2 }}>
            {siblings.map(d => {
              const aktiv = d.id === drawing.id
              return (
                <Pressable key={d.id} haptic="light" pressScale={0.95}
                  onPress={() => { if (!aktiv) router.setParams({ drawingId: d.id }) }}
                  style={{ height: 34, paddingHorizontal: spacing.md, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: aktiv ? colors.paperLabel : 'transparent', maxWidth: 180 }}>
                  <Text style={[t.subhead, { fontWeight: '600', color: aktiv ? '#fff' : colors.paperLabel }]} numberOfLines={1}>{d.name}</Text>
                  {flerePlaner && !!d.plan && (
                    <Text style={[t.caption, { color: aktiv ? 'rgba(255,255,255,0.7)' : colors.paperSecondary, marginTop: -1 }]} numberOfLines={1}>{d.plan}</Text>
                  )}
                </Pressable>
              )
            })}
          </ScrollView>
          {localUri && (
            <Pressable haptic="light" pressScale={0.92} onPress={nesteVisning}
              style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: split ? colors.paperLabel : colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
              {visning === 'fire'
                ? <Grid2x2 size={18} color="#fff" strokeWidth={2.1} />
                : <Columns2 size={18} color={split ? '#fff' : colors.paperLabel} strokeWidth={2.1} />}
            </Pressable>
          )}
          {localUri && draft.length > 0 && (
            <Pressable haptic="medium" onPress={publish} pressScale={0.92}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, backgroundColor: colors.brand }}>
              <Check size={sizes.icon - 4} color={colors.brandLabel} strokeWidth={2.4} />
              <Text style={[t.subhead, { fontWeight: '700', color: colors.brandLabel }]}>{`${draft.length}`}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ÉN flate for alt: moduser til venstre, verktøy i midten, og en
          kontekstrad under som bytter innhold etter hva som er i hånda.
          Ingen «rediger-modus» — verktøyet i hånda ER modusen. */}
      {/* Verktøyene gjelder én rute — i delt visning er flata for navigasjon. */}
      {localUri && !split && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.lg, alignItems: 'center' }} pointerEvents="box-none">
          <View style={[panel, { borderRadius: radius.xl, paddingHorizontal: 6, paddingVertical: 6, gap: 4, maxWidth: win.width - spacing.md * 2 }]}>
            {/* Rad 1: moduser · verktøy */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Knapp Icon={LayoutGrid} aktiv={romEdit} onPress={() => { setRomEdit(v => !v); setTool('ingen') }} />
              <View style={{ width: 0.5, height: 26, backgroundColor: 'rgba(0,0,0,0.12)', marginHorizontal: 4 }} />
              {([
                ['velg', MousePointer2],
                ['penn', Pencil],
                ['sloyfe', Waypoints],
                ['brann', Flame],
              ] as const).map(([tl, Icon]) => (
                <Knapp key={tl} Icon={Icon} aktiv={tool === tl}
                  onPress={() => { setRomEdit(false); setTool(v => (v === tl ? 'ingen' : tl)) }} />
              ))}
            </View>

            {/* Rad 2: kontekst — bytter med verktøyet, ingen ny skjerm */}
            {romEdit ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: 2 }}>
                {[50, 100, 200].map(m => (
                  <Pressable key={m} haptic="light" pressScale={0.95} onPress={() => setMaalestokk(m)}
                    style={{ paddingHorizontal: spacing.sm, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: m === maalestokk ? colors.paperLabel : colors.paperFill }}>
                    <Text style={[t.caption, { fontWeight: '700', color: m === maalestokk ? '#fff' : colors.paperSecondary }]}>1:{m}</Text>
                  </Pressable>
                ))}
                <View style={{ flex: 1 }} />
                {kanDeleIRom && (
                  <Pressable haptic="medium" pressScale={0.95} onPress={delIRom} disabled={deler}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill, backgroundColor: colors.brand, opacity: deler ? 0.4 : 1 }}>
                    {deler ? <ActivityIndicator size="small" color={colors.brandLabel} /> : <LayoutGrid size={14} color={colors.brandLabel} strokeWidth={2.4} />}
                    <Text style={[t.caption, { color: colors.brandLabel, fontWeight: '700' }]}>{deler ? 'Deler inn …' : 'Del inn i rom'}</Text>
                  </Pressable>
                )}
              </View>
            ) : tool === 'sloyfe' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs }}>
                {['#FF3B30', '#0A84FF', '#34C759', '#FFD60A', '#000000'].map(c => (
                  <Pressable key={c} haptic="light" onPress={() => setColor(c)}
                    style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c, borderWidth: color === c ? 3 : 1, borderColor: color === c ? colors.paperLabel : 'rgba(0,0,0,0.15)' }} />
                ))}
                <View style={{ width: 0.5, height: 22, backgroundColor: 'rgba(0,0,0,0.12)' }} />
                <Text style={[t.caption, { color: colors.paperSecondary, fontWeight: '600' }]} numberOfLines={1}>
                  {aktivSloyfe ? `${aktivSloyfe.name} · ${aktivSloyfe.nodeList.length}` : 'Trykk en detektor'}
                </Text>
                <View style={{ flex: 1 }} />
                <Pressable haptic="light" pressScale={0.94} onPress={angreNode} disabled={!aktivSloyfe?.nodeList.length}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', opacity: aktivSloyfe?.nodeList.length ? 1 : 0.3 }}>
                  <Undo2 size={16} color={colors.paperLabel} strokeWidth={2.2} />
                </Pressable>
                <Pressable haptic="medium" pressScale={0.95} onPress={nySloyfe}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, height: 30, borderRadius: radius.pill, backgroundColor: colors.paperFill }}>
                  <Plus size={13} color={colors.paperLabel} strokeWidth={2.4} />
                  <Text style={[t.caption, { fontWeight: '700', color: colors.paperLabel }]}>Ny sløyfe</Text>
                </Pressable>
              </View>
            ) : tool === 'penn' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs }}>
                {['#FF3B30', '#0A84FF', '#34C759', '#FFD60A', '#000000'].map(c => (
                  <Pressable key={c} haptic="light" onPress={() => setColor(c)}
                    style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: color === c ? 3 : 1, borderColor: color === c ? colors.paperLabel : 'rgba(0,0,0,0.15)' }} />
                ))}
                <View style={{ width: 0.5, height: 22, backgroundColor: 'rgba(0,0,0,0.12)' }} />
                {[2, 4, 8].map(w => (
                  <Pressable key={w} haptic="light" onPress={() => setPenWidth(w)}
                    style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: penWidth === w ? colors.paperFill : 'transparent' }}>
                    <View style={{ width: w + 6, height: w + 6, borderRadius: (w + 6) / 2, backgroundColor: colors.paperLabel }} />
                  </Pressable>
                ))}
                <View style={{ flex: 1 }} />
                <Pressable haptic="light" pressScale={0.94} onPress={() => changeDraft(draft.slice(0, -1))} disabled={draft.length === 0}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', opacity: draft.length ? 1 : 0.3 }}>
                  <Undo2 size={16} color={colors.paperLabel} strokeWidth={2.2} />
                </Pressable>
              </View>
            ) : (
              <Text style={[t.caption, { color: colors.paperTertiary, textAlign: 'center', paddingBottom: 2 }]}>
                {tool === 'ingen'
                  ? 'Én finger flytter · to fingre zoomer · hold på et rom i ett sekund'
                  : tool === 'brann' ? 'Trykk der detektoren skal stå'
                  : 'Trykk på noe for å velge det'}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Rompanel — 1 s hold på et rom. Rommet er en usynlig knapp på tegningen. */}
      <Ark synlig={!!romPanel} onLukk={() => setRomPanel(null)}>
        {romPanel && (
          <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
            <View>
              <Text style={t.title3}>{romPanel.name}</Text>
              <Text style={[t.footnote, { marginTop: 2 }]}>
                {[romPanel.plan, romPanel.scanPath ? 'Skannet' : 'Ikke skannet'].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Pressable haptic="medium"
              onPress={() => { const r = romPanel; setRomPanel(null); setPinSheet({ mode: 'ny', projectId: r.projectId, roomId: r.id }) }}
              style={{ height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.headline, { color: colors.brandLabel }]}>Ny oppgave i rommet</Text>
            </Pressable>
            {/* Skann etterspørres her, ikke fra en romliste — rommet er på tegningen. */}
            <Pressable haptic="medium" disabled={skannBer}
              onPress={async () => { const r = romPanel; setSkannBer(true); try { await requestLidarScan(r) } finally { setSkannBer(false); setRomPanel(null) } }}
              style={{ flexDirection: 'row', gap: spacing.sm, height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center', opacity: skannBer ? 0.5 : 1 }}>
              <ScanLine size={sizes.icon - 2} color={colors.paperLabel} strokeWidth={2.1} />
              <Text style={[t.headline, { color: colors.paperLabel }]}>Etterspør LiDAR-skann</Text>
            </Pressable>
            <Pressable haptic="medium"
              onPress={() => { const id = romPanel.id; setRomPanel(null); router.push({ pathname: '/(app)/prosjekter/rom', params: { roomId: id } }) }}
              style={{ height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.headline, { color: colors.paperLabel }]}>Åpne rommet</Text>
            </Pressable>
          </View>
        )}
      </Ark>

      <ChoiceSheet
        synlig={picking !== null}
        tittel={picking === 0 ? 'Første rute' : `Rute ${(picking ?? 0) + 1}`}
        valg={siblings.map(d => ({ verdi: d.id, etikett: d.name, underetikett: [d.plan, disciplineLabel[d.discipline] ?? d.discipline].filter(Boolean).join(' · ') }))}
        valgt={picking === 0 ? drawing.id : (picking ? ruter[picking - 1] ?? undefined : undefined)}
        onVelg={id => {
          if (picking === 0) router.setParams({ drawingId: id })
          else if (picking) setRuter(r => r.map((x, k) => (k === picking - 1 ? id : x)))
          setPicking(null)
        }}
        onAvbryt={() => setPicking(null)}
      />

      <TaskPinSheet state={pinSheet} userId={userId} onClose={() => setPinSheet(null)} />
      <FireDeviceSheet device={deviceSheet} onClose={() => setDeviceSheet(null)} />
    </View>
  )
}
