import { useMemo, useRef, useState } from 'react'
import { View, LayoutChangeEvent } from 'react-native'
import { Text } from './text'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'
import { Canvas, Path } from '@shopify/react-native-skia'
import { Pressable } from './pressable'
import type { SignaturStrok } from '../lib/db/models/order-signature'
import { colors, spacing, radius, paperType as t } from '../lib/theme'

/** Punkter (0–1) → SVG-sti i piksler. Delt av tegneflaten og gjengivelsen. */
export function signaturSti(points: [number, number][], w: number, h: number): string {
  if (points.length === 0) return ''
  let d = `M${points[0][0] * w} ${points[0][1] * h}`
  for (let i = 1; i < points.length; i++) d += ` L${points[i][0] * w} ${points[i][1] * h}`
  // Ett enkelt punkt (en prikk) tegner ingen linje — gi den en minimal lengde,
  // ellers forsvinner en signatur som bare er en prikk helt.
  if (points.length === 1) d += ` L${points[0][0] * w + 0.6} ${points[0][1] * h}`
  return d
}

/**
 * Skrivbar signaturflate.
 *
 * Punktene lagres normalisert (0–1) sammen med flatens sideforhold. Da kan
 * signaturen rendres skarpt i hvilken som helst størrelse senere — på en
 * ordreoversikt, i et PDF-vedlegg — uten at den strekkes.
 */
export function SignaturePad({ strokes, onChange, height = 200 }: {
  strokes: SignaturStrok[]
  onChange: (s: SignaturStrok[]) => void
  height?: number
}) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [current, setCurrent] = useState<[number, number][]>([])
  const sizeRef = useRef({ w: 0, h: 0 })
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes

  function onLayout(e: LayoutChangeEvent) {
    const { width, height: h } = e.nativeEvent.layout
    sizeRef.current = { w: width, h }
    setSize({ w: width, h })
  }

  function start(x: number, y: number) {
    const { w, h } = sizeRef.current
    if (w <= 0 || h <= 0) return
    setCurrent([[x / w, y / h]])
  }

  function extend(x: number, y: number) {
    const { w, h } = sizeRef.current
    if (w <= 0 || h <= 0) return
    setCurrent(prev => [...prev, [x / w, y / h]])
  }

  function end() {
    setCurrent(punkter => {
      if (punkter.length > 0) onChange([...strokesRef.current, { points: punkter }])
      return []
    })
  }

  const gesture = useMemo(() => Gesture.Pan()
    .maxPointers(1)
    .minDistance(0)
    .onBegin(e => { 'worklet'; runOnJS(start)(e.x, e.y) })
    .onUpdate(e => { 'worklet'; runOnJS(extend)(e.x, e.y) })
    .onEnd(() => { 'worklet'; runOnJS(end)() })
    // Fingeren løftes ikke alltid pent — uten dette blir siste strøk borte
    // hvis gesten avbrytes av at systemet tar over.
    .onFinalize(() => { 'worklet'; runOnJS(end)() }), [])

  const tomt = strokes.length === 0 && current.length === 0

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View
          onLayout={onLayout}
          style={{
            height, backgroundColor: colors.paperBg, borderRadius: radius.lg,
            borderWidth: 1, borderColor: colors.paperBorder, overflow: 'hidden',
          }}
        >
          <Canvas style={{ flex: 1 }}>
            {strokes.map((s, i) => (
              <Path key={i} path={signaturSti(s.points, size.w, size.h)}
                style="stroke" color={colors.paperLabel} strokeWidth={2.4} strokeCap="round" strokeJoin="round" />
            ))}
            {current.length > 0 && (
              <Path path={signaturSti(current, size.w, size.h)}
                style="stroke" color={colors.paperLabel} strokeWidth={2.4} strokeCap="round" strokeJoin="round" />
            )}
          </Canvas>
          {tomt && (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.footnote, { color: colors.paperTertiary }]}>Signer her</Text>
            </View>
          )}
          {/* Signaturlinje, som på papir — den forteller hvor man skal skrive. */}
          <View pointerEvents="none" style={{
            position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg + 4,
            height: 0.5, backgroundColor: colors.paperSeparator,
          }} />
        </View>
      </GestureDetector>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
        <Pressable haptic="light" hitSlop={8} disabled={strokes.length === 0}
          onPress={() => onChange(strokes.slice(0, -1))}>
          <Text style={[t.subhead, { color: strokes.length === 0 ? colors.paperTertiary : colors.paperSecondary }]}>Angre strøk</Text>
        </Pressable>
        <Pressable haptic="light" hitSlop={8} disabled={tomt} onPress={() => onChange([])}>
          <Text style={[t.subhead, { color: tomt ? colors.paperTertiary : colors.paperSecondary }]}>Tøm</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** Skrivebeskyttet gjengivelse av en lagret signatur. */
export function SignaturVisning({ strokes, aspect, width }: {
  strokes: SignaturStrok[]
  aspect: number
  width: number
}) {
  // Sideforholdet lagres ved signering nettopp for dette: en signatur som
  // strekkes er en signatur som ikke ser ut som den ble skrevet.
  const h = width / (aspect > 0 ? aspect : 2)
  return (
    <Canvas style={{ width, height: h }}>
      {strokes.map((s, i) => (
        <Path key={i} path={signaturSti(s.points, width, h)}
          style="stroke" color={colors.paperLabel} strokeWidth={1.8} strokeCap="round" strokeJoin="round" />
      ))}
    </Canvas>
  )
}
