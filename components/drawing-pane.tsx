// DrawingPane — fase 1 av tegning-multiview (docs/TEGNING_MULTIVIEW_PLAN.md).
// Rasterert PDF-side (AmpexPdf, native) + EID pan/zoom-transform (Reanimated
// shared values, eid av FORELDEREN så synk-låsen kan kopiere deltaer mellom
// ruter) + Skia-overlay som deler samme matrise — markup/sløyfer sitter bom
// fast på tegningen i alle zoom-nivåer. Inaktive ruter i multiview er stille
// av seg selv: transformen er per-rute, så en gest i én rute rører ikke de andre.
//
// EDIT-MODUS (Autodesk-mønstrene fra researchen, samme lerret — ingen egen
// editor-skjerm): verktøyet kommer fra forelderen (verktøylinja bor der).
//  - linje: TO TAPP (AutoCAD mobile-mønsteret) — første tapp setter start-
//    markør, andre committer. Penn: frihånd. Sløyfe: tapp-tapp fortsetter.
//  - velg: tapp velger sløyfenode (dra = flytt, grip-semantikk) eller kladd-
//    strek (slett). Kontekstuell slett-knapp ved valget — ikke fast verktøy.
//  - to fingre panorerer ALLTID i edit; pinch zoomer alltid.
// Kladden eies av forelderen (angre/publiser der); sløyfer skrives rett i DB
// som før (samme som gammel editor).
import { useEffect, useMemo, useState, useRef } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Text } from './text'
import { Canvas, Group, Image as SkiaImage, ImageSVG, Path, Circle, Skia, useImage, vec } from '@shopify/react-native-skia'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'
import { Trash2 } from 'lucide-react-native'
import { Q } from '@nozbe/watermelondb'
import { Pressable } from './pressable'
import { database } from '../lib/db'
import { syncQuietly } from '../lib/db/sync'
import { Drawing } from '../lib/db/models/drawing'
import { DrawingMarkup, type Stroke } from '../lib/db/models/drawing-markup'
import { DrawingLoop, type LoopNode } from '../lib/db/models/drawing-loop'
import { FireDevice, type FireDeviceKind } from '../lib/db/models/fire-device'
import { symbolSvg } from '../lib/symbols'
import { getLocalPdf } from '../lib/drawings-storage'
import { renderPdfPage, type PdfPageRaster } from '../modules/ampex-splat'
import { colors, radius, shadows, spacing, type as t } from '../lib/theme'

export type PaneTransform = {
  scale: SharedValue<number>
  tx: SharedValue<number>
  ty: SharedValue<number>
}

export type PaneDelta = { ds: number; dtx: number; dty: number }
/** Rom fra romdelingen. Usynlig til vanlig — bare et treffområde. */
export type PaneRoom = { id: string; navn: string; punkter: [number, number][] }
export type PanePin = { id: string; x: number; y: number }

/** «ingen» = ingen verktøy i hånda: én finger panorerer, som i kartapper. */
export type EditTool = 'ingen' | 'velg' | 'penn' | 'sloyfe' | 'brann' | 'pan'
export type PaneEdit = {
  tool: EditTool
  color: string
  width: number
  draft: Stroke[]
  onDraftChange: (next: Stroke[]) => void
  /** brann-verktøyet (stempel-modus, Fieldwire-mønsteret): tapp plasserer — forelderen
      lager fire_devices-raden (auto-tag) og åpner device-arket */
  onPlaceDevice?: (pt: { x: number; y: number }) => void
  /** velg: tapp på brannkomponent → forelderen åpner device-arket */
  onTapDevice?: (id: string) => void
}

// fire_devices.kind → symbol-id i lib/symbols.ts (tegnes som NEK-aktige glyfer)
const KIND_SYMBOL: Record<FireDeviceKind, string> = {
  royk: 'royk', varme: 'sensor', multi: 'royk', melder: 'melder',
  klokke: 'klokke', sirene: 'klokke', sentral: 'fordeling', annet: 'royk',
}

type Selection =
  | { type: 'node'; loopId: string; index: number }
  | { type: 'draft'; index: number }
  | null

/** Farge per rom — stabil på id, så et rom beholder fargen sin. */
const ROM_FARGER = ['#FF3B30', '#0A84FF', '#34C759', '#FF9F0A', '#BF5AF2', '#00C7BE', '#FF375F', '#8E8E93']
function romFarge(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return ROM_FARGER[h % ROM_FARGER.length]
}

/** Oppløsningstrinn for sidebildet. Taket er Skia-tekstur-grensa på iOS. */
const NIVAAER = [2048, 4096, 8192]

/**
 * Glattet strek: kvadratiske bezier gjennom midtpunktene mellom målte punkter.
 * En rå polylinje av fingerpunkter leses som skjelvende — dette er standard-
 * trikset (samme som Apple Notes/Procreate bruker) og koster ingenting.
 */
function smoothFrom(points: [number, number][]): string {
  const n = points.length
  if (n === 0) return ''
  if (n < 3) return svgFrom(points)
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < n - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2
    const my = (points[i][1] + points[i + 1][1]) / 2
    d += ` Q ${points[i][0]} ${points[i][1]} ${mx} ${my}`
  }
  d += ` L ${points[n - 1][0]} ${points[n - 1][1]}`
  return d
}

