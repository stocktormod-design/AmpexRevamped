import { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import { Canvas, Path, Skia } from '@shopify/react-native-skia'
import { useSharedValue, withSpring } from 'react-native-reanimated'
import { Text } from './text'
import { colors, springs, type as t } from '../lib/theme'

/**
 * Prosjektets ene tall som en ring. Fylles med en fjær når skjermen åpnes og
 * når tallet endres — verdien som endrer seg er bevegelsen som gjør en jobb.
 */
export function FremdriftRing({ andel, storrelse = 60, tekst }: { andel: number; storrelse?: number; tekst: string }) {
  const strek = 6
  const r = (storrelse - strek) / 2
  const bue = useMemo(() => {
    const p = Skia.Path.Make()
    p.addCircle(storrelse / 2, storrelse / 2, r)
    return p
  }, [storrelse, r])
  const slutt = useSharedValue(0)
  useEffect(() => { slutt.value = withSpring(Math.max(0, Math.min(1, andel)), springs.settle) }, [andel, slutt])
  const ferdig = andel >= 1

  return (
    <View style={{ width: storrelse, height: storrelse }}>
      <Canvas style={{ width: storrelse, height: storrelse, transform: [{ rotate: '-90deg' }] }}>
        <Path path={bue} style="stroke" strokeWidth={strek} color={colors.fill} />
        <Path path={bue} style="stroke" strokeWidth={strek} strokeCap="round"
          color={ferdig ? colors.success : colors.label} start={0} end={slutt} />
      </Canvas>
      <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[t.subhead, { fontWeight: '700', fontVariant: ['tabular-nums'] }]}>{tekst}</Text>
      </View>
    </View>
  )
}
