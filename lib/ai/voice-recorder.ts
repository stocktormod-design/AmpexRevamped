import { useCallback } from 'react'
import {
  useAudioRecorder as useExpoAudioRecorder,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
  setAudioModeAsync,
  IOSOutputFormat,
  AudioQuality,
  type RecordingOptions,
  type RecordingStatus,
} from 'expo-audio'

// Mono, moderat bitrate — nok for tale, holder opplastingsstørrelsen nede
// (kostkontroll: mindre lyd per Gemini-kall). Ikke bruk RecordingPresets.HIGH_QUALITY
// (stereo, 128kbps) — unødvendig stort for et enkelt talespor.
export const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true, // for pause-deteksjon (se lib/ai/voice-session.tsx) — dB-nivå per polling
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
}

export async function hasMicrophonePermission(): Promise<boolean> {
  const { granted } = await getRecordingPermissionsAsync()
  return granted
}

export async function requestMicrophonePermission(): Promise<boolean> {
  const { granted } = await requestRecordingPermissionsAsync()
  return granted
}

/**
 * Tynn wrapper rundt expo-audios useAudioRecorder. Eksplisitt start/stopp kun —
 * ingen bakgrunnsopptak, ingen kontinuerlig lytting (batteri-regel #8).
 */
export function useVoiceRecorder(onStatus?: (status: RecordingStatus) => void) {
  const recorder = useExpoAudioRecorder(VOICE_RECORDING_OPTIONS, onStatus)

  const start = useCallback(async () => {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
  }, [recorder])

  /** Stopper opptak og returnerer den midlertidige fil-URIen (eller null hvis ingenting ble tatt opp). */
  const stop = useCallback(async (): Promise<string | null> => {
    await recorder.stop()
    return recorder.uri
  }, [recorder])

  return { recorder, start, stop }
}
