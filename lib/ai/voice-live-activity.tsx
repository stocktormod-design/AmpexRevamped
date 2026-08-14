import { Image, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets'

export type VoiceLiveActivityProps = {
  /** Kort form for compact/minimal Dynamic Island — lite plass der. */
  compactLabel: string
  /** Full setning for utvidet visning og låseskjerm. */
  fullLabel: string
}

const VoiceAssistantActivity = (props: VoiceLiveActivityProps, environment: LiveActivityEnvironment) => {
  'widget'
  // 'widget'-funksjoner kompileres til en fristående streng og kjøres i en isolert
  // JS-runtime i widget-extensionen (se WidgetsJSRuntime.swift i expo-widgets) —
  // INGEN tilgang til denne filens modul-scope. Fargene MÅ derfor være literaler
  // her, ikke importert/referert fra en konstant utenfor funksjonen (Ampex-kobber:
  // #A97C4F, lysere #D9B48F på mørk bakgrunn — Dynamic Island er alltid mørk).
  const accent = environment.colorScheme === 'dark' ? '#D9B48F' : '#A97C4F'

  return {
    banner: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <Image systemName="mic.fill" color={accent} />
        <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(accent)]}>{props.fullLabel}</Text>
      </VStack>
    ),
    compactLeading: <Image systemName="mic.fill" color={accent} />,
    compactTrailing: <Text>{props.compactLabel}</Text>,
    minimal: <Image systemName="mic.fill" color={accent} />,
    expandedLeading: <Image systemName="mic.fill" color={accent} />,
    expandedTrailing: <Text modifiers={[font({ weight: 'bold' })]}>{props.compactLabel}</Text>,
    expandedBottom: (
      <VStack modifiers={[padding({ all: 8 })]}>
        <Text modifiers={[font({ size: 12 })]}>{props.fullLabel}</Text>
      </VStack>
    ),
  }
}

export default createLiveActivity('VoiceAssistantActivity', VoiceAssistantActivity)
