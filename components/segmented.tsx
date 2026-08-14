import { useState } from 'react'
import { View, Text, LayoutChangeEvent } from 'react-native'
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated'
import { Pressable } from './pressable'
import { colors, radius, spacing, springs, type as t } from '../lib/theme'

/**
 * iOS-segmentkontroll med glidende pill. Springer mellom valg — aldri duration.
 * Bakgrunn er nøytral (fill); ingen semantisk farge (monokrom chrome).
 */
export function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const [w, setW] = useState(0)
  const pad = 3
  const seg = w > 0 ? (w - pad * 2) / options.length : 0
  const idx = Math.max(0, options.findIndex(o => o.key === value))
  const target = pad + idx * seg
  const x = useDerivedValue(() => withSpring(target, springs.settle), [target])

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))

  function onLayout(e: LayoutChangeEvent) { setW(e.nativeEvent.layout.width) }

  return (
    <View
      onLayout={onLayout}
      style={{ flexDirection: 'row', backgroundColor: colors.fill, borderRadius: radius.pill, padding: pad, height: 38 }}
    >
      {seg > 0 && (
        <Animated.View
          style={[
            {
              position: 'absolute', top: pad, left: 0, width: seg, height: 38 - pad * 2,
              borderRadius: radius.pill, backgroundColor: colors.bg,
              shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
            },
            pill,
          ]}
        />
      )}
      {options.map(o => {
        const active = o.key === value
        return (
          <Pressable
            key={o.key}
            haptic="light"
            pressScale={0.97}
            onPress={() => onChange(o.key)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[t.subhead, { fontWeight: active ? '600' : '500', color: active ? colors.label : colors.secondaryLabel }]}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
