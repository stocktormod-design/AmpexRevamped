import { useEffect, useMemo, useRef, useState } from 'react'
import { View, ScrollView, ActivityIndicator, Dimensions, Alert, Platform } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Pdf from 'react-native-pdf'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS } from 'react-native-reanimated'
import { Canvas, Group, Path } from '@shopify/react-native-skia'
import { SvgXml } from 'react-native-svg'
import { ChevronLeft, Hand, Pen, Square, Waypoints, Plus, Undo2, Trash2, CloudUpload } from 'lucide-react-native'
import { SYMBOLS, symbolSvg } from '../../../lib/symbols'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Drawing } from '../../../lib/db/models/drawing'
import { DrawingMarkup, type Stroke } from '../../../lib/db/models/drawing-markup'
import { Room, omsluttende, type RoomShape } from '../../../lib/db/models/room'
import { DrawingLoop, type LoopNode } from '../../../lib/db/models/drawing-loop'
import { getLocalPdf } from '../../../lib/drawings-storage'
import { finnRomPaaTegning, kanDeleIRom } from '../../../lib/rom-fra-tegning'
import { loadDraft, saveDraft, clearDraft } from '../../../lib/markup-drafts'
import { colors, spacing, radius, sizes, shadows, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

type Mode = 'draw' | 'pan' | 'room' | 'loop'

const PALETTE = ['#FF3B30', '#0A84FF', '#34C759', '#FFD60A', '#000000', '#FFFFFF']
const WIDTHS = [2, 4, 8]
const LOOP_COLORS = ['#0A84FF', '#FF9F0A', '#BF5AF2', '#FF375F', '#30D158', '#64D2FF']

// Forma-lys arbeidsflate: lyst lerret, hvit tegning flyter, chrome = frostede øyer.
const WORKSPACE = '#E7E7EC'
const PANEL = 'rgba(252,252,253,0.96)'
const sheetShadow = { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } } as const

/** Farge per rom — stabil på id, så et rom beholder fargen sin. */
const ROOM_COLORS = ['#FF3B30', '#0A84FF', '#34C759', '#FF9F0A', '#BF5AF2', '#00C7BE', '#FF375F', '#8E8E93']
function romFarge(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return ROOM_COLORS[h % ROOM_COLORS.length]
}

