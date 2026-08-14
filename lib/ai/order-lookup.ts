import * as FileSystem from 'expo-file-system/legacy'
import { findByOrderNumber } from '../orders'
import { Order } from '../db/models/order'
import { callAiVoice } from './gemini-client'
import { audioSegmentPath, type VoiceDraftSession } from './voice-drafts'

export type OrderLookupOutcome =
  | { kind: 'found'; order: Order; orderNumber: number; spokenReply: string }
  | { kind: 'not_found'; orderNumber: number | null; spokenReply: string }
  | { kind: 'other_intent'; mode: 'project_status' | 'gap_check' | 'unclear' }
  | { kind: 'failed' }

/**
 * Tolker en tale-kommando som «start dokumentasjon på ordre 14113». Selve
 * DB-oppslaget skjer HER, klientsidig mot lokal WatermelonDB (regel 2) — Edge
 * Function tolker kun talen, den ser aldri ordredata.
 *
 * Ingen retry.ts-registrering for denne (i motsetning til gap-check): en
 * tale-kommando er en handling-nå, ikke et utkast å bygge videre på — en stille
 * navigasjonsprompt som dukker opp minutter senere på en helt annen skjerm ville
 * vært forvirrende, ikke nyttig. Feiler kallet, vis bare en feilmelding.
 */
export async function runOrderLookup(draft: VoiceDraftSession): Promise<OrderLookupOutcome> {
  if (draft.audioSegments.length === 0) return { kind: 'failed' }
  try {
    const latestSegment = draft.audioSegments[draft.audioSegments.length - 1]
    const base64 = await FileSystem.readAsStringAsync(audioSegmentPath(draft, latestSegment), { encoding: 'base64' })
    const screen = draft.routeContext.screen

    if (screen === 'ordre') {
      const result = await callAiVoice({ mode: 'order_lookup', routeContext: screen, audio: { base64, mimeType: 'audio/aac' } })
      if (!result.ok) return { kind: 'failed' }
      return resolveOrderLookupResult(result)
    }

    // Ukjent skjerm — klassifiser intensjonen først (samme lydklipp), rut videre.
    const classified = await callAiVoice({ mode: 'classify_intent', routeContext: screen, audio: { base64, mimeType: 'audio/aac' } })
    if (!classified.ok) return { kind: 'failed' }
    if (classified.mode === 'project_status') return { kind: 'other_intent', mode: 'project_status' }
    if (classified.mode === 'gap_check') return { kind: 'other_intent', mode: 'gap_check' }
    if (classified.mode !== 'order_lookup') return { kind: 'other_intent', mode: 'unclear' }

    // Gjenbruk transkripsjonen fra klassifiseringen — ikke send lyden på nytt (kostkontroll).
    const result = await callAiVoice({
      mode: 'order_lookup',
      routeContext: screen,
      text: typeof classified.transcript === 'string' ? classified.transcript : undefined,
    })
    if (!result.ok) return { kind: 'failed' }
    return resolveOrderLookupResult(result)
  } catch {
    return { kind: 'failed' }
  }
}

async function resolveOrderLookupResult(result: { [key: string]: unknown }): Promise<OrderLookupOutcome> {
  const orderNumber = typeof result.orderNumber === 'number' ? result.orderNumber : null
  const confidence = result.confidence
  const spokenReply = typeof result.spokenReply === 'string' ? result.spokenReply : ''

  if (orderNumber === null || confidence === 'low') {
    return { kind: 'not_found', orderNumber, spokenReply: spokenReply || 'Oppfattet ikke ordrenummeret.' }
  }
  const order = await findByOrderNumber(orderNumber)
  if (!order) {
    return { kind: 'not_found', orderNumber, spokenReply: spokenReply || `Fant ikke ordre ${orderNumber}.` }
  }
  return { kind: 'found', order, orderNumber, spokenReply: spokenReply || `Mener du ordre ${orderNumber}?` }
}
