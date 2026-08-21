import { supabase } from '../supabase'

export type AiVoiceMode = 'gap_check' | 'order_lookup' | 'project_status' | 'classify_intent' | 'live_token' | 'form_import'

export type AiVoiceRequest = {
  mode: AiVoiceMode
  routeContext: string
  audio?: { base64: string; mimeType: string }
  text?: string
  context?: unknown
  /** live_token: be om et token UTEN lås, etter at en låst økt ble avvist ved setup. */
  ulaast?: boolean
  /** form_import: PDF eller bilde av firmaets eget skjema. */
  dokument?: { base64: string; mimeType: string }
}

export type AiVoiceOkResult = { ok: true; [key: string]: unknown }
export type AiVoiceFailure = { ok: false; reason: 'network' | 'timeout' | 'server_error'; detail?: string }
export type AiVoiceResult = AiVoiceOkResult | AiVoiceFailure

const CLIENT_TIMEOUT_MS = 25_000
// Skjemaimport leser et helt dokument, ikke en talesetning. Må ligge OVER
// GEMINI_IMPORT_TIMEOUT_MS i edge-funksjonen — ellers gir klienten opp mens
// serveren fortsatt jobber, og brukeren får «tidsavbrudd» på et kall som var
// i ferd med å lykkes.
const CLIENT_IMPORT_TIMEOUT_MS = 125_000

/**
 * Eneste sted som kaller ai-voice Edge Function. Løser ALLTID — kaster aldri forbi
 * denne grensen. Alle kallere (gap-check, ordre-oppslag, prosjektstatus) behandler
 * "ok: false" identisk: fall tilbake til deterministisk sti (se lib/forms/gap-check.ts
 * for skjema-utfylling, og de tilsvarende fallbackene i Fase 2/3).
 */
/**
 * Henter engangs-token for Gemini Live (se supabase/functions/ai-voice, mode
 * 'live_token'). Tokenet er kortlevd og må brukes umiddelbart til å åpne
 * WebSocket-økten (lib/ai/live-session.ts).
 */
export async function fetchLiveToken(opts?: { ulaast?: boolean }): Promise<
  { token: string; model: string; voice: string | null; laast: boolean } | null
> {
  const result = await callAiVoice({ mode: 'live_token', routeContext: 'live', ulaast: opts?.ulaast })
  if (!result.ok || typeof result.token !== 'string' || typeof result.model !== 'string') return null
  return {
    token: result.token,
    model: result.model,
    voice: typeof result.voice === 'string' ? result.voice : null,
    // Om tokenet FAKTISK ble låst til modell + lydmodus (liveConnectConstraints).
    // Serveren kan ha falt tilbake til ulåst på egen hånd, så dette er et svar,
    // ikke en antakelse. Styrer siste forsøk i oppkoblingsstigen.
    laast: result.laast !== false,
  }
}

export async function callAiVoice(request: AiVoiceRequest): Promise<AiVoiceResult> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    request.mode === 'form_import' ? CLIENT_IMPORT_TIMEOUT_MS : CLIENT_TIMEOUT_MS,
  )

  try {
    const { data, error } = await supabase.functions.invoke('ai-voice', {
      body: request,
      signal: controller.signal,
    })

    if (error) {
      return { ok: false, reason: 'server_error', detail: error.message }
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'server_error', detail: 'tomt svar' }
    }
    if (data.ok !== true) {
      return { ok: false, reason: 'server_error', detail: typeof data.error === 'string' ? data.error : undefined }
    }
    return data as AiVoiceOkResult
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return { ok: false, reason: isAbort ? 'timeout' : 'network', detail: err instanceof Error ? err.message : undefined }
  } finally {
    clearTimeout(timeout)
  }
}