/** Lukket path av normaliserte punkter. */
function svgPoly(pts: [number, number][], W: number, H: number): string {
  if (pts.length < 3) return ''
  let d = `M${pts[0][0] * W} ${pts[0][1] * H}`
  for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0] * W} ${pts[i][1] * H}`
  return d + ' Z'
}

/** Bygg en SVG-path-streng av punkter (px). */
function svgFrom(points: [number, number][]): string {
  if (points.length === 0) return ''
  const [x0, y0] = points[0]
  let d = `M${x0} ${y0}`
  for (let i = 1; i < points.length; i++) d += ` L${points[i][0]} ${points[i][1]}`
  return d
}

/** Ett drahåndtak på et romhjørne. Egen komponent så gesten holder sin egen start. */
function RomHandtak({ x, y, farge, onFlytt, onSlutt }: {
  x: number; y: number; farge: string
  onFlytt: (dx: number, dy: number) => void
  onSlutt: () => void
}) {
  const gest = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onUpdate(e => { 'worklet'; runOnJS(onFlytt)(e.translationX, e.translationY) })
    .onEnd(() => { 'worklet'; runOnJS(onSlutt)() }), [onFlytt, onSlutt])
  const R = 11
  return (
    <GestureDetector gesture={gest}>
      <View style={{ position: 'absolute', left: x - R, top: y - R, width: R * 2, height: R * 2, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: '#fff', borderWidth: 2.5, borderColor: farge }} />
      </View>
    </GestureDetector>
  )
}

export default function TegningEdit() {
  // Mørk klokke og batteri: dette er papir, ikke brun grunn.
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const { drawingId } = useLocalSearchParams<{ drawingId: string }>()
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [localUri, setLocalUri] = useState<string | null>(null)
  const [markup, setMarkup] = useState<DrawingMarkup | null>(null)
  const [published, setPublished] = useState<Stroke[]>([]) // delt, synket — skrivebeskyttet base
  const [draft, setDraft] = useState<Stroke[]>([])          // lokal kladd — synker aldri før publisering
  const [current, setCurrent] = useState<[number, number][]>([])
  const [publishing, setPublishing] = useState(false)
  const [mode, setMode] = useState<Mode>('draw')
  const [rooms, setRooms] = useState<Room[]>([])
  const [valgtRom, setValgtRom] = useState<string | null>(null)   // rommet som redigeres
  const [dragPts, setDragPts] = useState<[number, number][] | null>(null) // live form under dra
  const [maalestokk, setMaalestokk] = useState(50)
  const [deler, setDeler] = useState(false)
  const [loops, setLoops] = useState<DrawingLoop[]>([])
  const [activeLoopId, setActiveLoopId] = useState<string | null>(null)
  const [deviceSym, setDeviceSym] = useState('royk') // hvilken enhet sløyfe-verktøyet setter ut
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null) // live rom-firkant (px)
  const [color, setColor] = useState('#FF3B30')
  const [width, setWidth] = useState(4)
  // Sidestørrelse (px fra PDF) → fit-rekt
  const [page, setPage] = useState<{ w: number; h: number } | null>(null)

  const win = Dimensions.get('window')
  const availTop = insets.top + 52
  const availBottom = insets.bottom + 88
  const availW = win.width
  const availH = win.height - availTop - availBottom

  // Fit-rekt: base-koordinatsystem for både PDF og markup
  const fit = page ? Math.min(availW / page.w, availH / page.h) : 1
  const W = page ? page.w * fit : availW
  const H = page ? page.h * fit : availH

  // Egen transform (delt av PDF + Skia) — anker markup ved zoom.
  // Alle verdier er shared values så gesture-worklets når dem.
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)

  // Refs så gesture-JS leser ferskeste verktøy
  const colorRef = useRef(color); colorRef.current = color
  const widthRef = useRef(width); widthRef.current = width
  const sizeRef = useRef({ W, H }); sizeRef.current = { W, H }
  const loopsRef = useRef(loops); loopsRef.current = loops
  const activeLoopRef = useRef(activeLoopId); activeLoopRef.current = activeLoopId
  const deviceRef = useRef(deviceSym); deviceRef.current = deviceSym
  const creatingRef = useRef(false)

  useEffect(() => {
    if (!drawingId) return
    const sub = database.get<Drawing>('drawings').findAndObserve(drawingId).subscribe({
      next: setDrawing, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [drawingId])

  // Publisert markup (delt): observeres fra drawing_markup
  useEffect(() => {
    if (!drawingId) return
    const sub = database.get<DrawingMarkup>('drawing_markup')
      .query(Q.where('drawing_id', drawingId))
      .observe().subscribe(rows => {
        const row = rows[0] ?? null
        setMarkup(row)
        setPublished(row ? row.strokes : [])
      })
    return () => sub.unsubscribe()
  }, [drawingId])

  // Lokal kladd (aldri synket før publisering)
  useEffect(() => {
    let mounted = true
    if (!drawingId) return
    loadDraft(drawingId).then(d => { if (mounted) setDraft(d) })
    return () => { mounted = false }
  }, [drawingId])

  // Rom tegnet på denne tegningen (firkanter)
  useEffect(() => {
    if (!drawingId) return
    const sub = database.get<Room>('rooms')
      .query(Q.where('drawing_id', drawingId))
      .observe().subscribe(setRooms)
    return () => sub.unsubscribe()
  }, [drawingId])

  // Sløyfer på denne tegningen (delt, as-built)
  useEffect(() => {
    if (!drawingId) return
    const sub = database.get<DrawingLoop>('drawing_loops')
      .query(Q.where('drawing_id', drawingId), Q.sortBy('number', Q.asc))
      .observe().subscribe(setLoops)
    return () => sub.unsubscribe()
  }, [drawingId])

  // Sørg for aktiv sløyfe når du er i sløyfe-modus (velg første, eller lag Sløyfe 1)
  useEffect(() => {
    if (mode !== 'loop') return
    if (activeLoopId && loops.some(l => l.id === activeLoopId)) return
    if (loops.length > 0) setActiveLoopId(loops[0].id)
    else createLoop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loops])

  const filePath = drawing?.filePath
  useEffect(() => {
    let mounted = true
    if (!filePath) { setLocalUri(null); return }
    getLocalPdf(filePath).then(uri => { if (mounted) setLocalUri(uri) }).catch(() => {})
    return () => { mounted = false }
  }, [filePath])

  // Kladd lagres KUN lokalt (aldri synket) til brukeren trykker Publiser
  function saveDraftLocal(next: Stroke[]) {
    if (drawingId) saveDraft(drawingId, next).catch(() => {})
  }

  // Publiser: flett kladd inn i delt drawing_markup, tøm lokal kladd, synk usynlig
  async function publish() {
    if (!drawingId || draft.length === 0 || publishing) return
    setPublishing(true)
    try {
      const merged = [...published, ...draft]
      await database.write(async () => {
        if (markup) {
          await markup.update(m => { m.data = JSON.stringify(merged) })
        } else {
          await database.get<DrawingMarkup>('drawing_markup').create(m => {
            m.drawingId = drawingId
            m.data = JSON.stringify(merged)
          })
        }
      })
      await clearDraft(drawingId)
      setDraft([])
      syncQuietly()
    } finally {
      setPublishing(false)
    }
  }

  // --- Pen (kjører i «draw»-modus) ---
  const startStroke = (x: number, y: number) => setCurrent([[x, y]])
  const extendStroke = (x: number, y: number) => setCurrent(p => [...p, [x, y]])
  const endStroke = () => {
    setCurrent(cur => {
      const { W, H } = sizeRef.current
      if (cur.length > 1 && W > 0 && H > 0) {
        const norm: [number, number][] = cur.map(([x, y]) => [x / W, y / H])
        const stroke: Stroke = { points: norm, color: colorRef.current, width: widthRef.current }
        setDraft(prev => { const next = [...prev, stroke]; saveDraftLocal(next); return next })
      }
      return []
    })
  }

  const penGesture = useMemo(() => Gesture.Pan()
    .enabled(mode === 'draw')
    .maxPointers(1)
    .minDistance(0)
    .onBegin(e => { 'worklet'; runOnJS(startStroke)(e.x, e.y) })
    .onUpdate(e => { 'worklet'; runOnJS(extendStroke)(e.x, e.y) })
    .onEnd(() => { 'worklet'; runOnJS(endStroke)() }), [mode])

  // --- Rom (kjører i «room»-modus): dra en firkant over rommet ---
  async function createRoom(name: string, shape: RoomShape) {
    if (!drawing) return
    await database.write(async () => {
      await database.get<Room>('rooms').create(r => {
        r.projectId = drawing.projectId
        r.drawingId = drawing.id
        r.plan = drawing.plan
        r.name = name
        r.shape = JSON.stringify(shape)
      })
    })
    syncQuietly()
  }
  const valgtRomObj = rooms.find(r => r.id === valgtRom) ?? null
  const valgtRomPts = valgtRomObj ? (dragPts ?? valgtRomObj.shapePoints) : null
  const dragStart = useRef<[number, number][] | null>(null)

  /** Flytter ett hjørne i det valgte rommet. dx/dy er skjermpiksler. */
  function flyttHjørne(i: number, dx: number, dy: number) {
    const rom = rooms.find(r => r.id === valgtRom); if (!rom) return
    if (!dragStart.current) dragStart.current = rom.shapePoints
    const base = dragStart.current; if (!base) return
    const { W: bredde, H: høyde } = sizeRef.current
    const s = scale.value || 1
    const neste = base.map((p, k) => (k === i
      ? [Math.min(1, Math.max(0, p[0] + dx / (bredde * s))), Math.min(1, Math.max(0, p[1] + dy / (høyde * s)))] as [number, number]
      : p))
    setDragPts(neste)
  }

  /** Skriver den dratte formen til basen. */
  function lagreDrag() {
    const rom = rooms.find(r => r.id === valgtRom)
    const pts = dragPts
    dragStart.current = null
    setDragPts(null)
    if (rom && pts) void lagreForm(rom, pts)
  }

  /** Kjører romdelingen på tegningen og lager ett rom per forslag. */
  async function delIRom() {
    if (!drawing || !localUri || !page || deler) return
    const start = async () => {
      setDeler(true)
      try {
        const forslag = await finnRomPaaTegning(localUri, { sidebreddePt: page.w, maalestokk })
        if (!forslag.length) {
          Alert.alert('Fant ingen rom', 'Sjekk at målestokken stemmer med tegningen.')
          return
        }
        forslag.sort((a, b) => b.areal - a.areal)
        await database.write(async () => {
          await database.batch(
            ...forslag.map((f, i) => database.get<Room>('rooms').prepareCreate(r => {
              r.projectId = drawing.projectId
              r.drawingId = drawing.id
              r.plan = drawing.plan
              r.name = f.navn ?? `Rom ${i + 1}`
              r.shape = JSON.stringify({ points: f.punkter })
            })),
          )
        })
        syncQuietly()
      } catch (e) {
        Alert.alert('Romdelingen stoppet', e instanceof Error ? e.message : String(e))
      } finally {
        setDeler(false)
      }
    }
    if (rooms.length) {
      Alert.alert('Tegningen har rom fra før', `${rooms.length} rom finnes. Forslagene legges til på toppen.`, [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Legg til', onPress: () => void start() },
      ])
      return
    }
    void start()
  }

  /** Sletter det valgte rommet. */
  function slettValgtRom() {
    const rom = valgtRomObj
    if (!rom) return
    Alert.alert('Slette rommet?', rom.name, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Slett', style: 'destructive', onPress: async () => {
        await database.write(async () => { await rom.markAsDeleted() })
        setValgtRom(null); setDragPts(null); syncQuietly()
      } },
    ])
  }

  /** Lagrer formen til et rom (polygon). */
  async function lagreForm(room: Room, pts: [number, number][]) {
    await database.write(async () => { await room.update(r => { r.shape = JSON.stringify({ points: pts }) }) })
    syncQuietly()
  }

  function promptCreateRoom(shape: RoomShape) {
    const go = (name?: string) => createRoom((name ?? '').trim() || 'Nytt rom', shape)
    if (Platform.OS === 'ios' && Alert.prompt) {
      Alert.prompt('Nytt rom', 'Navn på rommet', [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Legg til', onPress: go },
      ], 'plain-text', '')
    } else {
      go('Nytt rom')
    }
  }
  const startRect = (x: number, y: number) => setRect({ x0: x, y0: y, x1: x, y1: y })
  const extendRect = (x: number, y: number) => setRect(r => (r ? { ...r, x1: x, y1: y } : null))
  const endRect = () => {
    setRect(r => {
      const { W, H } = sizeRef.current
      if (r && W > 0 && H > 0) {
        const shape: RoomShape = {
          x: Math.min(r.x0, r.x1) / W, y: Math.min(r.y0, r.y1) / H,
          w: Math.abs(r.x1 - r.x0) / W, h: Math.abs(r.y1 - r.y0) / H,
        }
        if (shape.w > 0.02 && shape.h > 0.02) promptCreateRoom(shape)
      }
      return null
    })
  }
  const roomGesture = useMemo(() => Gesture.Pan()
    .enabled(mode === 'room')
    .maxPointers(1)
    .minDistance(0)
    .onBegin(e => { 'worklet'; runOnJS(startRect)(e.x, e.y) })
    .onUpdate(e => { 'worklet'; runOnJS(extendRect)(e.x, e.y) })
    .onEnd(() => { 'worklet'; runOnJS(endRect)() }), [mode])

  // --- Sløyfe (kjører i «loop»-modus): tapp inn noder langs ruta, kobles automatisk ---
  async function createLoop() {
    if (!drawing || creatingRef.current) return
    creatingRef.current = true
    try {
      const num = loopsRef.current.reduce((m, l) => Math.max(m, l.number), 0) + 1
      const col = LOOP_COLORS[(num - 1) % LOOP_COLORS.length]
      let id = ''
      await database.write(async () => {
        const l = await database.get<DrawingLoop>('drawing_loops').create(l => {
          l.drawingId = drawing.id
          l.name = `Sløyfe ${num}`
          l.number = num
          l.color = col
          l.nodes = '[]'
        })
        id = l.id
      })
      setActiveLoopId(id)
      syncQuietly()
    } finally {
      creatingRef.current = false
    }
  }
  async function addNodeToActive(xpx: number, ypx: number) {
    const { W, H } = sizeRef.current
    if (W <= 0 || H <= 0) return
    const loop = loopsRef.current.find(l => l.id === activeLoopRef.current)
    if (!loop) return
    const next: LoopNode[] = [...loop.nodeList, { x: xpx / W, y: ypx / H, sym: deviceRef.current }]
    await database.write(async () => { await loop.update(l => { l.nodes = JSON.stringify(next) }) })
    syncQuietly()
  }
  async function loopUndo() {
    const loop = loops.find(l => l.id === activeLoopId)
    if (!loop) return
    const nodes = loop.nodeList
    if (nodes.length === 0) return
    await database.write(async () => { await loop.update(l => { l.nodes = JSON.stringify(nodes.slice(0, -1)) }) })
    syncQuietly()
  }
  async function deleteActiveLoop() {
    const loop = loops.find(l => l.id === activeLoopId)
    if (!loop) return
    await database.write(async () => { await loop.markAsDeleted() })
    setActiveLoopId(null)
    syncQuietly()
  }
  const loopTapGesture = useMemo(() => Gesture.Tap()
    .enabled(mode === 'loop')
    .maxDuration(300)
    .onEnd(e => { 'worklet'; runOnJS(addNodeToActive)(e.x, e.y) }), [mode])

  // --- Pan/zoom (kjører i «pan»-modus) ---
  const panGesture = useMemo(() => Gesture.Pan()
    .enabled(mode === 'pan')
    .onUpdate(e => { 'worklet'; tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY })
    .onEnd(() => { 'worklet'; savedTx.value = tx.value; savedTy.value = ty.value }), [mode])

  const pinchGesture = useMemo(() => Gesture.Pinch()
    .onUpdate(e => { 'worklet'; scale.value = Math.max(1, Math.min(8, savedScale.value * e.scale)) })
    .onEnd(() => { 'worklet'; savedScale.value = scale.value }), [])

  const transformStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  function resetView() {
    scale.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0)
    savedScale.value = 1; savedTx.value = 0; savedTy.value = 0
  }

  function undo() {
    setDraft(prev => { const next = prev.slice(0, -1); saveDraftLocal(next); return next })
  }
  function clearAll() {
    setDraft([]); saveDraftLocal([])
  }

  if (!drawing) return <View style={{ flex: 1, backgroundColor: WORKSPACE }} />
  const activeLoop = loops.find(l => l.id === activeLoopId) ?? null
  const panel = { backgroundColor: PANEL, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)', ...shadows.card } as const

  return (
    <View style={{ flex: 1, backgroundColor: WORKSPACE }}>
      {/* Lerret: pinch (alltid) omslutter pan ELLER pen (etter modus) */}
      <View style={{ position: 'absolute', top: availTop, left: 0, right: 0, bottom: availBottom, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {localUri ? (
          <GestureDetector gesture={Gesture.Simultaneous(pinchGesture, panGesture)}>
            <Animated.View style={{ width: availW, height: availH, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={[{ width: W, height: H }, transformStyle, sheetShadow]}>
                <Pdf
                  source={{ uri: localUri }}
                  singlePage
                  scale={1} minScale={1} maxScale={1}
                  enablePaging={false}
                  onLoadComplete={(_n, _p, dims) => {
                    if (dims?.width && dims?.height) setPage({ w: dims.width, h: dims.height })
                  }}
                  style={{ width: W, height: H, backgroundColor: '#fff' }}
                  renderActivityIndicator={() => <ActivityIndicator color="#000" />}
                />
                <GestureDetector gesture={Gesture.Simultaneous(penGesture, roomGesture, loopTapGesture)}>
                  <Canvas style={{ position: 'absolute', top: 0, left: 0, width: W, height: H }}>
                    {/* Sløyfer — rute mellom noder */}
                    {loops.map(l => {
                      const pts = l.nodeList.map(n => [n.x * W, n.y * H] as [number, number])
                      if (pts.length < 2) return null
                      return (
                        <Path key={`l${l.id}`} path={svgFrom(pts)} style="stroke" color={l.color}
                          strokeWidth={l.id === activeLoopId ? 3 : 2.5} strokeCap="round" strokeJoin="round" />
                      )
                    })}
                    {/* Rom — fylt polygon i romfargen */}
                    {rooms.map(rm => {
                      const pts = rm.id === valgtRom && dragPts ? dragPts : rm.shapePoints
                      if (!pts) return null
                      const d = svgPoly(pts, W, H); if (!d) return null
                      const c = romFarge(rm.id)
                      return (
                        <Group key={`rom${rm.id}`}>
                          <Path path={d} style="fill" color={c} opacity={rm.id === valgtRom ? 0.3 : 0.16} />
                          <Path path={d} style="stroke" color={c} strokeWidth={rm.id === valgtRom ? 2.5 : 1.5} strokeJoin="round" />
                        </Group>
                      )
                    })}
                    {/* Publisert (delt) markup — base */}
                    {published.map((s, i) => (
                      <Path
                        key={`p${i}`}
                        path={svgFrom(s.points.map(([x, y]) => [x * W, y * H]))}
                        style="stroke" color={s.color} strokeWidth={s.width}
                        strokeCap="round" strokeJoin="round"
                      />
                    ))}
                    {/* Lokal kladd — oppå, uendret utseende til publisering */}
                    {draft.map((s, i) => (
                      <Path
                        key={`d${i}`}
                        path={svgFrom(s.points.map(([x, y]) => [x * W, y * H]))}
                        style="stroke" color={s.color} strokeWidth={s.width}
                        strokeCap="round" strokeJoin="round"
                      />
                    ))}
                    {current.length > 1 && (
                      <Path
                        path={svgFrom(current)}
                        style="stroke" color={color} strokeWidth={width}
                        strokeCap="round" strokeJoin="round"
                      />
                    )}
                  </Canvas>
                </GestureDetector>

                {/* Rom: navnelapp + treffområde. Formen selv tegnes i lerretet over. */}
                {rooms.map(rm => {
                  const pts = rm.id === valgtRom && dragPts ? dragPts : rm.shapePoints
                  if (!pts) return null
                  const b = omsluttende(pts)
                  const c = romFarge(rm.id)
                  return (
                    <View
                      key={rm.id}
                      pointerEvents={mode === 'pan' || mode === 'room' ? 'box-none' : 'none'}
                      style={{ position: 'absolute', left: b.x * W, top: b.y * H, width: b.w * W, height: b.h * H }}
                    >
                      <Pressable
                        onPress={() => {
                          if (mode === 'room') setValgtRom(id => (id === rm.id ? null : rm.id))
                          else router.push({ pathname: '/(app)/prosjekter/rom', params: { roomId: rm.id } })
                        }}
                        style={{ flex: 1 }}
                      >
                        <Text numberOfLines={1} style={{ alignSelf: 'flex-start', maxWidth: '100%', fontSize: 11, fontWeight: '700', color: c, backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 4, borderBottomRightRadius: 3 }}>
                          {rm.name}
                        </Text>
                      </Pressable>
                    </View>
                  )
                })}

                {/* Håndtak på det valgte rommet — dra et hjørne for å strekke */}
                {mode === 'room' && valgtRomObj && (valgtRomPts ?? []).map((pt, i) => (
                  <RomHandtak
                    key={`h${valgtRomObj.id}-${i}`}
                    x={pt[0] * W} y={pt[1] * H} farge={romFarge(valgtRomObj.id)}
                    onFlytt={(dx, dy) => flyttHjørne(i, dx, dy)}
                    onSlutt={() => lagreDrag()}
                  />
                ))}

                {/* Sløyfe-noder — utsatte enheter (symbol) langs ruta */}
                {loops.map(l => l.nodeList.map((n, i) => {
                  const active = l.id === activeLoopId
                  const d = active ? 30 : 26
                  return (
                    <View key={`n${l.id}-${i}`} pointerEvents="none" style={{
                      position: 'absolute', left: n.x * W - d / 2, top: n.y * H - d / 2, width: d, height: d,
                      borderRadius: 7, backgroundColor: '#fff', borderWidth: 2, borderColor: l.color,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <SvgXml xml={symbolSvg(n.sym ?? 'royk', l.color)} width={d - 9} height={d - 9} color={l.color} />
                    </View>
                  )
                }))}

                {/* Live rom-firkant mens du drar */}
                {rect && (
                  <View pointerEvents="none" style={{
                    position: 'absolute',
                    left: Math.min(rect.x0, rect.x1), top: Math.min(rect.y0, rect.y1),
                    width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0),
                    borderWidth: 2, borderColor: '#0A84FF', borderStyle: 'dashed', backgroundColor: 'rgba(10,132,255,0.12)',
                  }} />
                )}
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        ) : (
          <ActivityIndicator color={colors.paperSecondary} />
        )}
      </View>

      {/* Topp-pill: tilbake + tittel (flytende øy, venstre) */}
      <View style={{ position: 'absolute', top: insets.top + spacing.sm, left: spacing.screen, right: spacing.screen, flexDirection: 'row' }} pointerEvents="box-none">
        <View style={[panel, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 5, paddingRight: spacing.md, height: 44, borderRadius: radius.pill, maxWidth: '82%' }]}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.paperLabel} strokeWidth={2.2} />
          </Pressable>
          <View style={{ flexShrink: 1 }}>
            <Text style={[t.subhead, { fontWeight: '700' }]} numberOfLines={1}>{drawing.name}</Text>
            {draft.length > 0 && (
              <Text style={[t.caption, { color: colors.warning }]}>{draft.length} upublisert{draft.length === 1 ? '' : 'e'}</Text>
            )}
          </View>
        </View>
      </View>

      {/* Verktøy-rail: modusene, vertikalt sentrert (høyre) */}
      <View style={{ position: 'absolute', right: spacing.screen, top: 0, bottom: 0, justifyContent: 'center' }} pointerEvents="box-none">
        <View style={[panel, { padding: 5, borderRadius: radius.xl + 2, gap: 4 }]}>
          {([['draw', Pen], ['loop', Waypoints], ['room', Square], ['pan', Hand]] as const).map(([m, Icon]) => {
            const active = mode === m
            return (
              <Pressable key={m} haptic="light" pressScale={0.9} onPress={() => setMode(m)}
                style={{ width: 46, height: 46, borderRadius: radius.lg, backgroundColor: active ? colors.paperLabel : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={20} color={active ? '#fff' : colors.paperSecondary} strokeWidth={2} />
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* Kontekst-inspektør: kun aktivt verktøy (flytende øy, bunn) */}
      <View style={{ position: 'absolute', left: spacing.screen, right: spacing.screen, bottom: insets.bottom + spacing.sm }} pointerEvents="box-none">
        <View style={[panel, { borderRadius: radius.xl, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md }]}>
          {mode === 'loop' ? (
            <View style={{ gap: spacing.sm }}>
              {/* Rad A: sløyfer + angre/slett */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: spacing.sm }}>
                  {loops.map(l => {
                    const active = l.id === activeLoopId
                    return (
                      <Pressable key={l.id} haptic="light" pressScale={0.95} onPress={() => setActiveLoopId(l.id)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm + 2, height: 30, borderRadius: radius.pill, backgroundColor: active ? colors.paperLabel : colors.paperFill }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: l.color }} />
                        <Text style={[t.footnote, { fontWeight: '700', color: active ? '#fff' : colors.paperLabel }]}>{l.name}</Text>
                        <Text style={[t.caption, { color: active ? 'rgba(255,255,255,0.55)' : colors.paperTertiary, fontVariant: ['tabular-nums'] }]}>{l.nodeList.length}</Text>
                      </Pressable>
                    )
                  })}
                  <Pressable haptic="light" pressScale={0.9} onPress={createLoop}
                    style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
                    <Plus size={16} color={colors.paperLabel} strokeWidth={2.4} />
                  </Pressable>
                </ScrollView>
                <Pressable pressScale={0.9} onPress={loopUndo} disabled={!activeLoop || activeLoop.nodeList.length === 0} hitSlop={6}
                  style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: !activeLoop || activeLoop.nodeList.length === 0 ? 0.3 : 1 }}>
                  <Undo2 size={19} color={colors.paperLabel} strokeWidth={2} />
                </Pressable>
                <Pressable pressScale={0.9} onPress={deleteActiveLoop} disabled={!activeLoop} hitSlop={6}
                  style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: !activeLoop ? 0.3 : 1 }}>
                  <Trash2 size={19} color={colors.paperLabel} strokeWidth={2} />
                </Pressable>
              </View>
              {/* Rad B: enhets-palett — hva sløyfa setter ut */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: spacing.sm }}>
                {SYMBOLS.map(s => {
                  const active = deviceSym === s.id
                  return (
                    <Pressable key={s.id} haptic="light" pressScale={0.95} onPress={() => setDeviceSym(s.id)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.xs, paddingRight: spacing.sm + 2, height: 34, borderRadius: radius.pill, backgroundColor: active ? colors.paperLabel : colors.paperFill }}>
                      <View style={{ width: 24, height: 24, borderRadius: radius.sm, backgroundColor: active ? 'rgba(255,255,255,0.16)' : colors.paperBg, alignItems: 'center', justifyContent: 'center' }}>
                        <SvgXml xml={symbolSvg(s.id, active ? '#fff' : colors.paperLabel)} width={16} height={16} color={active ? '#fff' : colors.paperLabel} />
                      </View>
                      <Text style={[t.footnote, { fontWeight: '600', color: active ? '#fff' : colors.paperLabel }]}>{s.label}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>
          ) : mode === 'draw' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: spacing.sm }}>
                {PALETTE.map(c => (
                  <Pressable key={c} pressScale={0.9} onPress={() => setColor(c)}
                    style={{
                      width: 28, height: 28, borderRadius: 14, backgroundColor: c,
                      borderWidth: color === c ? 2.5 : 1, borderColor: color === c ? colors.paperLabel : 'rgba(0,0,0,0.14)',
                    }} />
                ))}
                <View style={{ width: 0.5, height: 26, backgroundColor: 'rgba(0,0,0,0.12)', marginHorizontal: spacing.xs }} />
                {WIDTHS.map(w => (
                  <Pressable key={w} pressScale={0.9} onPress={() => setWidth(w)}
                    style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: width === w ? colors.paperFill : 'transparent' }}>
                    <View style={{ width: 16, height: w, borderRadius: w, backgroundColor: colors.paperLabel }} />
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable pressScale={0.9} onPress={undo} disabled={draft.length === 0} hitSlop={6}
                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: draft.length === 0 ? 0.3 : 1 }}>
                <Undo2 size={20} color={colors.paperLabel} strokeWidth={2} />
              </Pressable>
              <Pressable pressScale={0.9} onPress={clearAll} disabled={draft.length === 0} hitSlop={6}
                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: draft.length === 0 ? 0.3 : 1 }}>
                <Trash2 size={20} color={colors.paperLabel} strokeWidth={2} />
              </Pressable>
              <Pressable haptic="medium" pressScale={0.95} onPress={publish} disabled={draft.length === 0 || publishing}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 34, paddingHorizontal: spacing.md,
                  borderRadius: radius.pill, backgroundColor: draft.length === 0 ? colors.paperFill : colors.brand,
                  opacity: publishing ? 0.6 : 1,
                }}>
                {publishing
                  ? <ActivityIndicator size="small" color={draft.length === 0 ? colors.paperLabel : colors.brandLabel} />
                  : <CloudUpload size={17} color={draft.length === 0 ? colors.paperTertiary : colors.brandLabel} strokeWidth={2.1} />
                }
                <Text style={[t.subhead, { fontWeight: '700', color: draft.length === 0 ? colors.paperTertiary : colors.brandLabel }]}>Publiser</Text>
              </Pressable>
            </View>
          ) : mode === 'room' ? (
            valgtRomObj ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text numberOfLines={2} style={[t.subhead, { flex: 1, color: colors.paperSecondary }]}>
                  Dra i hjørnene for å endre {valgtRomObj.name} · trykk rommet igjen for å låse
                </Text>
                <Pressable haptic="medium" pressScale={0.9} onPress={slettValgtRom}
                  style={{ width: 38, height: 38, borderRadius: radius.lg, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={18} color="#FF3B30" strokeWidth={2} />
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  {[50, 100, 200].map(m => {
                    const aktiv = m === maalestokk
                    return (
                      <Pressable key={m} haptic="light" pressScale={0.95} onPress={() => setMaalestokk(m)}
                        style={{ paddingHorizontal: spacing.sm + 2, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: aktiv ? colors.paperLabel : colors.paperFill }}>
                        <Text style={[t.footnote, { fontWeight: '700', color: aktiv ? '#fff' : colors.paperSecondary }]}>1:{m}</Text>
                      </Pressable>
                    )
                  })}
                  <View style={{ flex: 1 }} />
                  {kanDeleIRom && (
                    <Pressable haptic="medium" pressScale={0.95} onPress={delIRom} disabled={deler || !page}
                      style={{ paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.paperLabel, opacity: deler || !page ? 0.4 : 1 }}>
                      {deler ? <ActivityIndicator size="small" color="#fff" /> : <Square size={15} color="#fff" strokeWidth={2.5} />}
                      <Text style={[t.subhead, { color: '#fff', fontWeight: '700' }]}>{deler ? 'Deler inn …' : 'Del inn i rom'}</Text>
                    </Pressable>
                  )}
                </View>
                <Text style={[t.footnote, { color: colors.paperTertiary, textAlign: 'center' }]}>
                  Dra en firkant for å lage et rom selv · trykk et rom for å endre form
                </Text>
              </View>
            )
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[t.footnote, { color: colors.paperTertiary }]}>To fingre for å zoome og panorere</Text>
              <Pressable pressScale={0.95} haptic="light" onPress={resetView}>
                <Text style={[t.subhead, { color: colors.paperSecondary, fontWeight: '600' }]}>Nullstill zoom</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