/** Fjerner punkter som ligger oppå hverandre — halverer typisk strøket. */
function tynn(points: [number, number][], min = 0.0016): [number, number][] {
  if (points.length < 3) return points
  const ut: [number, number][] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const p = ut[ut.length - 1]
    if (Math.hypot(points[i][0] - p[0], points[i][1] - p[1]) >= min) ut.push(points[i])
  }
  ut.push(points[points.length - 1])
  return ut
}

/** «3,42 m» / «84 cm» — meter er montørens enhet, ikke piksler. */
function formatM(m: number): string {
  if (!isFinite(m) || m <= 0) return ''
  return m < 1
    ? `${Math.round(m * 100)} cm`
    : `${m.toFixed(2).replace('.', ',')} m`
}

function svgFrom(points: [number, number][]): string {
  if (points.length === 0) return ''
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length; i++) d += ` L ${points[i][0]} ${points[i][1]}`
  return d
}

function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const len2 = vx * vx + vy * vy
  const s = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0
  return Math.hypot(p[0] - (a[0] + s * vx), p[1] - (a[1] + s * vy))
}

/** Ett drahåndtak på et romhjørne. Egen komponent så gesten eier sin egen start. */
function RomHandtak({ x, y, farge, onFlytt, onSlutt }: {
  x: number; y: number; farge: string
  onFlytt: (dx: number, dy: number) => void
  onSlutt: () => void
}) {
  const gest = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onUpdate(e => { 'worklet'; runOnJS(onFlytt)(e.translationX, e.translationY) })
    .onEnd(() => { 'worklet'; runOnJS(onSlutt)() }), [onFlytt, onSlutt])
  return (
    <GestureDetector gesture={gest}>
      <View style={{ position: 'absolute', left: x - 16, top: y - 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 14, height: 14, borderRadius: 8, backgroundColor: '#fff', borderWidth: 3, borderColor: farge }} />
      </View>
    </GestureDetector>
  )
}

