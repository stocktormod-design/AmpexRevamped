import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing,
} from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'
import { Pressable } from './pressable'
import { AmpexLogo } from './ampex-logo'
import { useVoiceSession } from '../lib/ai/voice-session'
import { colors, sizes } from '../lib/theme'

const RING = sizes.iconChip * 2.6 // ytterste lyn-ring ved full utladning

/**
 * Merket ER assistenten. Lyn-A-en fra AmpexLogo er inngangen til AI-økten, og
 * ved trykk slår to lyn-ringer utover før overlayet tar over.
 *
 * Hvorfor merket og ikke et mikrofonikon: en generisk `Mic` sier «tale», mens
 * lynet sier Ampex. Og logoen lå der allerede uten jobb — dette koster null nye
 * piksler, som var kravet.
 *
 * HVILE ER STILLE (regel 8). Overlayet har roterende buer og en ring som puster
 * med mikrofonnivået, men det lever kun mens økten varer. Denne knappen står på
 * fire skjermer hele dagen, så en evig rotasjon her ville vært kontinuerlig
 * UI-arbeid uten informasjonsverdi. Ringene finnes bare i overgangen — de er
 * utladningen som blir til orben.
 */
/**
 * `tone="light"` for bruk mot mørk bakgrunn (ordrehodet). Brunt på brunt
 * forsvinner — merket må være synlig for å kunne trykkes på.
 */
export function AmpexMarkButton({ tone = 'default' }: { tone?: 'default' | 'light' } = {}) {
  const { stage, beginSession } = useVoiceSession()
  const paaMorkt = tone === 'light'

  // 0 = i ro, 1 = full utladning. Driver begge ringene med hver sin forsinkelse.
  const burst = useSharedValue(0)
  const press = useSharedValue(1)

  // Økten kan avsluttes fra overlayet eller to-finger-gesten — nullstill da, så
  // neste trykk starter fra ro i stedet for midt i forrige animasjon.
  useEffect(() => {
    if (stage === 'idle') burst.value = 0
  }, [stage, burst])

  function fyrAv() {
    burst.value = 0
    burst.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) })
    press.value = withSequence(
      withTiming(0.9, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 260, easing: Easing.elastic(1.4) }),
    )
    beginSession()
  }

  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }))

  const ringIndre = useAnimatedStyle(() => ({
    opacity: (1 - burst.value) * 0.9,
    transform: [{ scale: 0.5 + burst.value * 1.1 }],
  }))

  const ringYtre = useAnimatedStyle(() => ({
    opacity: (1 - burst.value) * 0.55,
    transform: [{ scale: 0.5 + burst.value * 1.7 }],
  }))

  // Overlayet overtar den visuelle jobben så snart økten er i gang.
  if (stage !== 'idle') return null

  return (
    <Pressable
      haptic="medium"
      pressScale={1} // egen press-animasjon under, ikke Pressable sin
      onPress={fyrAv}
      accessibilityLabel="Start med AI"
      style={{
        width: sizes.iconChip, height: sizes.iconChip, borderRadius: sizes.iconChip / 2,
        backgroundColor: paaMorkt ? 'rgba(255,255,255,0.14)' : colors.brandWash,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Ringene ligger utenfor knappen og må ikke ta trykk. */}
      <View pointerEvents="none" style={{
        position: 'absolute', width: RING, height: RING, alignItems: 'center', justifyContent: 'center',
      }}>
        <Animated.View style={[{ position: 'absolute' }, ringIndre]}>
          <Lynring size={RING} dash={9} />
        </Animated.View>
        <Animated.View style={[{ position: 'absolute' }, ringYtre]}>
          <Lynring size={RING} dash={4} />
        </Animated.View>
      </View>

      <Animated.View style={markStyle}>
        <AmpexLogo size={sizes.icon} color={paaMorkt ? colors.brandSoft : colors.brand} />
      </Animated.View>
    </Pressable>
  )
}

/** Stiplet ring — samme «elektriske» språk som buene i voice-assistant-overlay. */
function Lynring({ size, dash }: { size: number; dash: number }) {
  const r = size / 2 - 1
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={colors.brand} strokeWidth={1.5} fill="none"
        strokeDasharray={`${dash} ${dash * 1.6}`} strokeLinecap="round"
      />
    </Svg>
  )
}
