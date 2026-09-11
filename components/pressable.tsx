import { useMemo } from 'react'
import { Pressable as RNPressable, PressableProps } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import * as Haptics from 'expo-haptics'
import { springs } from '../lib/theme'
import { noterKo } from '../lib/perf'

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable)

type Haptikk = 'light' | 'medium' | 'none'

type Props = PressableProps & {
  /** Haptic on press-in. 'light' for rows/buttons, 'medium' for primary CTAs. */
  haptic?: Haptikk
  /** Scale while pressed. 0.97 for full-width rows, 0.95 for small tiles. */
  pressScale?: number
}

function tikk(styrke: Haptikk) {
  if (styrke === 'none') return
  Haptics.impactAsync(
    styrke === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
  ).catch(() => {})
}

/**
 * Standard pressable — every tappable surface in the app uses this so
 * press feedback (spring scale + haptic tick) is identical everywhere.
 *
 * TRYKKET BESVARES FRA UI-TRÅDEN (2026-08-30). `onPressIn` er en JS-tråd-
 * hendelse: ligger JS-tråden og rendrer, ligger trykket i kø, og skaleringen
 * og haptikken kommer begge for sent. Det var tregheten Tormod meldte.
 *
 * Derfor ligger en `Gesture.Manual()` over: den ser berøringen på UI-tråden i
 * samme øyeblikk fingeren treffer, og skalerer der. Manual er valgt med vilje
 * — den aktiveres ALDRI av seg selv, så den kan ikke stjele trykket fra
 * Pressable eller scrollen fra en ScrollView. Den bare lytter.
 *
 * JS-veien (`onPressIn`/`onPressOut`) står igjen som sikkerhetsnett: den setter
 * samme verdier, så om gesten uteblir (web, eldre native) oppfører flaten seg
 * nøyaktig som før. `sattFraUi` sørger for at haptikken ikke fyrer to ganger.
 */
export function Pressable({ haptic = 'light', pressScale = 0.97, onPressIn, onPressOut, style, ...rest }: Props) {
  const scale = useSharedValue(1)
  const sattFraUi = useSharedValue(false)
  const berort = useSharedValue(0)
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  const gest = useMemo(
    () =>
      Gesture.Manual()
        .onTouchesDown(() => {
          'worklet'
          sattFraUi.value = true
          scale.value = withSpring(pressScale, springs.press)
          if (haptic !== 'none') scheduleOnRN(tikk, haptic)
          if (__DEV__) berort.value = Date.now()
        })
        .onTouchesUp(() => {
          'worklet'
          scale.value = withSpring(1, springs.press)
          sattFraUi.value = false
        })
        .onTouchesCancelled(() => {
          'worklet'
          scale.value = withSpring(1, springs.press)
          sattFraUi.value = false
        }),
    [haptic, pressScale, scale, sattFraUi, berort],
  )

  return (
    <GestureDetector gesture={gest}>
      <AnimatedPressable
        {...rest}
        style={[style as object, animatedStyle]}
        onPressIn={e => {
          // Målingen: differansen mellom da UI-tråden så fingeren og nå.
          if (__DEV__ && berort.value) { noterKo(Date.now() - berort.value); berort.value = 0 }
          if (!sattFraUi.value) {
            scale.value = withSpring(pressScale, springs.press)
            tikk(haptic)
          }
          onPressIn?.(e)
        }}
        onPressOut={e => {
          scale.value = withSpring(1, springs.press)
          onPressOut?.(e)
        }}
      />
    </GestureDetector>
  )
}
