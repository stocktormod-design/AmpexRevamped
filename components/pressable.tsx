import { Pressable as RNPressable, PressableProps } from 'react-native'
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'
import { springs } from '../lib/theme'

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable)

type Props = PressableProps & {
  /** Haptic on press-in. 'light' for rows/buttons, 'medium' for primary CTAs. */
  haptic?: 'light' | 'medium' | 'none'
  /** Scale while pressed. 0.97 for full-width rows, 0.95 for small tiles. */
  pressScale?: number
}

/**
 * Standard pressable — every tappable surface in the app uses this so
 * press feedback (spring scale + haptic tick) is identical everywhere.
 */
export function Pressable({ haptic = 'light', pressScale = 0.97, onPressIn, onPressOut, style, ...rest }: Props) {
  const scale = useSharedValue(1)
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  return (
    <AnimatedPressable
      {...rest}
      style={[style as object, animatedStyle]}
      onPressIn={e => {
        scale.value = withSpring(pressScale, springs.press)
        if (haptic !== 'none') {
          Haptics.impactAsync(
            haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
          )
        }
        onPressIn?.(e)
      }}
      onPressOut={e => {
        scale.value = withSpring(1, springs.press)
        onPressOut?.(e)
      }}
    />
  )
}
