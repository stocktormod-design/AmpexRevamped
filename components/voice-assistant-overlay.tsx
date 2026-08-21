import { useEffect } from 'react'
import { View } from 'react-native'
import { Text } from './text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  interpolateColor,
  Easing,
} from 'react-native-reanimated'
import { Zap } from 'lucide-react-native'
import { Pressable } from './pressable'
import { useVoiceSession } from '../lib/ai/voice-session'
import { subscribeVoiceLevel } from '../lib/ai/voice-level'
import { colors, spacing, shadows, type as t } from '../lib/theme'

const ORB = 68 // kjernediameter
const RING_MAX_SCALE = 1.9 // ytterring ved fullt mikrofonnivå
const ARC = ORB * 1.5 // diameter på lyn-buene som sirkler orben

/**
 * «Elektrisk» orb for AI-assistenten: lyn-ikon i kjernen, og lyn-buer (stiplede
 * ringsegmenter) som sirkler rundt — rolige mens hun lytter, raske og lysende
 * når hun snakker. Ytterringen puster med mikrofonnivået (direkte fra
 * lib/ai/voice-level.ts-emitteren, utenom React-state). Trykk = legg på.
 * Brukes av både Live-samtalen og det gamle opptaksløpet på skjema-skjermen.
 */
export function VoiceAssistantOverlay() {
  const insets = useSafeAreaInsets()
  const { stage, endSession } = useVoiceSession()

  const level = useSharedValue(0)
  const speaking = useSharedValue(0)
  const breathe = useSharedValue(1)
  const spin = useSharedValue(0)
  const spinFast = useSharedValue(0)

  useEffect(() => {
    const unsubscribe = subscribeVoiceLevel(e => {
      // rms ~0..0.5 for tale — løft og klipp til 0..1 for animasjonen
      level.value = withTiming(Math.min(1, e.level * 4), { duration: 90 })
      speaking.value = withTiming(e.modelSpeaking ? 1 : 0, { duration: 250 })
    })
    return unsubscribe
  }, [level, speaking])

  // Rolig pust + kontinuerlig rotasjon — orben er alltid levende, aldri statisk.
  useEffect(() => {
    breathe.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    )
    // To buer i motfase: én rolig (alltid), én rask som kun lyser når hun snakker.
    spin.value = withRepeat(withTiming(360, { duration: 6000, easing: Easing.linear }), -1, false)
    spinFast.value = withRepeat(withTiming(-360, { duration: 1400, easing: Easing.linear }), -1, false)
  }, [breathe, spin, spinFast])

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breathe.value * (1 + level.value * (RING_MAX_SCALE - 1)) }],
    opacity: 0.24 + level.value * 0.4,
    backgroundColor: interpolateColor(speaking.value, [0, 1], ['rgba(90,140,255,0.30)', 'rgba(255,214,90,0.35)']),
  }))
  const coreStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(speaking.value, [0, 1], ['#3D6BFF', colors.brand]),
  }))
  // Lyn-buene: rolig blå bue mens hun lytter; når hun snakker tennes den raske,
  // gull-hvite buen i motsatt retning — «strøm rundt lynet».
  const slowArcStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
    opacity: 0.5 + level.value * 0.3,
  }))
  const fastArcStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinFast.value}deg` }],
    opacity: speaking.value * (0.65 + level.value * 0.35),
  }))

  // ALDRI unmount: gjentatt mount/unmount med entering/exiting-animasjoner ga en
  // usynlig orb fra og med andre visning (kjent Reanimated-felle — arming nr. 2
  // kjørte i loggen, men UI-et dukket aldri opp). Synlighet styres i stedet av en
  // shared value på en permanent montert node.
  const visible = useSharedValue(stage === 'idle' ? 0 : 1)
  useEffect(() => {
    visible.value = withTiming(stage === 'idle' ? 0 : 1, { duration: 220 })
  }, [stage, visible])
  const containerStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: (1 - visible.value) * 24 }],
  }))

  const caption =
    stage === 'confirming' ? 'Kobler til …' : stage === 'checking' ? 'Er det alt?' : null

  return (
    <Animated.View
      pointerEvents={stage === 'idle' ? 'none' : 'box-none'}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: insets.bottom + spacing.xxl,
          alignItems: 'center',
        },
        containerStyle,
      ]}
    >
      {caption && (
        <View style={{ marginBottom: spacing.sm, backgroundColor: 'rgba(20,20,22,0.75)', borderRadius: 14, paddingHorizontal: spacing.md, paddingVertical: 5 }}>
          <Text style={[t.footnote, { color: '#fff', fontWeight: '600' }]}>{caption}</Text>
        </View>
      )}
      <Pressable haptic="medium" pressScale={0.92} onPress={() => endSession({ discard: false })}>
        <View style={{ width: ORB * RING_MAX_SCALE, height: ORB * RING_MAX_SCALE, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View
            style={[{ position: 'absolute', width: ORB, height: ORB, borderRadius: ORB / 2 }, ringStyle]}
          />
          {/* Lyn-buer: stiplede ringsegmenter som sirkler orben */}
          <Animated.View style={[{ position: 'absolute', width: ARC, height: ARC }, slowArcStyle]}>
            <Svg width={ARC} height={ARC}>
              <Circle
                cx={ARC / 2} cy={ARC / 2} r={ARC / 2 - 3}
                stroke="rgba(120,170,255,0.9)" strokeWidth={2.5} fill="none"
                strokeDasharray={`${ARC * 0.5} ${ARC * 1.2}`} strokeLinecap="round"
              />
            </Svg>
          </Animated.View>
          <Animated.View style={[{ position: 'absolute', width: ARC, height: ARC }, fastArcStyle]}>
            <Svg width={ARC} height={ARC}>
              <Circle
                cx={ARC / 2} cy={ARC / 2} r={ARC / 2 - 3}
                stroke="rgba(255,226,130,0.95)" strokeWidth={3} fill="none"
                strokeDasharray={`${ARC * 0.28} ${ARC * 0.55}`} strokeLinecap="round"
              />
            </Svg>
          </Animated.View>
          <Animated.View
            style={[
              { width: ORB, height: ORB, borderRadius: ORB / 2, alignItems: 'center', justifyContent: 'center' },
              shadows.floating,
              coreStyle,
            ]}
          >
            <Zap size={28} color="#fff" strokeWidth={2.2} fill="#fff" />
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  )
}
