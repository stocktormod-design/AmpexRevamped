// DrawingPane — fase 1 av tegning-multiview (docs/TEGNING_MULTIVIEW_PLAN.md).
// Rasterert PDF-side (AmpexPdf, native) + EID pan/zoom-transform (Reanimated
// shared values, eid av FORELDEREN så synk-låsen kan kopiere deltaer mellom
// ruter) + Skia-overlay som deler samme matrise — markup/sløyfer sitter bom
// fast på tegningen i alle zoom-nivåer. Visnings-utgave: publisert markup +
// sløyfelinjer; editoren porteres hit i neste fase (symboler tegnes som
// fargede noder inntil videre). Inaktive ruter i multiview er stille av seg
// selv: transformen er per-rute, så en gest i én rute rører ikke de andre.
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Text } from './text'
import { Canvas, Group, Image as SkiaImage, Path, Circle, useImage, vec } from '@shopify/react-native-skia'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { Q } from '@nozbe/watermelondb'
import { database } from '../lib/db'
import { Drawing } from '../lib/db/models/drawing'
import { DrawingMarkup, type Stroke } from '../lib/db/models/drawing-markup'
import { DrawingLoop } from '../lib/db/models/drawing-loop'
import { getLocalPdf } from '../lib/drawings-storage'
import { renderPdfPage, type PdfPageRaster } from '../modules/ampex-splat'
import { colors, type as t } from '../lib/theme'

export type PaneTransform = {
  scale: SharedValue<number>
  tx: SharedValue<number>
  ty: SharedValue<number>
}

export type PaneDelta = { ds: number; dtx: number; dty: number }

function svgFrom(points: [number, number][]): string {
  if (points.length === 0) return ''
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length; i++) d += ` L ${points[i][0]} ${points[i][1]}`
  return d
}

export function DrawingPane({ drawing, width, height, transform, onActivate, onGestureEnd }: {
  drawing: Drawing
  width: number
  height: number
  transform: PaneTransform
  onActivate?: () => void
  onGestureEnd?: (delta: PaneDelta) => void
}) {
  const [raster, setRaster] = useState<PdfPageRaster | null>(null)
  const [failed, setFailed] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [loops, setLoops] = useState<DrawingLoop[]>([])

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

  const panGesture = Gesture.Pan()
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

  const userTransform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ])
  const center = useMemo(() => vec(width / 2, height / 2), [width, height])

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
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinchGesture, panGesture)}>
      <Canvas style={{ width, height, backgroundColor: '#E7E7EC' }}>
        <Group transform={userTransform} origin={center}>
          <Group transform={[{ translateX: ox }, { translateY: oy }]}>
            {img && <SkiaImage image={img} x={0} y={0} width={W} height={H} fit="fill" />}
            {loops.map(l => {
              const pts = l.nodeList.map(n => [n.x * W, n.y * H] as [number, number])
              return (
                <Group key={l.id}>
                  {pts.length >= 2 && (
                    <Path path={svgFrom(pts)} style="stroke" color={l.color}
                      strokeWidth={2.5} strokeCap="round" strokeJoin="round" />
                  )}
                  {pts.map((p, i) => (
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
          </Group>
        </Group>
      </Canvas>
    </GestureDetector>
  )
}
