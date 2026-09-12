import { supabase } from '../supabase'
import { aiLogg } from './ai-logg'

export type AiVoiceMode =
  | 'gap_check'
  | 'order_lookup'
  | 'project_status'
  | 'classify_intent'
  | 'live_token'
  | 'voice_usage'
  | 'form_import'
  | 'mind'

export type AiVoiceRequest = {
  mode: AiVoiceMode
  /** voice_usage: forbruk denne økten (bruker/firma utledes av JWT på serveren). */
  forbruk?: { speech_sec: number; in_tok: number; out_tok: number }
  routeContext: string
  audio?: { base64: string; mimeType: string }
  text?: string
  context?: unknown
  /** live_token: be om et token UTEN lås, etter at en låst økt ble avvist ved setup. */
  ulaast?: boolean
  /** form_import: PDF eller bilde av firmaets eget skjema. */
  dokument?: { base64: string; mimeType: string }
  /** mind: systeminstruks og verktøyskjema bygges på klienten (se lib/ai/mind.ts). */
  systemInstruction?: string
  tools?: unknown[]
  historikk?: Record<string, unknown>[]
}

/** Ett verktøykall modellen ba om. Navnet matcher TOOL_DECLARATIONS på klienten. */
export type Funksjonskall = { navn: string; argumenter: Record<string, unknown> }

export type MindSvar = {
  funksjonskall: Funksjonskall[]
  /** Fri tekst når modellen svarer i stedet for å kalle et verktøy. Ofte null. */
  tekst: string | null
  /** Modellens egne svar-deler, UENDRET. Må sendes tilbake som neste turs historikk. */
  modellDeler: Record<string, unknown>[]
  avslutning: string | null
  bruk: { inn: number; cachet: number; ut: number; totalt: number }
  modell: string
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
// Én samtaletur. Må ligge OVER GEMINI_MIND_TIMEOUT_MS (12s) i edge-funksjonen, så
// serveren rekker å gi opp med en lesbar feil før klienten kutter blindt. Er vi
// først her, har brukeren uansett ventet så lenge at turen er tapt.
const CLIENT_MIND_TIMEOUT_MS = 15_000

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
/** Dagstaket er nådd: ingen Live-økt i dag, men assistenten virker fortsatt (turbasert + systemstemme). */
export type VoiceCap = { tier: string; capSec: number | null; usedSec: number }

export type LiveTokenResult =
  | { token: string; model: string; voice: string | null; laast: boolean }
  | { cap: VoiceCap }
  | null

export async function fetchLiveToken(opts?: { ulaast?: boolean }): Promise<LiveTokenResult> {
  const result = await callAiVoice({ mode: 'live_token', routeContext: 'live', ulaast: opts?.ulaast })
  // Taket er ikke en feil — det er et svar. Skilles ut FØR null-veien så
  // kalleren kan falle tilbake i stedet for å melde «fikk ikke koblet til».
  if (!result.ok && (result as { reason?: string }).reason === 'cap') {
    const r = result as { tier?: string; cap_sec?: number | null; used_sec?: number }
    return { cap: { tier: r.tier ?? 'standard', capSec: r.cap_sec ?? null, usedSec: r.used_sec ?? 0 } }
  }
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

/**
 * Rapporterer én Live-økts forbruk. Fyr-og-glem: en tapt rapport koster oss
 * noen sekunder under taket, aldri en låst bruker. Aldri await i finish().
 */
export function reportVoiceUsage(f: { speechSec: number; inTok: number; outTok: number }): void {
  void callAiVoice({
    mode: 'voice_usage',
    routeContext: 'live',
    forbruk: { speech_sec: f.speechSec, in_tok: f.inTok, out_tok: f.outTok },
  }).catch(e => aiLogg('Live: forbruksrapport feilet:', e))
}

/**
 * Én turbasert assistenttur mot Gemini: lydklipp inn, verktøykall ut.
 *
 * `avbryt` er ikke pynt — den er forutsetningen for spekulativ utsending. Vi fyrer
 * av kallet så snart det er en TROLIG pause, ikke når vi er sikre, og kansellerer
 * hvis brukeren fortsetter å snakke. Et kastet kall koster brøkdelen av et øre;
 * de 300-500 ms det kjøper, koster ikke noe i det hele tatt.
 */
export async function askMind(args: {
  routeContext: string
  systemInstruction: string
  tools: unknown[]
  audio?: { base64: string; mimeType: string }
  text?: string
  historikk?: Record<string, unknown>[]
  avbryt?: AbortSignal
}): Promise<{ ok: true; svar: MindSvar } | AiVoiceFailure> {
  const result = await callAiVoice(
    {
      mode: 'mind',
      routeContext: args.routeContext,
      systemInstruction: args.systemInstruction,
      tools: args.tools,
      audio: args.audio,
      text: args.text,
      historikk: args.historikk,
    },
    args.avbryt,
  )

  if (!result.ok) return result
  if (!Array.isArray(result.funksjonskall)) {
    return { ok: false, reason: 'server_error', detail: 'mind-svar uten funksjonskall-liste' }
  }

  return {
    ok: true,
    svar: {
      funksjonskall: result.funksjonskall as Funksjonskall[],
      tekst: typeof result.tekst === 'string' ? result.tekst : null,
      modellDeler: Array.isArray(result.modellDeler) ? (result.modellDeler as Record<string, unknown>[]) : [],
      avslutning: typeof result.avslutning === 'string' ? result.avslutning : null,
      bruk: (result.bruk as MindSvar['bruk']) ?? { inn: 0, cachet: 0, ut: 0, totalt: 0 },
      modell: typeof result.modell === 'string' ? result.modell : 'ukjent',
    },
  }
}

export async function callAiVoice(request: AiVoiceRequest, avbryt?: AbortSignal): Promise<AiVoiceResult> {
  const controller = new AbortController()
  // Ekstern avbrytelse (spekulativ utsending, barge-in) kobles på den interne
  // kontrolleren, så timeout og avbrytelse deler én sti ut.
  if (avbryt?.aborted) return { ok: false, reason: 'timeout', detail: 'avbrutt før start' }
  const videresendAvbrudd = () => controller.abort()
  avbryt?.addEventListener('abort', videresendAvbrudd)
  const timeout = setTimeout(
    () => controller.abort(),
    request.mode === 'form_import'
      ? CLIENT_IMPORT_TIMEOUT_MS
      : request.mode === 'mind'
        ? CLIENT_MIND_TIMEOUT_MS
        : CLIENT_TIMEOUT_MS,
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
    avbryt?.removeEventListener('abort', videresendAvbrudd)
  }
}
