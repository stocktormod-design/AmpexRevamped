import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, Platform } from 'react-native'
import { Accelerometer } from 'expo-sensors'
import { getLatestAccelSample, reportAccelSample } from './voice-level'
import { addProximityListener, isProximityAvailable, setProximityEnabled } from '../../modules/ampex-splat'
import { usePathname, useGlobalSearchParams, router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useAudioRecorderState } from 'expo-audio'
import { speak } from './voice-speaker'
import { hasMicrophonePermission, requestMicrophonePermission, useVoiceRecorder } from './voice-recorder'
import { createDraft, loadDraft, addAudioSegment, clearDraft, type VoiceRouteContext } from './voice-drafts'
import { MindSession } from './mind-session'
import { LiveSession } from './live-session'
import { syncLiveActivity } from './live-activity-control'
import { useHasDynamicIsland } from '../has-dynamic-island'
import { supabase } from '../supabase'
import type { Order } from '../db/models/order'

export type VoiceAssistantStage = 'idle' | 'confirming' | 'recording' | 'checking'

// Pause-deteksjon — krever felttuning på fysisk enhet (samme klasse problem som
// rist-tersklene i shake-listener.ts: site-støy — drill, ventilasjon — påvirker
// dB-nivået). Kostnaden ved en FEILAKTIG utløsning her er lav med vilje: verste
// fall er ett unødvendig "Er det alt?" — ikke en avbrutt opptak, siden brukeren
// bare fortsetter å snakke for å avbryte spørsmålet (se METERING_POLL_MS-loopen).
const SILENCE_THRESHOLD_DB = -35 // under dette regnes som stille
const SILENCE_ASK_MS = 3000 // stille i 3s mens vi tar opp → spør "Er det alt?"
const SILENCE_AUTOSTOP_MS = 2000 // stille i 2s til ETTER spørsmålet → avslutt automatisk
const METERING_POLL_MS = 400

type VoiceSessionValue = {
  stage: VoiceAssistantStage
  /** Starter en økt (rist eller trykk på Ampex-merket) — no-op hvis en økt allerede pågår. */
  beginSession: () => Promise<void>
  /** Avslutter gjeldende økt. discard=true forkaster opptaket (brukt ved rist-avbrytelse). */
  endSession: (opts?: { discard?: boolean }) => Promise<void>
  /** Kalt av rist-deteksjon — bestemmer selv om det skal starte, avbryte bekreftelse, eller forkaste opptak. */
  /** ID-en til siste økt som ble avsluttet MED lagret opptak (ikke forkastet) — skjermer
   *  (f.eks. skjema.tsx) som gjenkjenner sin egen routeContext her kan starte berikelse. */
  lastCompletedSessionId: string | null
  /** Kalles av forbrukeren når den har hentet ut/håndtert lastCompletedSessionId. */
  clearLastCompleted: () => void
  /** Ordre modellen fant via finn_ordre-verktøyet i en Live-økt — UI viser navigasjonsark. */
  liveOrderFound: Order | null
  clearLiveOrderFound: () => void
}

const VoiceSessionContext = createContext<VoiceSessionValue | null>(null)

/**
 * Eneste kilde til AI-assistentens økt-tilstand — mountes én gang i app/_layout.tsx.
 * Inngangene er Ampex-merket (components/ampex-mark-button.tsx) og to-finger-
 * driver samme økt gjennom denne, slik at det aldri finnes to samtidige opptak.
 */
