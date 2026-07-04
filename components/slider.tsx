import { useEffect, useRef, useState } from 'react'
import { View, PanResponder, type LayoutChangeEvent } from 'react-native'
import { colors, radius } from '../lib/theme'

/**
 * Enkel dra-slider (0–100) uten native avhengighet — PanResponder + prosent-fyll.
 * onChange kalles ved slipp; visning følger dra live.
 */
export function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const widthRef = useRef(1)
  const draggingRef = useRef(false)
  const [display, setDisplay] = useState(value)

  useEffect(() => { if (!draggingRef.current) setDisplay(value) }, [value])

  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)))
  const pct = (locationX: number) => clamp((locationX / widthRef.current) * 100)

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: e => { draggingRef.current = true; setDisplay(pct(e.nativeEvent.locationX)) },
      onPanResponderMove: e => setDisplay(pct(e.nativeEvent.locationX)),
      onPanResponderRelease: e => { const v = pct(e.nativeEvent.locationX); draggingRef.current = false; setDisplay(v); onChange(v) },
      onPanResponderTerminate: () => { draggingRef.current = false },
    }),
  ).current

  return (
    <View
      onLayout={(ev: LayoutChangeEvent) => { widthRef.current = ev.nativeEvent.layout.width || 1 }}
      {...pan.panHandlers}
      style={{ height: 32, justifyContent: 'center' }}
      hitSlop={{ top: 8, bottom: 8 }}
    >
      <View style={{ height: 10, borderRadius: radius.pill, backgroundColor: colors.fill, overflow: 'hidden' }}>
        <View style={{ width: `${display}%`, height: '100%', backgroundColor: colors.cta, borderRadius: radius.pill }} />
      </View>
    </View>
  )
}
