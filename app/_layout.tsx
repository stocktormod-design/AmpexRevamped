import '../global.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { supabase } from '../lib/supabase'
import { syncQuietly } from '../lib/db/sync'
import { enforceCompanyBoundary } from '../lib/db/company-guard'
import { seedAktiviteter } from '../lib/activities'
import { retryPendingAiEnrichment, registerDraftHandler } from '../lib/ai/retry'
import { useVoiceSession, VoiceSessionProvider } from '../lib/ai/voice-session'
import { VoiceAssistantOverlay } from '../components/voice-assistant-overlay'
import { VoiceCommandSheet } from '../components/voice-command-sheet'
import { loadDraft, clearDraft } from '../lib/ai/voice-drafts'
import { runGapCheck } from '../lib/forms/gap-check'
import { runOrderLookup, type OrderLookupOutcome } from '../lib/ai/order-lookup'
import { findByOrderNumber } from '../lib/orders'
import { useHasDynamicIsland } from '../lib/has-dynamic-island'

// Fase 1: skjema-drafts berikes via gap-check, både rett etter opptak (skjema.tsx)
// og her ved neste synk-trigger hvis det ikke skjedde da (retry.ts-registeret).
registerDraftHandler('skjema', runGapCheck)

// Rist-lytteren trenger VoiceSessionProvider-konteksten, så den mountes i et eget
// barn under providern (kan ikke ligge i RootLayout selv, som er over providern).
// Håndterer også ordre-oppslag ved tale (Fase 2) — global, siden kommandoen skal
// virke uansett hvilken skjerm brukeren er på, ikke bare ordre-skjermene.
// Aktiveringshistorikk (alle forkastet): rist (utløstes av å reise seg — fjernet
// helt 2026-08-20), iOS Back
// Tap (manuelt oppsett per telefon), dobbeltbank på kroppen (akselerometeret ser
// ikke 10ms-transienter — hardware-lavpassfiltrert), løft-til-øret (føltes som
// telefonsamtale). Landet på: TO FINGRE, DOBBELTTRYKK hvor som helst på skjermen —
// usynlig, null oppsett, blokkerer ikke vanlige trykk/scroll. + mic-knapp og
// ampex://assistant-deep-link som alternativer.
function AssistantGesture({ children }: { children: React.ReactNode }) {
  const { stage, beginSession, endSession } = useVoiceSession()
  const stageRef = useRef(stage)
  stageRef.current = stage

  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .minPointers(2)
        .maxDuration(350)
        .runOnJS(true)
        .onEnd((_e, success) => {
          if (!success) return
          if (stageRef.current === 'idle') beginSession()
          else endSession()
        }),
    [beginSession, endSession],
  )

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ flex: 1 }} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  )
}

function VoiceAssistant() {
  // Inngangene til assistenten er Ampex-merket (components/ampex-mark-button.tsx)
  // og to-finger-dobbelttrykk (AssistantGesture over). Rist ble fjernet
  // 2026-08-20: den utløste seg selv når man reiste seg, og et 50 Hz
  // aksellerometer i forgrunnen hele dagen for ti aktiveringer er i strid med
  // batterikravet (regel 8). Aksellerometeret leses nå kun mens en økt varer,
  // til ørepositur-sjekken.
  const { lastCompletedSessionId, clearLastCompleted, liveOrderFound, clearLiveOrderFound } = useVoiceSession()
  const [commandOutcome, setCommandOutcome] = useState<OrderLookupOutcome | null>(null)
  const hasDynamicIsland = useHasDynamicIsland()

  // Live-økt fant en ordre via finn_ordre-verktøyet: samme navigasjonsark som det
  // gamle løpet, men med tom spokenReply — modellen har allerede svart muntlig selv.
  useEffect(() => {
    if (!liveOrderFound) return
    clearLiveOrderFound()
    setCommandOutcome({
      kind: 'found',
      order: liveOrderFound,
      orderNumber: liveOrderFound.orderNumber ?? 0,
      spokenReply: '',
    })
  }, [liveOrderFound, clearLiveOrderFound])

  useEffect(() => {
    if (!lastCompletedSessionId) return
    const sessionId = lastCompletedSessionId
    let mounted = true
    ;(async () => {
      const draft = await loadDraft(sessionId)
      // 'skjema' håndteres av skjema.tsx selv (matcher orderId/templateId der) — ikke vårt bord.
      if (!draft || draft.routeContext.screen === 'skjema') return
      clearLastCompleted()
      const outcome = await runOrderLookup(draft)
      if (!mounted) return
      // Draften trengs ikke lenger uansett utfall — ordre-oppslag lagrer ingen draft-tilstand
      // for senere (se lib/ai/order-lookup.ts sin kommentar om hvorfor ingen retry her).
      await clearDraft(sessionId)
      setCommandOutcome(outcome)
    })()
    return () => { mounted = false }
  }, [lastCompletedSessionId, clearLastCompleted])

  return (
    <>
      {/* Ekte Dynamic Island (14 Pro+, se lib/has-dynamic-island.ts) viser status der i stedet —
          den flaten sitter allerede øverst uansett om appen er i forgrunn, ingen egen visning
          trengs da. Alle andre enheter (Android + eldre iPhone uten øy) får overlayen her —
          Live Activity på en øy-løs iPhone vises kun på låseskjerm, ikke i forgrunn, så uten
          dette ville brukeren ikke sett noe mens appen er åpen. */}
      {!hasDynamicIsland && <VoiceAssistantOverlay />}
      {commandOutcome && (
        <VoiceCommandSheet
          outcome={commandOutcome}
          onClose={() => setCommandOutcome(null)}
          onConfirm={() => {
            if (commandOutcome.kind === 'found') router.push(`/(app)/ordre/${commandOutcome.order.id}`)
            setCommandOutcome(null)
          }}
          onManualLookup={async n => {
            const order = await findByOrderNumber(n)
            setCommandOutcome(
              order
                ? { kind: 'found', order, orderNumber: n, spokenReply: `Fant ordre ${n}.` }
                : { kind: 'not_found', orderNumber: n, spokenReply: `Fant ikke ordre ${n}.` },
            )
          }}
        />
      )}
    </>
  )
}

export default function RootLayout() {
  useEffect(() => {
    // Firma-grensen sjekkes FØR synk: hvis et annet firma har eid den lokale
    // databasen skal den nullstilles før nye data skrives inn i den.
    const syncAfterBoundaryCheck = () => {
      enforceCompanyBoundary().then(() => {
        syncQuietly()
        retryPendingAiEnrichment()
        // Timeføring uten aktivitet får ingen pris. Seedingen er idempotent og
        // kjører bare når tabellen er tom, så den kan stå her uten kostnad.
        seedAktiviteter()
      })
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/(auth)/login')
      } else {
        router.replace('/(app)')
        syncAfterBoundaryCheck()
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/(auth)/login')
      } else {
        router.replace('/(app)')
        syncAfterBoundaryCheck()
      }
    })

    // Usynlig synk (og AI-retry) når appen kommer til forgrunn (aldri polling — batterikrav #8)
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') return
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) syncAfterBoundaryCheck()
      })
    })

    return () => {
      subscription.unsubscribe()
      appState.remove()
    }
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <VoiceSessionProvider>
          <AssistantGesture>
            <Stack screenOptions={{ headerShown: false }} />
            <VoiceAssistant />
          </AssistantGesture>
        </VoiceSessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
