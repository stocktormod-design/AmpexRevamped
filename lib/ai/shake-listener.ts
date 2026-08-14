import { useEffect, useRef } from 'react'
import { AppState, NativeModules, Platform } from 'react-native'
import { Accelerometer, type AccelerometerMeasurement } from 'expo-sensors'
import { useVoiceSession } from './voice-session'
import { reportAccelSample } from './voice-level'

// To MYKE, bevisste rist (dobbel håndleddsvipp) — IKKE ett hardt støt. Starter
// økten DIREKTE (armert-lytting-mellomlaget ble bygget og fjernet 2026-08-12 —
// det feilet på nytt sted i hver runde; en falsk utløsning her koster bare en
// hilsen og ett rist for å legge på).
const SHAKE_THRESHOLD = 1.55 // g-magnitude som teller som én vipp
const SHAKE_RESET_THRESHOLD = 1.15 // må under denne før neste vipp telles
const SHAKE_WINDOW_MS = 700 // begge vippene innen dette vinduet
const SHAKE_PEAKS_REQUIRED = 2
const SHAKE_COOLDOWN_MS = 1200 // lav nok til rist-av → rist-på i naturlig tempo
const SAMPLE_INTERVAL_MS = 20 // 50Hz — vippene varer lenge nok til dette (jf. gammelt aliasing-notat)

/** Global rist-arming av AI-assistenten. Kjører KUN i forgrunn (batterikrav #8). */
export function useShakeListener() {
  const { handleShake } = useVoiceSession()
  const handleRef = useRef(handleShake)
  handleRef.current = handleShake

  const peaksRef = useRef<number[]>([])
  const armedRef = useRef(true)
  const lastTriggerRef = useRef(0)

  // RN's EGEN dev-meny åpnes ved rist i dev-build — to rist-detektorer om samme
  // fysiske rist. (Denne linjen røk under knock-omskrivingen 2026-08-12 og
  // dev-menyen «React tools» begynte å poppe opp igjen — ikke fjern den.)
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'ios') return
    NativeModules.DevSettings?.setIsShakeToShowDevMenuEnabled?.(false)
  }, [])

  useEffect(() => {
    if (Platform.OS === 'web') return

    let subscription: { remove: () => void } | null = null

    const handleSample = (measurement: AccelerometerMeasurement) => {
      const { x, y, z } = measurement
      const magnitude = Math.sqrt(x * x + y * y + z * z)
      const now = Date.now()
      reportAccelSample(y)

      if (magnitude < SHAKE_RESET_THRESHOLD) armedRef.current = true

      if (armedRef.current && magnitude > SHAKE_THRESHOLD) {
        armedRef.current = false
        peaksRef.current = [...peaksRef.current, now].filter(t => now - t < SHAKE_WINDOW_MS)
        if (peaksRef.current.length >= SHAKE_PEAKS_REQUIRED && now - lastTriggerRef.current > SHAKE_COOLDOWN_MS) {
          lastTriggerRef.current = now
          peaksRef.current = []
          console.log('Shake: utløst')
          handleRef.current()
        }
      }
    }

    const startListening = () => {
      Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS)
      subscription = Accelerometer.addListener(handleSample)
    }
    const stopListening = () => {
      subscription?.remove()
      subscription = null
      peaksRef.current = []
      armedRef.current = true
    }

    if (AppState.currentState === 'active') startListening()

    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') startListening()
      else stopListening()
    })

    return () => {
      stopListening()
      appStateSub.remove()
    }
  }, [])
}