export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const params = useGlobalSearchParams<{ orderId?: string; templateId?: string; id?: string }>()
  const [stage, setStage] = useState<VoiceAssistantStage>('idle')
  const stageRef = useRef<VoiceAssistantStage>('idle')
  stageRef.current = stage
  const sessionIdRef = useRef<string | null>(null)
  const sessionBeganAtRef = useRef(0) // etterslep-vakt mot dobbeltutløsning like etter start
  const [lastCompletedSessionId, setLastCompletedSessionId] = useState<string | null>(null)

  const { recorder, start: startRecording, stop: stopRecordingHook } = useVoiceRecorder()
  const recorderState = useAudioRecorderState(recorder, METERING_POLL_MS)
  const hasDynamicIsland = useHasDynamicIsland()

  // Ekte Dynamic Island KUN på enheter som faktisk har den (14 Pro+) — ellers
  // viser components/voice-assistant-overlay.tsx status i appen i stedet
  // (se app/_layout.tsx). Ingen vits i en Live Activity ingen ser live på en
  // øy-løs enhet (den ville uansett bare dukket opp på låseskjermen).
  useEffect(() => {
    if (hasDynamicIsland) syncLiveActivity(stage)
  }, [stage, hasDynamicIsland])

  const currentRouteContext = useCallback((): VoiceRouteContext => {
    if (pathname.includes('/ordre/skjema') && params.orderId && params.templateId) {
      return { screen: 'skjema', orderId: String(params.orderId), templateId: String(params.templateId) }
    }
    if (pathname.startsWith('/ordre')) return { screen: 'ordre' }
    if (pathname.startsWith('/prosjekter') && params.id) return { screen: 'prosjekt', projectId: String(params.id) }
    return { screen: 'unknown' }
  }, [pathname, params])

  const assistentRef = useRef<MindSession | LiveSession | null>(null)
  const [liveOrderFound, setLiveOrderFound] = useState<Order | null>(null)

  /**
   * Samtale med den turbaserte assistenten (lib/ai/mind-session.ts) — dette er
   * normalveien på mobil. Unntak: skjema-skjermen beholder det gamle
   * opptak→gap_check-løpet (det fyller faktisk ut feltene), og web har ikke
   * native mikrofontilgang. Stage-navnene gjenbrukes så overlay + Live Activity
   * virker uendret: 'confirming' = starter opp, 'recording' = samtale pågår.
   *
   * Erstattet Gemini Live 2026-09-03. Live holdt en WebSocket åpen og fakturerte
   * sesjonen — stillhet, tenketid og sin egen tale til 4x inngangsprisen. Nå
   * sendes ett lydklipp per tur og svaret leses opp lokalt.
   */
  /**
   * Live er tilbake (2026-09-04), men med klient-VAD: mikrofonen strømmer BARE
   * når det er tale, med activityStart/activityEnd rundt. Det som gjorde Live
   * dyr — stillhet og verkstedstøy fakturert som lyd — forlater aldri
   * telefonen. Se live-session.ts for tallene.
   *
   * Dagstak: er det nådd, gir serveren intet token, og vi faller tilbake til
   * den turbaserte assistenten med systemstemmen. Samme verktøy, samme
   * intelligens — bare gratis stemme resten av dagen.
   */
  const startLiveSession = useCallback(async (routeContext: VoiceRouteContext): Promise<void> => {
    setStage('confirming')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const granted = (await hasMicrophonePermission()) || (await requestMicrophonePermission())
    if (!granted) {
      setStage('idle')
      return
    }

    const session = new LiveSession(routeContext, {
      onStage: s => setStage(s === 'connecting' ? 'confirming' : 'recording'),
      onEnd: error => {
        assistentRef.current = null
        setStage('idle')
        if (error) speak(error)
      },
      onCapHit: () => {
        // Ikke en feil for brukeren — bare en annen stemme i dag.
        assistentRef.current = null
        void startMindSession(routeContext)
      },
      onOrderFound: order => setLiveOrderFound(order),
      onOpenForm: (orderId, templateId) => {
        router.push({ pathname: '/(app)/ordre/skjema', params: { orderId, templateId } })
      },
      onNavigate: path => router.push(path as never),
    })
    assistentRef.current = session
    void session.start()
  }, []) // startMindSession refereres via lukking; begge er stabile useCallback uten deps

  const startMindSession = useCallback(async (routeContext: VoiceRouteContext) => {
    setStage('confirming')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const granted = (await hasMicrophonePermission()) || (await requestMicrophonePermission())
    if (!granted) {
      setStage('idle')
      return
    }

    const session = new MindSession(routeContext, {
      onStage: s => setStage(s === 'connecting' ? 'confirming' : 'recording'),
      onEnd: error => {
        assistentRef.current = null
        setStage('idle')
        // Økten er borte, så feilen må leses opp av noen andre enn den.
        if (error) speak(error)
      },
      onOrderFound: order => setLiveOrderFound(order),
      onOpenForm: (orderId, templateId) => {
        // Modellen er ferdig å fylle — mennesket verifiserer/fullfører i skjemaet.
        router.push({ pathname: '/(app)/ordre/skjema', params: { orderId, templateId } })
      },
      // Guide-navigasjon: modellen åpner skjermer direkte (opprettet ordre, vis_ordre).
      onNavigate: path => router.push(path as never),
    })
    assistentRef.current = session
    session.start()
  }, [])

  const beginSession = useCallback(async () => {
    if (stageRef.current !== 'idle') return
    sessionBeganAtRef.current = Date.now()
    // Providern bor i rot-layouten (over auth-splitten), så rist fyrer også på
    // login-skjermen — der finnes verken bruker-JWT (token-kallet ville feilet)
    // eller lokale data det gir mening å spørre om. Stille no-op uten innlogging.
    const { data } = await supabase.auth.getSession()
    if (!data.session) return
    const routeContext = currentRouteContext()
    if (Platform.OS !== 'web' && routeContext.screen !== 'skjema') {
      await startLiveSession(routeContext)
      return
    }
    setStage('confirming')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    // Tillatelse avslått: ikke bli hengende i "confirming" — tilbake til idle,
    // resten av appen (manuell utfylling) er uendret (bulletproof-krav).
    const granted = (await hasMicrophonePermission()) || (await requestMicrophonePermission())
    if (!granted) {
      setStage('idle')
      return
    }

    speak('Ja?', {
      onDone: async () => {
        if (stageRef.current !== 'confirming') return // avbrutt (rist igjen) mens "Ja?" ble lest opp
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await createDraft(id, currentRouteContext())
        sessionIdRef.current = id
        setStage('recording')
        await startRecording()
      },
      onError: () => setStage('idle'),
    })
  }, [currentRouteContext, startRecording, startLiveSession])

  const endSession = useCallback(
    async (opts?: { discard?: boolean }) => {
      if (assistentRef.current) {
        assistentRef.current.stop() // setter stage til idle via onEnd
        return
      }
      if (stageRef.current === 'confirming') {
        setStage('idle') // avbrutt før opptak faktisk startet — ingenting å rydde
        return
      }
      if (stageRef.current !== 'recording' && stageRef.current !== 'checking') return
      const id = sessionIdRef.current
      const uri = await stopRecordingHook()
      setStage('idle')
      sessionIdRef.current = null
      if (!id) return
      if (opts?.discard) {
        await clearDraft(id)
        return
      }
      if (uri) {
        const draft = await loadDraft(id)
        if (draft) await addAudioSegment(draft, uri)
      }
      setLastCompletedSessionId(id)
    },
    [stopRecordingHook],
  )

  const clearLastCompleted = useCallback(() => setLastCompletedSessionId(null), [])
  const clearLiveOrderFound = useCallback(() => setLiveOrderFound(null), [])

  // Øre-privat lyd UNDER en aktiv økt (IKKE aktivering — brukeren ville ikke ha
  // telefonsamtale-gest som inngang): løftes telefonen mot øret mens assistenten
  // alt kjører, flyttes lyden til ørehøyttaleren; senkes den, tilbake til speaker.
  // Positur-port (nær vertikal) hindrer at skjermen slukker ved tilfeldig
  // tildekking av sensoren. Nærhetsovervåkning kun mens økt kjører + forgrunn.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isProximityAvailable) return
    if (stage === 'idle') {
      setProximityEnabled(false)
      return
    }
    let upright = false

    // Posen leses fra vårt EGET aksellerometer-abonnement, som lever bare så
    // lenge økten gjør. Tidligere satt vi på rist-detektorens 50 Hz-strøm, som
    // gikk hele dagen i forgrunnen — det var i strid med batterikravet (regel 8)
    // for en funksjon som brukes noen ganger daglig. Nå: 10 Hz, kun i økt.
    //
    // (Den gamle advarselen om å ALDRI røre setUpdateInterval gjaldt fordi
    // innstillingen er global per sensor og en treg posesjekk halshugget
    // rist-deteksjonen. Med risting borte er vi eneste leser.)
    Accelerometer.setUpdateInterval(100)
    const accelSub = Accelerometer.addListener(({ y }) => reportAccelSample(y))

    const poseTimer = setInterval(() => {
      const sample = getLatestAccelSample()
      if (!sample || Date.now() - sample.at > 2000) return
      const isUpright = sample.y < -0.75
      if (isUpright !== upright) {
        upright = isUpright
        setProximityEnabled(upright && AppState.currentState === 'active')
      }
    }, 250)

    const proxSub = addProximityListener(near => {
      assistentRef.current?.setEarpiece(near)
    })

    const appSub = AppState.addEventListener('change', state => {
      if (state !== 'active') setProximityEnabled(false)
    })

    return () => {
      clearInterval(poseTimer)
      accelSub.remove()
      proxSub.remove()
      appSub.remove()
      setProximityEnabled(false)
    }
  }, [stage])

  // Pause-deteksjon: hybrid mellom helautomatisk og rent manuelt. Ved 3s stillhet
  // spør assistenten høyt "Er det alt?" i stedet for å avslutte stille — fortsetter
  // du å snakke avbrytes spørsmålet av seg selv (bare vanlig opptak igjen). Svarer
  // du ikke (2s til) avsluttes økten automatisk, som om du hadde trykket Stopp.
  const silenceSinceRef = useRef<number | null>(null)
  const askedAtRef = useRef<number | null>(null)

  useEffect(() => {
    // KUN det gamle opptaksløpet (skjema-skjermen): en Live-økt bruker sin egen
    // mikrofon, og expo-opptakerens metering er da støy/utdatert — uten denne
    // vakten kunne stillhetsdeteksjonen HENRETTE live-økter etter ~5 s («hun
    // stopper av seg selv», «rist virker aldri to ganger»), helt uten logglinjer.
    if (assistentRef.current) return
    if (stage !== 'recording' && stage !== 'checking') {
      silenceSinceRef.current = null
      askedAtRef.current = null
      return
    }
    const metering = recorderState.metering
    if (metering === undefined) return
    const now = Date.now()
    const isSilent = metering < SILENCE_THRESHOLD_DB

    if (!isSilent) {
      // Snakker igjen — nullstiller alt, inkludert et evt. "Er det alt?"-spørsmål.
      silenceSinceRef.current = null
      if (stage === 'checking') {
        askedAtRef.current = null
        setStage('recording')
      }
      return
    }

    if (silenceSinceRef.current === null) {
      silenceSinceRef.current = now
      return
    }

    if (stage === 'recording' && now - silenceSinceRef.current >= SILENCE_ASK_MS) {
      askedAtRef.current = now
      setStage('checking')
      speak('Er det alt?')
      return
    }

    if (stage === 'checking' && askedAtRef.current !== null && now - askedAtRef.current >= SILENCE_AUTOSTOP_MS) {
      endSession()
    }
  }, [stage, recorderState.metering, endSession])

  return (
    <VoiceSessionContext.Provider
      value={{ stage, beginSession, endSession, lastCompletedSessionId, clearLastCompleted, liveOrderFound, clearLiveOrderFound }}
    >
      {children}
    </VoiceSessionContext.Provider>
  )
}

export function useVoiceSession(): VoiceSessionValue {
  const ctx = useContext(VoiceSessionContext)
  if (!ctx) throw new Error('useVoiceSession må brukes innenfor VoiceSessionProvider')
  return ctx
}
