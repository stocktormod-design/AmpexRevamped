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
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Text } from './text'
import { Canvas, Group, Image as SkiaImage, ImageSVG, Path, Circle, Skia, useImage, vec } from '@shopify/react-native-skia'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'
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
export type PanePin = { id: string; x: number; y: number }

export type EditTool = 'velg' | 'penn' | 'linje' | 'sloyfe' | 'brann' | 'pan'
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

export function DrawingPane({ drawing, width, height, transform, pins, edit, onActivate, onGestureEnd, onLongPress, onTapPin }: {
  drawing: Drawing
  width: number
  height: number
  transform: PaneTransform
  /** Oppgave-pins (normaliserte sidekoordinater) — skjermen filtrerer til «mine» */
  pins?: PanePin[]
  /** Edit-modus: verktøy/farge/kladd fra forelderen (verktøylinja bor der) */
  edit?: PaneEdit
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
  const [lineStart, setLineStart] = useState<[number, number] | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [dragNode, setDragNode] = useState<[number, number] | null>(null) // live-posisjon under dra

  // Raster: R2-cache → native PDFKit-render (cachet på fil+side+størrelse+mtime)
  const filePath = drawing.filePath
  useEffect(() => {
    let alive = true
    setRaster(null); setFailed(false)
    if (!filePath) { setFailed(true); return }
    getLocalPdf(filePath)
      .then(uri => renderPdfPage(uri, 0, 2048))
      .then(r => { if (alive) setRaster(r) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [filePath])

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
      .query(Q.where('drawing_id', drawing.id))
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
  useEffect(() => { setLineStart(null); setSelection(null); setCurrent([]); setDragNode(null) }, [tool, editing])

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
  const ended = (ds: number, dtx: number, dty: number) => onGestureEnd?.({ ds, dtx, dty })

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

  // ── Visnings-gester ──
  const panGesture = Gesture.Pan()
    .enabled(!editing || tool === 'pan')
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
    .onStart(() => { savedTx.value = tx.value; savedTy.value = ty.value })
    .onUpdate(e => {
      tx.value = savedTx.value + e.translationX
      ty.value = savedTy.value + e.translationY
    })

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value
      runOnJS(activate)()
    })
    .onUpdate(e => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), 8)
    })
    .onEnd(() => {
      runOnJS(ended)(scale.value / Math.max(savedScale.value, 0.001), 0, 0)
    })

  const handleLongPress = (sx: number, sy: number) => {
    if (editing) return
    const pt = toPage(sx, sy)
    if (pt && onLongPress) onLongPress(pt)
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
    if (edit.tool === 'linje') {
      // AutoCAD mobile-mønsteret: to tapp. Linje = kladd-strek med 2 punkter —
      // samme skjema som penn, så publisering/synk er uendret.
      if (!lineStart) { setLineStart([pt.x, pt.y]); return }
      edit.onDraftChange([...edit.draft, { points: [lineStart, [pt.x, pt.y]], color: edit.color, width: edit.width }])
      setLineStart([pt.x, pt.y]) // fortsett polylinje-aktig fra forrige punkt (tapp nytt verktøy for å avslutte)
      return
    }
    if (edit.tool === 'sloyfe') {
      addLoopNode(pt.x, pt.y)
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

  async function addLoopNode(nx: number, ny: number) {
    if (!edit) return
    let loop = loops.length > 0 ? loops[loops.length - 1] : null
    const node: LoopNode = { x: nx, y: ny }
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
    if (phase === 'start') { setCurrent([[pt.x, pt.y]]); return }
    if (phase === 'move') { setCurrent(c => [...c, [pt.x, pt.y]]); return }
    setCurrent(c => {
      const pts = [...c, [pt.x, pt.y]] as [number, number][]
      if (pts.length > 1) edit.onDraftChange([...edit.draft, { points: pts, color: edit.color, width: edit.width }])
      return []
    })
  }

  const dragMove = (sx: number, sy: number, done: boolean) => {
    if (selection?.type !== 'node') return
    const pt = toPage(sx, sy, true)!
    if (!done) { setDragNode([pt.x, pt.y]); return }
    setDragNode(null)
    moveSelectedNode(pt.x, pt.y)
  }

  const editPanGesture = Gesture.Pan()
    .maxPointers(1)
    .enabled(editing && (tool === 'penn' || tool === 'velg'))
    .onStart(e => {
      if (tool === 'penn') runOnJS(penPoint)(e.x, e.y, 'start')
      else runOnJS(editTap)(e.x, e.y) // velg: dra rett på en node velger + flytter i samme gest
    })
    .onUpdate(e => {
      if (tool === 'penn') runOnJS(penPoint)(e.x, e.y, 'move')
      else runOnJS(dragMove)(e.x, e.y, false)
    })
    .onEnd(e => {
      if (tool === 'penn') runOnJS(penPoint)(e.x, e.y, 'end')
      else runOnJS(dragMove)(e.x, e.y, true)
    })

  const longPressGesture = Gesture.LongPress()
    .minDuration(400)
    .enabled(!editing)
    .onStart(e => { runOnJS(handleLongPress)(e.x, e.y) })
  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd(e => {
      if (editing) runOnJS(editTap)(e.x, e.y)
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
                    {nodes.map((p, i) => (
                      <Circle key={i} cx={p[0]} cy={p[1]} r={4} color={l.color} />
                    ))}
                  </Group>
                )
              })}
              {strokes.map((s, i) => (
                <Path key={i}
                  path={svgFrom(s.points.map(([x, y]) => [x * W, y * H]))}
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
                  path={svgFrom(s.points.map(([x, y]) => [x * W, y * H]))}
                  style="stroke" color={s.color} strokeWidth={s.width}
                  strokeCap="round" strokeJoin="round" />
              ))}
              {editing && current.length > 1 && (
                <Path path={svgFrom(current.map(([x, y]) => [x * W, y * H]))}
                  style="stroke" color={edit!.color} strokeWidth={edit!.width}
                  strokeCap="round" strokeJoin="round" />
              )}
              {/* Linje-start-markør (to-tapp) */}
              {editing && lineStart && (
                <Group>
                  <Circle cx={lineStart[0] * W} cy={lineStart[1] * H} r={gripR} color="rgba(0,0,0,0)" style="fill" />
                  <Circle cx={lineStart[0] * W} cy={lineStart[1] * H} r={gripR} color={edit!.color} style="stroke" strokeWidth={markW} />
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
              {/* Oppgave-pins — kun visning (skjules i edit) */}
              {!editing && pins?.map(p => (
                <Group key={p.id}>
                  <Circle cx={p.x * W} cy={p.y * H} r={pinR} color="#FFFFFF" />
                  <Circle cx={p.x * W} cy={p.y * H} r={pinRi} color={colors.brand} />
                </Group>
              ))}
            </Group>
          </Group>
        </Canvas>
      </GestureDetector>

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
