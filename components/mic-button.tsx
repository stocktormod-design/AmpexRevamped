import { View } from 'react-native'
import { Mic } from 'lucide-react-native'
import { Pressable } from './pressable'
import { useVoiceSession } from '../lib/ai/voice-session'
import { colors, sizes } from '../lib/theme'

/**
 * Manuell inngang til AI-assistenten — reserve for de som foretrekker å trykke,
 * eller når rist-deteksjon er upraktisk/avslått. Skjules automatisk mens en økt
 * allerede pågår (VoiceAssistantOverlay tar over da).
 */
export function MicButton() {
  const { stage, beginSession } = useVoiceSession()
  if (stage !== 'idle') return null

  return (
    <Pressable
      haptic="medium"
      pressScale={0.92}
      onPress={beginSession}
      accessibilityLabel="Start med AI"
      style={{
        width: sizes.iconChip,
        height: sizes.iconChip,
        borderRadius: sizes.iconChip / 2,
        backgroundColor: colors.brandWash,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View>
        <Mic size={sizes.icon} color={colors.brand} strokeWidth={sizes.lucideStroke} />
      </View>
    </Pressable>
  )
}