export function DrawingPane({ drawing, width, height, transform, pins, edit, rooms, roomEdit, maalestokk = 50, onRoomLongPress, onRoomShape, onNavigate, onActivate, onGestureEnd, onLongPress, onTapPin }: {
  drawing: Drawing
  width: number
  height: number
  transform: PaneTransform
  /** Oppgave-pins (normaliserte sidekoordinater) — skjermen filtrerer til «mine» */
  pins?: PanePin[]
  /** Edit-modus: verktøy/farge/kladd fra forelderen (verktøylinja bor der) */
  edit?: PaneEdit
  /** Rommene på denne tegningen. Tegnes KUN når roomEdit er på; ellers er de
      usynlige treffområder for langtrykk. */
  rooms?: PaneRoom[]
  roomEdit?: boolean
  /** Tegningens målestokk (1:N) — måleverktøyet regner meter av den. */
  maalestokk?: number
  /** Langtrykk (1 s) inne i et rom → forelderen åpner rompanelet. */
  onRoomLongPress?: (id: string) => void
  /** Hjørne dratt i romredigering. */
  onRoomShape?: (id: string, punkter: [number, number][]) => void
  /** Panorering/zoom startet — forelderen legger bort verktøyet. */
  onNavigate?: () => void
  onActivate?: () => void
  onGestureEnd?: (delta: PaneDelta) => void
  /** Langtrykk på tegningen → normaliserte sidekoordinater (ny oppgave her) */
  onLongPress?: (pt: { x: number; y: number }) => void
  onTapPin?: (id: string) => void
}) {
  const [raster, setRaster] = useState<PdfPageRaster | null>(null)
  const [failed, setFailed] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [loops, setLoops] = useState<DrawingLoop[]>([])
  const editing = !!edit

  // Edit-tilstand
  const [current, setCurrent] = useState<[number, number][]>([]) // penn, normalisert
  const currentRef = useRef<[number, number][]>([]) // samme, lesbar utenfor render
  const settCurrent = (pts: [number, number][]) => { currentRef.current = pts; setCurrent(pts) }
  const [romDrag, setRomDrag] = useState<{ id: string; punkter: [number, number][] } | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [dragNode, setDragNode] = useState<[number, number] | null>(null) // live-posisjon under dra
  /** Gummibånd under dra (linje/mål/sløyfe) — det du får når du slipper. */
  const [gummi, setGummi] = useState<{ a: [number, number]; b: [number, number]; snap: boolean } | null>(null)
  const snapVarslet = useRef(false)
  /** Båndets sannhet under gesten — state er kun for tegningen. En setState-
   *  oppdaterer må være ren; sideeffekter der ga «cannot update a component
   *  while rendering another» sist (se penPoint). */
  const gummiRef = useRef<{ a: [number, number]; b: [number, number]; snap: boolean } | null>(null)
  const settGummi = (g: { a: [number, number]; b: [number, number]; snap: boolean } | null) => { gummiRef.current = g; setGummi(g) }

  // Bytter du verktøy, skal ikke et halvferdig bånd eller en gammel måling
  // henge igjen på lerretet.
  useEffect(() => { settGummi(null) }, [edit?.tool])

  // Raster: R2-cache → native PDFKit-render (cachet på fil+side+størrelse+mtime).
  // PROGRESSIV: siden rendres på nytt i høyere oppløsning når du zoomer inn.
  // Ett fast 2048-raster blir grøt allerede ved 2× — teksten på en A1-tegning er
  // små punkter, og de MÅ ha piksler for å bli lesbare.
  const filePath = drawing.filePath
  const [nivaa, setNivaa] = useState(NIVAAER[0])
  useEffect(() => { setNivaa(NIVAAER[0]) }, [filePath])
  useEffect(() => {
    let alive = true
    setFailed(false)
    if (!filePath) { setFailed(true); return }
    getLocalPdf(filePath)
      .then(uri => renderPdfPage(uri, 0, nivaa))
      // Byttes UT under det gamle bildet — ingen blank skjerm mens det nye lages.
      .then(r => { if (alive) setRaster(r) })
      .catch(() => { if (alive && !raster) setFailed(true) })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, nivaa])

  /** Etter en gest: trenger vi et skarpere raster for zoomnivået vi endte på? */
  const vurderOpplosning = () => {
    const ønsket = NIVAAER.find(n => n >= 2048 * Math.min(scale.value, 4)) ?? NIVAAER[NIVAAER.length - 1]
    if (ønsket > nivaa) setNivaa(ønsket)
  }

  // Markup: ALLE rader for tegningen — leser både gammel blob-form (én rad) og
  // rad-per-publisering-formen fra v32 med samme kode (begge har Stroke[] i data).
  useEffect(() => {
    const sub = database.get<DrawingMarkup>('drawing_markup')
      .query(Q.where('drawing_id', drawing.id))
      .observe().subscribe(rows => setStrokes(rows.flatMap(r => r.strokes)))
    return () => sub.unsubscribe()
  }, [drawing.id])

  useEffect(() => {
    const sub = database.get<DrawingLoop>('drawing_loops')
      .query(Q.where('drawing_id', drawing.id), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setLoops)
    return () => sub.unsubscribe()
  }, [drawing.id])

  const [devices, setDevices] = useState<FireDevice[]>([])
  useEffect(() => {
    const sub = database.get<FireDevice>('fire_devices')
      .query(Q.where('drawing_id', drawing.id))
      .observe().subscribe(setDevices)
    return () => sub.unsubscribe()
  }, [drawing.id])

  // Verktøybytte nullstiller pågående handling (halv linje, valg)
  const tool = edit?.tool
  useEffect(() => { setSelection(null); setCurrent([]); setDragNode(null) }, [tool, editing])

  const img = useImage(raster ? 'file://' + raster.uri : null)

  // Sidens plass i ruta (fit + sentrering) — markup er normalisert mot sidevisningen
  const fitted = useMemo(() => {
    if (!raster) return null
    const fit = Math.min(width / raster.width, height / raster.height)
    const w = raster.width * fit, h = raster.height * fit
    return { w, h, ox: (width - w) / 2, oy: (height - h) / 2 }
  }, [raster, width, height])

  const { scale, tx, ty } = transform
  const savedScale = useSharedValue(1)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)

  const activate = () => onActivate?.()
  const ended = (ds: number, dtx: number, dty: number) => {
    onGestureEnd?.({ ds, dtx, dty })
    vurderOpplosning()
  }

  // Skjerm → normaliserte sidekoordinater. Transformrekkefølgen er
  // origin(C) ∘ translate(tx,ty) ∘ scale(s): screen = C + (tx,ty) + s·(pane − C).
  const toPage = (sx: number, sy: number, clamp = false): { x: number; y: number } | null => {
    if (!fitted) return null
    const s = scale.value
    const px = (width / 2) + (sx - width / 2 - tx.value) / s
    const py = (height / 2) + (sy - height / 2 - ty.value) / s
    let x = (px - fitted.ox) / fitted.w
    let y = (py - fitted.oy) / fitted.h
    if (clamp) { x = Math.min(Math.max(x, 0), 1); y = Math.min(Math.max(y, 0), 1) }
    else if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
  }
  const toScreen = (nx: number, ny: number): { x: number; y: number } => {
    const f = fitted!
    const s = scale.value
    const panePt = { x: f.ox + nx * f.w, y: f.oy + ny * f.h }
    return {
      x: width / 2 + tx.value + s * (panePt.x - width / 2),
      y: height / 2 + ty.value + s * (panePt.y - height / 2),
    }
  }

  /**
   * Fangpunkter: endene på strekene du alt har tegnet, sløyfenodene og
   * komponentene. Uten fang blir to streker som «møtes» aldri helt like —
   * og på en tegning er nettopp det forskjellen på skisse og dokumentasjon.
   */
  const fangPunkter = (): [number, number][] => {
    const ut: [number, number][] = []
    for (const st of edit?.draft ?? []) {
      if (st.points.length) { ut.push(st.points[0]); ut.push(st.points[st.points.length - 1]) }
    }
    for (const l of loops) for (const n of l.nodeList) ut.push([n.x, n.y])
    for (const d of devices) ut.push([d.x, d.y])
    return ut
  }
  /** Fanger til nærmeste punkt innen 18 px på skjermen. */
  const fang = (p: [number, number]): { pt: [number, number]; traff: boolean } => {
    const scr = toScreen(p[0], p[1])
    let best: { pt: [number, number]; d: number } | null = null
    for (const k of fangPunkter()) {
      const s2 = toScreen(k[0], k[1])
      const d = Math.hypot(s2.x - scr.x, s2.y - scr.y)
      if (d < 18 && (!best || d < best.d)) best = { pt: k, d }
    }
    return best ? { pt: best.pt, traff: true } : { pt: p, traff: false }
  }
  /** Vinkellås: innen 4° av 0/45/90° legges linja eksakt der. */
  const rettVinkel = (a: [number, number], b: [number, number]): [number, number] => {
    if (!fitted) return b
    const dx = (b[0] - a[0]) * fitted.w, dy = (b[1] - a[1]) * fitted.h
    const len = Math.hypot(dx, dy)
    if (len < 1) return b
    const v = Math.atan2(dy, dx)
    const steg = Math.PI / 4
    const naer = Math.round(v / steg) * steg
    if (Math.abs(v - naer) > (4 * Math.PI) / 180) return b
    return [a[0] + (Math.cos(naer) * len) / fitted.w, a[1] + (Math.sin(naer) * len) / fitted.h]
  }
  /** Lengde i meter: normalisert → punkt på papiret → mm → målestokk. */
  const meter = (a: [number, number], b: [number, number]): number => {
    const wpt = raster?.widthPt, hpt = raster?.heightPt
    if (!wpt || !hpt) return 0
    const dx = (b[0] - a[0]) * wpt, dy = (b[1] - a[1]) * hpt
    return (Math.hypot(dx, dy) * 0.352778 * maalestokk) / 1000
  }
  const grader = (a: [number, number], b: [number, number]): number => {
    if (!fitted) return 0
    const v = (Math.atan2((b[1] - a[1]) * fitted.h, (b[0] - a[0]) * fitted.w) * 180) / Math.PI
    return Math.round(((v % 180) + 180) % 180)
  }

  // ── Visnings-gester ──
  const panGesture = Gesture.Pan()
    .enabled(!editing || tool === 'ingen' || tool === 'pan')
    .onStart(() => {
      savedTx.value = tx.value
      savedTy.value = ty.value
      runOnJS(activate)()
    })
    .onUpdate(e => {
      tx.value = savedTx.value + e.translationX
      ty.value = savedTy.value + e.translationY
    })
    .onEnd(() => {
      runOnJS(ended)(1, tx.value - savedTx.value, ty.value - savedTy.value)
    })

  // To-finger-pan er ALLTID tilgjengelig i edit (verktøyet eier én finger)
  const pan2Gesture = Gesture.Pan()
    .minPointers(2)
    .enabled(editing)
    .onStart(() => {
      savedTx.value = tx.value; savedTy.value = ty.value
      if (onNavigate) runOnJS(onNavigate)()
    })
    .onUpdate(e => {
      tx.value = savedTx.value + e.translationX
      ty.value = savedTy.value + e.translationY
    })

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value
      runOnJS(activate)()
      if (onNavigate) runOnJS(onNavigate)()
    })
    .onUpdate(e => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), 8)
    })
    .onEnd(() => {
      runOnJS(ended)(scale.value / Math.max(savedScale.value, 0.001), 0, 0)
    })

  /** Er punktet inne i polygonet? (stråle-test, normaliserte koordinater) */
  const iPolygon = (pts: [number, number][], x: number, y: number) => {
    let inne = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inne = !inne
    }
    return inne
  }

  const handleLongPress = (sx: number, sy: number) => {
    const pt = toPage(sx, sy)
    if (!pt) return
    // Rommene ligger under fingeren som usynlige knapper. Minste rom vinner,
    // så et lite bad inni en stor sone er treffbart.
    if (rooms?.length && onRoomLongPress) {
      let best: { id: string; areal: number } | null = null
      for (const r of rooms) {
        if (!iPolygon(r.punkter, pt.x, pt.y)) continue
        let a = 0
        for (let i = 0, j = r.punkter.length - 1; i < r.punkter.length; j = i++) {
          a += (r.punkter[j][0] + r.punkter[i][0]) * (r.punkter[j][1] - r.punkter[i][1])
        }
        const areal = Math.abs(a / 2)
        if (!best || areal < best.areal) best = { id: r.id, areal }
      }
      if (best) { onRoomLongPress(best.id); return }
    }
    if (editing) return
    if (onLongPress) onLongPress(pt)
  }
  const handleViewTap = (sx: number, sy: number) => {
    if (!fitted || !pins?.length || !onTapPin) return
    for (const p of pins) {
      const scr = toScreen(p.x, p.y)
      if (Math.hypot(scr.x - sx, scr.y - sy) < 26) { onTapPin(p.id); return }
    }
  }

  // ── Edit-gester ──
  const editTap = (sx: number, sy: number) => {
    if (!edit || !fitted) return
    const pt = toPage(sx, sy, true)!
    if (edit.tool === 'sloyfe') {
      // Tapp kjeder videre; dra gir forhåndsvisning (bandPoint) — begge ender her.
      void leggNode([pt.x, pt.y])
      return
    }
    if (edit.tool === 'brann') {
      // Stempel-modus (Fieldwire-mønsteret): hvert tapp plasserer en ny komponent.
      edit.onPlaceDevice?.(pt)
      return
    }
    if (edit.tool === 'velg') {
      // Treff i skjerm-rom: brannkomponenter først, så noder (grips), så kladd-streker.
      if (edit.onTapDevice) {
        for (const dv of devices) {
          const scr = toScreen(dv.x, dv.y)
          if (Math.hypot(scr.x - sx, scr.y - sy) < 24) { edit.onTapDevice(dv.id); return }
        }
      }
      for (const l of loops) {
        const nodes = l.nodeList
        for (let i = 0; i < nodes.length; i++) {
          const scr = toScreen(nodes[i].x, nodes[i].y)
          if (Math.hypot(scr.x - sx, scr.y - sy) < 24) { setSelection({ type: 'node', loopId: l.id, index: i }); return }
        }
      }
      const sp: [number, number] = [sx, sy]
      for (let i = edit.draft.length - 1; i >= 0; i--) {
        const pts = edit.draft[i].points.map(([x, y]) => { const s2 = toScreen(x, y); return [s2.x, s2.y] as [number, number] })
        for (let j = 0; j + 1 < pts.length || (pts.length === 1 && j === 0); j++) {
          const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)]
          if (distToSegment(sp, a, b) < 16) { setSelection({ type: 'draft', index: i }); return }
        }
      }
      setSelection(null)
    }
  }

  async function addLoopNode(node: LoopNode) {
    if (!edit) return
    const loop = loops.length > 0 ? loops[loops.length - 1] : null
    await database.write(async () => {
      if (loop) {
        await loop.update(l => { l.nodes = JSON.stringify([...l.nodeList, node]) })
      } else {
        await database.get<DrawingLoop>('drawing_loops').create(l => {
          l.drawingId = drawing.id
          l.name = 'Sløyfe 1'
          l.number = 1
          l.color = edit.color
          l.nodes = JSON.stringify([node])
        })
      }
    })
    syncQuietly()
  }

  async function moveSelectedNode(nx: number, ny: number) {
    if (selection?.type !== 'node') return
    const loop = loops.find(l => l.id === selection.loopId)
    if (!loop) return
    const nodes = [...loop.nodeList]
    if (!nodes[selection.index]) return
    nodes[selection.index] = { ...nodes[selection.index], x: nx, y: ny }
    await database.write(async () => { await loop.update(l => { l.nodes = JSON.stringify(nodes) }) })
    syncQuietly()
  }

  async function deleteSelection() {
    if (!edit || !selection) return
    if (selection.type === 'draft') {
      edit.onDraftChange(edit.draft.filter((_, i) => i !== selection.index))
    } else {
      const loop = loops.find(l => l.id === selection.loopId)
      if (loop) {
        const nodes = loop.nodeList.filter((_, i) => i !== selection.index)
        await database.write(async () => {
          if (nodes.length === 0) await loop.markAsDeleted()
          else await loop.update(l => { l.nodes = JSON.stringify(nodes) })
        })
        syncQuietly()
      }
    }
    setSelection(null)
  }

  const penPoint = (sx: number, sy: number, phase: 'start' | 'move' | 'end') => {
    if (!edit || edit.tool !== 'penn') return
    const pt = toPage(sx, sy, true)!
    if (phase === 'start') { settCurrent([[pt.x, pt.y]]); return }
    if (phase === 'move') { settCurrent([...currentRef.current, [pt.x, pt.y]]); return }
    // Strøket er ferdig. Forelderens kladd MÅ oppdateres utenfor en
    // state-oppdaterer: React kjører dem under rendring, og da får man
    // «cannot update a component while rendering another».
    const pts = tynn([...currentRef.current, [pt.x, pt.y]] as [number, number][])
    settCurrent([])
    if (pts.length > 1) {
      edit.onDraftChange([...edit.draft, { points: pts, color: edit.color, width: edit.width }])
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    }
  }

  const dragMove = (sx: number, sy: number, done: boolean) => {
    if (selection?.type !== 'node') return
    const pt = toPage(sx, sy, true)!
    if (!done) { setDragNode([pt.x, pt.y]); return }
    setDragNode(null)
    moveSelectedNode(pt.x, pt.y)
  }

  /**
   * SLØYFA KJEDES MELLOM KLIKK (Tormod 2026-09-06): du trykker på en detektor,
   * trykker et sted til — da går streken dit — og videre fra forrige punkt til
   * du treffer neste detektor. Treffer noden en komponent, festes den i den
   * (`deviceId`), så rekkefølgen i sløyfa ER den adresserte rekkefølgen.
   *
   * Dra i stedet for å tappe gir gummibånd med lengde og vinkellås først.
   */
  const detektorTreff = (p: [number, number]): FireDevice | null => {
    const scr = toScreen(p[0], p[1])
    let best: { d: FireDevice; avst: number } | null = null
    for (const dv of devices) {
      const s2 = toScreen(dv.x, dv.y)
      const avst = Math.hypot(s2.x - scr.x, s2.y - scr.y)
      if (avst < 26 && (!best || avst < best.avst)) best = { d: dv, avst }
    }
    return best?.d ?? null
  }

  /** Siste node i sløyfa som bygges — kjedens hode. */
  const aktivSloyfe = loops.length ? loops[loops.length - 1] : null
  const hode = (): [number, number] | null => {
    const n = aktivSloyfe?.nodeList ?? []
    return n.length ? [n[n.length - 1].x, n[n.length - 1].y] : null
  }

  const leggNode = async (p: [number, number]) => {
    const dv = detektorTreff(p)
    const node: LoopNode = dv
      ? { x: dv.x, y: dv.y, deviceId: dv.id }
      : { x: p[0], y: p[1] }
    Haptics.impactAsync(dv ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    await addLoopNode(node)
  }

  const bandPoint = (sx: number, sy: number, phase: 'start' | 'move' | 'end') => {
    if (!edit || !fitted || edit.tool !== 'sloyfe') return
    const raa = toPage(sx, sy, true)!
    if (phase === 'start') {
      const h = hode()
      const dvStart = detektorTreff([raa.x, raa.y])
      const a: [number, number] = h ?? (dvStart ? [dvStart.x, dvStart.y] : [raa.x, raa.y])
      snapVarslet.current = false
      settGummi({ a, b: a, snap: false })
      return
    }
    const g = gummiRef.current
    if (!g) return
    const dv = detektorTreff([raa.x, raa.y])
    const b: [number, number] = dv ? [dv.x, dv.y] : rettVinkel(g.a, [raa.x, raa.y])
    const snap = !!dv || b[0] !== raa.x || b[1] !== raa.y
    if (phase === 'move') {
      if (snap && !snapVarslet.current) { snapVarslet.current = true; Haptics.selectionAsync().catch(() => {}) }
      else if (!snap) snapVarslet.current = false
      settGummi({ a: g.a, b, snap })
      return
    }
    // Slipp: legg noden. Kort drag = tapp, og da gjelder punktet du traff.
    const kort = Math.hypot((b[0] - g.a[0]) * fitted.w, (b[1] - g.a[1]) * fitted.h) < 6
    settGummi(null)
    void leggNode(kort ? [raa.x, raa.y] : b)
  }

  const bandTool = tool === 'sloyfe'
  const editPanGesture = Gesture.Pan()
    .maxPointers(1)
    .enabled(editing && (tool === 'penn' || tool === 'velg' || bandTool))  // 'ingen' → panorering eier fingeren
    .onStart(e => {
      if (tool === 'penn') runOnJS(penPoint)(e.x, e.y, 'start')
      else if (bandTool) runOnJS(bandPoint)(e.x, e.y, 'start')
      else runOnJS(editTap)(e.x, e.y) // velg: dra rett på en node velger + flytter i samme gest
    })
    .onUpdate(e => {
      if (tool === 'penn') runOnJS(penPoint)(e.x, e.y, 'move')
      else if (bandTool) runOnJS(bandPoint)(e.x, e.y, 'move')
      else runOnJS(dragMove)(e.x, e.y, false)
    })
    .onEnd(e => {
      if (tool === 'penn') runOnJS(penPoint)(e.x, e.y, 'end')
      else if (bandTool) runOnJS(bandPoint)(e.x, e.y, 'end')
      else runOnJS(dragMove)(e.x, e.y, true)
    })

  const longPressGesture = Gesture.LongPress()
    .minDuration(1000)
    .maxDistance(14)
    .onStart(e => { runOnJS(handleLongPress)(e.x, e.y) })
  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd(e => {
      // Uten verktøy i hånda er et trykk «åpne pinnen», ikke «tegn».
      if (editing && tool !== 'ingen') runOnJS(editTap)(e.x, e.y)
      else runOnJS(handleViewTap)(e.x, e.y)
    })

  // Brannsymboler som Skia-SVG (rød — matcher O-plan-konvensjonen); memoisert per kind.
  const deviceSvgs = useMemo(() => {
    const out: Partial<Record<FireDeviceKind, ReturnType<typeof Skia.SVG.MakeFromString>>> = {}
    for (const kind of Object.keys(KIND_SYMBOL) as FireDeviceKind[]) {
      const raw = symbolSvg(KIND_SYMBOL[kind], '#D70015').replace('<svg ', '<svg width="24" height="24" ')
      out[kind] = Skia.SVG.MakeFromString(raw)
    }
    return out
  }, [])

  const userTransform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ])
  const center = useMemo(() => vec(width / 2, height / 2), [width, height])
  // Konstant skjermstørrelse for pins/grips/markører uansett zoom
  const pinR = useDerivedValue(() => 9 / scale.value)
  const pinRi = useDerivedValue(() => 4.5 / scale.value)
  const gripR = useDerivedValue(() => 7 / scale.value)
  const markW = useDerivedValue(() => 2 / scale.value)

  if (failed) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7E7EC' }}>
        <Text style={[t.footnote, { color: colors.paperSecondary }]}>
          {filePath ? 'Kunne ikke vise tegningen' : 'Ingen PDF lastet opp'}
        </Text>
      </View>
    )
  }
  if (!raster || !fitted) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7E7EC' }}>
        <ActivityIndicator color={colors.paperSecondary} />
      </View>
    )
  }

  const { w: W, h: H, ox, oy } = fitted
  const selNode = selection?.type === 'node'
    ? loops.find(l => l.id === selection.loopId)?.nodeList[selection.index] ?? null
    : null
  const selScreen = selection
    ? selection.type === 'node'
      ? (selNode ? toScreen(dragNode?.[0] ?? selNode.x, dragNode?.[1] ?? selNode.y) : null)
      : (edit?.draft[selection.index] ? toScreen(...edit.draft[selection.index].points[0]) : null)
    : null

  return (
    <View style={{ width, height }}>
      <GestureDetector gesture={Gesture.Simultaneous(pinchGesture, panGesture, pan2Gesture, editPanGesture, longPressGesture, tapGesture)}>
        <Canvas style={{ width, height, backgroundColor: '#E7E7EC' }}>
          <Group transform={userTransform} origin={center}>
            <Group transform={[{ translateX: ox }, { translateY: oy }]}>
              {img && <SkiaImage image={img} x={0} y={0} width={W} height={H} fit="fill" />}
              {loops.map(l => {
                const nodes = l.nodeList.map((n, i) => {
                  const drag = selection?.type === 'node' && selection.loopId === l.id && selection.index === i && dragNode
                  return [(drag ? dragNode![0] : n.x) * W, (drag ? dragNode![1] : n.y) * H] as [number, number]
                })
                return (
                  <Group key={l.id}>
                    {nodes.length >= 2 && (
                      <Path path={svgFrom(nodes)} style="stroke" color={l.color}
                        strokeWidth={2.5} strokeCap="round" strokeJoin="round" />
                    )}
                    {nodes.map((p, i) => {
                      const paaDetektor = !!l.nodeList[i]?.deviceId
                      const erHode = tool === 'sloyfe' && l.id === loops[loops.length - 1]?.id && i === nodes.length - 1
                      return (
                        <Group key={i}>
                          {paaDetektor && <Circle cx={p[0]} cy={p[1]} r={9} color={l.color} style="stroke" strokeWidth={1.6} />}
                          <Circle cx={p[0]} cy={p[1]} r={erHode ? 6 : 4} color={l.color} />
                          {erHode && <Circle cx={p[0]} cy={p[1]} r={2.5} color="#FFFFFF" />}
                        </Group>
                      )
                    })}
                  </Group>
                )
              })}
              {strokes.map((s, i) => (
                <Path key={i}
                  path={smoothFrom(s.points.map(([x, y]) => [x * W, y * H]))}
                  style="stroke" color={s.color} strokeWidth={s.width}
                  strokeCap="round" strokeJoin="round" />
              ))}
              {/* Brannkomponenter — røde symboler (O-plan-konvensjonen), skalerer med tegningen */}
              {devices.map(dv => {
                const svg = deviceSvgs[dv.kind] ?? deviceSvgs.royk
                const S = 22
                return (
                  <Group key={dv.id}>
                    <Circle cx={dv.x * W} cy={dv.y * H} r={S * 0.7} color="rgba(255,255,255,0.88)" />
                    {svg && <ImageSVG svg={svg} x={dv.x * W - S / 2} y={dv.y * H - S / 2} width={S} height={S} />}
                  </Group>
                )
              })}
              {/* Kladd (edit) — uendret utseende til publisering */}
              {edit?.draft.map((s, i) => (
                <Path key={`d${i}`}
                  path={smoothFrom(s.points.map(([x, y]) => [x * W, y * H]))}
                  style="stroke" color={s.color} strokeWidth={s.width}
                  strokeCap="round" strokeJoin="round" />
              ))}
              {editing && current.length > 1 && (
                <Path path={smoothFrom(current.map(([x, y]) => [x * W, y * H]))}
                  style="stroke" color={edit!.color} strokeWidth={edit!.width}
                  strokeCap="round" strokeJoin="round" />
              )}
              {/* GUMMIBÅND: strekket du legger når du slipper. Grønn fylt ring =
                  festet i en detektor (eller vinkellåst). */}
              {editing && gummi && (
                <Group>
                  <Path path={svgFrom([[gummi.a[0] * W, gummi.a[1] * H], [gummi.b[0] * W, gummi.b[1] * H]])}
                    style="stroke" color={edit!.color} strokeWidth={2.5 / Math.max(scale.value, 1)}
                    strokeCap="round" opacity={0.9} />
                  <Circle cx={gummi.a[0] * W} cy={gummi.a[1] * H} r={gripR} color={edit!.color} style="stroke" strokeWidth={markW} />
                  <Circle cx={gummi.b[0] * W} cy={gummi.b[1] * H} r={gripR}
                    color={gummi.snap ? '#34C759' : edit!.color}
                    style={gummi.snap ? 'fill' : 'stroke'} strokeWidth={markW} />
                </Group>
              )}
              {/* Valgt element: grip-ring på node / uthevet strek */}
              {editing && selection?.type === 'node' && selNode && (
                <Circle
                  cx={(dragNode?.[0] ?? selNode.x) * W} cy={(dragNode?.[1] ?? selNode.y) * H}
                  r={gripR} color="#2E6BE6" style="stroke" strokeWidth={markW} />
              )}
              {editing && selection?.type === 'draft' && edit?.draft[selection.index] && (
                <Path
                  path={svgFrom(edit.draft[selection.index].points.map(([x, y]) => [x * W, y * H]))}
                  style="stroke" color="#2E6BE6"
                  strokeWidth={edit.draft[selection.index].width + 3}
                  strokeCap="round" strokeJoin="round" opacity={0.5} />
              )}
              {/* Rom — synlige BARE i romredigering. Ellers er de usynlige
                  treffområder for langtrykk (se handleLongPress). */}
              {roomEdit && rooms?.map(r => {
                const pts = (r.id === romDrag?.id ? romDrag.punkter : r.punkter).map(([x, y]) => [x * W, y * H] as [number, number])
                if (pts.length < 3) return null
                const c = romFarge(r.id)
                return (
                  <Group key={`rom${r.id}`}>
                    <Path path={`${svgFrom(pts)} Z`} style="fill" color={c} opacity={0.18} />
                    <Path path={`${svgFrom(pts)} Z`} style="stroke" color={c} strokeWidth={2 / Math.max(scale.value, 1)} strokeJoin="round" />
                  </Group>
                )
              })}
              {/* Oppgave-pins — kun visning (skjules i edit) */}
              {(!editing || tool === 'ingen') && pins?.map(p => (
                <Group key={p.id}>
                  <Circle cx={p.x * W} cy={p.y * H} r={pinR} color="#FFFFFF" />
                  <Circle cx={p.x * W} cy={p.y * H} r={pinRi} color={colors.brand} />
                </Group>
              ))}
            </Group>
          </Group>
        </Canvas>
      </GestureDetector>

      {/* Romhåndtak — dra et hjørne. Kun i romredigering. */}
      {roomEdit && rooms?.map(r => {
        const pts = r.id === romDrag?.id ? romDrag.punkter : r.punkter
        return pts.map((pt, i) => {
          if (!fitted) return null
          const sk = toScreen(pt[0], pt[1])
          if (sk.x < -20 || sk.y < -20 || sk.x > width + 20 || sk.y > height + 20) return null
          return (
            <RomHandtak
              key={`h${r.id}-${i}`} x={sk.x} y={sk.y} farge={romFarge(r.id)}
              onFlytt={(dx, dy) => {
                const s = scale.value || 1
                const base = (romDrag?.id === r.id ? romDrag.punkter : r.punkter)
                const neste = base.map((p, k) => (k === i
                  ? [Math.min(1, Math.max(0, pt[0] + dx / (fitted.w * s))), Math.min(1, Math.max(0, pt[1] + dy / (fitted.h * s)))] as [number, number]
                  : p))
                setRomDrag({ id: r.id, punkter: neste })
              }}
              onSlutt={() => {
                const d = romDrag
                setRomDrag(null)
                if (d && onRoomShape) onRoomShape(d.id, d.punkter)
              }}
            />
          )
        })
      })}

      {/* AVLESNINGEN — kabellengde i meter og vinkel mens du drar strekket.
          En sløyfe uten lengde er en strek; med lengde er den en kabelliste. */}
      {editing && gummi && (() => {
        const m = meter(gummi.a, gummi.b)
        const tekst = [m > 0 ? formatM(m) : null, `${grader(gummi.a, gummi.b)}°`].filter(Boolean).join('  ·  ')
        return (
          <View pointerEvents="none" style={{ position: 'absolute', top: spacing.sm, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{
              paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill,
              backgroundColor: 'rgba(20,18,16,0.88)', justifyContent: 'center',
            }}>
              <Text style={[t.subhead, { color: '#fff', fontWeight: '700', fontVariant: ['tabular-nums'] }]}>{tekst}</Text>
            </View>
          </View>
        )
      })()}

      {/* Kontekstuell slett — Autodesk-mønsteret: redigering følger VALGET */}
      {editing && selection && selScreen && (
        <Pressable haptic="light" onPress={deleteSelection}
          style={{
            position: 'absolute',
            left: Math.min(Math.max(selScreen.x - 22, spacing.sm), width - 60),
            top: Math.min(Math.max(selScreen.y - 64, spacing.sm), height - 60),
            width: 44, height: 44, borderRadius: radius.pill,
            backgroundColor: 'rgba(252,252,253,0.96)', alignItems: 'center', justifyContent: 'center',
            borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)', ...shadows.card,
          }}>
          <Trash2 size={19} color="#C0392B" strokeWidth={2.1} />
        </Pressable>
      )}
    </View>
  )
}
