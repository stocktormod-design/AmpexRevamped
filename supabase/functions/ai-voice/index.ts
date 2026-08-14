// AI-stemmeassistent — én funksjon, rutet på `mode`. Autentisering/CORS/klient-
// oppsett håndteres av @supabase/server sin withSupabase({auth:'user'}) — se
// node_modules/@supabase/server/docs (eller npm pack @supabase/server) for detaljer
// hvis dette må endres. Funksjonen er ellers en TYNN Gemini-proxy: den lagrer
// ingenting og spør ikke andre tabeller selv — all kontekst (ordre, mal, tidligere
// dokumenter) sendes allerede sammensatt fra klienten (som har det lokalt via
// WatermelonDB, regel 2 — skjermer leser kun lokal SQLite).
//
// Nøkkel: firmaets egen (Supabase Vault, se resolveGeminiApiKey) hvis satt, ellers
// Ampex' delte GEMINI_API_KEY. BEGGE MÅ være betalt-tier — gratis-tier tillater at
// Google trener på input, uakseptabelt for HMS-/compliance-lyd. Sett den delte med:
//   supabase secrets set GEMINI_API_KEY=...
// Sett en firmanøkkel via SQL: select public.set_company_ai_key('<company_id>', '<nøkkel>');
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'

type Mode = 'gap_check' | 'order_lookup' | 'project_status' | 'classify_intent' | 'live_token'

type AiVoiceRequest = {
  mode: Mode
  routeContext: string
  audio?: { base64: string; mimeType: string }
  text?: string
  context?: unknown
}

type GeminiSpec = {
  systemInstruction: string
  responseSchema: Record<string, unknown>
}

const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
const GEMINI_LIVE_MODEL = Deno.env.get('GEMINI_LIVE_MODEL') ?? 'gemini-3.1-flash-live-preview'
// Prebuilt-stemme for Live (bytt uten app-utrulling: supabase secrets set GEMINI_LIVE_VOICE=Aoede).
// Kvinnelige kandidater: Kore (fast/klar), Aoede (lett), Leda (ung), Zephyr (lys). Mannlige: Charon, Orus, Fenrir, Puck.
const GEMINI_LIVE_VOICE = Deno.env.get('GEMINI_LIVE_VOICE') ?? 'Kore'
const GEMINI_TIMEOUT_MS = 20_000

// Ephemeral token for Gemini Live: klienten kobler til Live-WebSocketen direkte
// (lyd-streaming kan ikke gå via denne funksjonen uten å doble latens), men skal
// ALDRI se den ekte API-nøkkelen. Tokenet er engangs (uses: 1) og kortlevd —
// verdiene under er bevisst stramme: en økt må STARTES innen 2 min (mer enn nok,
// klienten kobler til umiddelbart etter svaret), og kan vare i inntil 30 min.
// TODO(hardening): lås model/config med liveConnectConstraints når flyten er
// verifisert på enhet — semantikken rundt lockAdditionalFields er udokumentert
// nok til at vi ikke gambler førstegangs-testen på den.
const LIVE_TOKEN_SESSION_START_WINDOW_MS = 2 * 60_000
const LIVE_TOKEN_MAX_SESSION_MS = 30 * 60_000

async function createLiveToken(apiKey: string): Promise<{ token: string; model: string }> {
  const now = Date.now()
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      uses: 1,
      newSessionExpireTime: new Date(now + LIVE_TOKEN_SESSION_START_WINDOW_MS).toISOString(),
      expireTime: new Date(now + LIVE_TOKEN_MAX_SESSION_MS).toISOString(),
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`token-utstedelse feilet ${res.status}: ${errText.slice(0, 300)}`)
  }
  const json = await res.json()
  if (typeof json?.name !== 'string' || json.name.length === 0) {
    throw new Error('token-utstedelse ga uventet svar')
  }
  return { token: json.name, model: GEMINI_LIVE_MODEL, voice: GEMINI_LIVE_VOICE }
}

// Gemini dokumenterer audio/wav|mp3|aiff|aac|ogg|flac for inline lyd — expo-audio
// produserer AAC i en .m4a-beholder. Vi merker den "audio/aac" siden det er
// bitstrømmen som faktisk telles; om Gemini avviser dette må runtime-audiospiken
// nevnt i planen (Fase 0b: "Gemini lyd-latency uverifisert") også dekke dette,
// og evt. bytte til WAV/PCM-opptak (kun bekreftet MediaRecorder-støtte på Android
// via omveier — se plan: Åpne risikoer).
const AUDIO_MIME_FALLBACK = 'audio/aac'

const CONFIDENCE_ENUM = ['high', 'medium', 'low']

const GAP_CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING', description: 'Ordrett transkripsjon av lydklippet.' },
    extracted: {
      type: 'ARRAY',
      description: 'Feltverdier utledet av det som ble sagt — kan gjelde flere felt fra én ytring hvis det er en rimelig implikasjon, ikke bare eksplisitt nevnte ord.',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING', description: 'Feltets key, eksakt som i feltlisten.' },
          value: { type: 'STRING', description: 'Verdien — for choice-felt: eksakt én av de oppgitte choices, ordrett.' },
          reason: { type: 'STRING', description: 'Én kort setning: hvorfor dette feltet ble fylt ut fra det som ble sagt.' },
        },
        required: ['key', 'value', 'reason'],
      },
    },
    stillMissing: {
      type: 'ARRAY',
      description: 'Kun felt som er required og genuint uadressert — ikke gjenta felt som allerede har verdi.',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          followUpQuestion: { type: 'STRING', description: 'Kort, naturlig norsk oppfølgingsspørsmål — egnet til å leses høyt.' },
        },
        required: ['key', 'followUpQuestion'],
      },
    },
    spokenReply: { type: 'STRING', description: 'Kort setning som leses høyt til brukeren — oppsummer ELLER still det viktigste gjenværende spørsmålet, ikke begge.' },
    confidence: { type: 'STRING', enum: CONFIDENCE_ENUM },
  },
  required: ['transcript', 'extracted', 'stillMissing', 'spokenReply', 'confidence'],
}

const ORDER_LOOKUP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    intent: { type: 'STRING', enum: ['start_documentation', 'unknown'] },
    orderNumber: { type: 'INTEGER', nullable: true, description: 'Ordrenummeret nevnt, eller null hvis ikke oppfattet.' },
    spokenReply: { type: 'STRING', description: 'F.eks. "Mener du ordre 14113?" — kort, egnet til å leses høyt.' },
    confidence: { type: 'STRING', enum: CONFIDENCE_ENUM },
  },
  required: ['transcript', 'intent', 'orderNumber', 'spokenReply', 'confidence'],
}

const PROJECT_STATUS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    spokenReply: { type: 'STRING', description: 'Naturlig muntlig oppsummering av fremdriftstallene som ble sendt med i konteksten — ikke finn på tall selv.' },
    confidence: { type: 'STRING', enum: CONFIDENCE_ENUM },
  },
  required: ['transcript', 'spokenReply', 'confidence'],
}

const CLASSIFY_INTENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    mode: { type: 'STRING', enum: ['gap_check', 'order_lookup', 'project_status', 'unclear'] },
    confidence: { type: 'STRING', enum: CONFIDENCE_ENUM },
  },
  required: ['transcript', 'mode', 'confidence'],
}

function buildSpec(body: AiVoiceRequest): GeminiSpec | null {
  const contextJson = JSON.stringify(body.context ?? {})

  switch (body.mode) {
    case 'gap_check':
      return {
        systemInstruction:
          'Du er en assistent som hjelper en norsk elektriker med å fylle ut et HMS-/compliance-skjema mens de forteller fritt om arbeidet de har gjort. ' +
          'Du får konteksten (ordredetaljer, malens regulatoriske grunnlag, eventuelle nylig fullførte lignende dokumenter) og feltlisten som JSON under. ' +
          'Resonner om IMPLIKASJONER — én uttalelse kan svare på flere felt samtidig selv om feltene ikke nevnes ved navn. ' +
          'Fyll KUN felt du har rimelig grunnlag for i det som faktisk ble sagt — ikke gjett eller fyll inn plausible standardverdier. ' +
          'For choice-felt: verdien MÅ være ordrett lik ett av de oppgitte alternativene, ellers ikke fyll feltet. ' +
          'Spør kun oppfølgingsspørsmål om felt som er required og genuint uadressert. Skriv spokenReply som noe som er naturlig å lese høyt på norsk.\n\n' +
          `KONTEKST:\n${contextJson}`,
        responseSchema: GAP_CHECK_SCHEMA,
      }
    case 'order_lookup':
      return {
        systemInstruction:
          'En norsk elektriker snakker til en app for å slå opp en ordre eller starte dokumentasjon på den, f.eks. "start dokumentasjon på ordre 14113". ' +
          'Tolk KUN talen — du har ikke tilgang til selve ordredataene, det slås opp lokalt av appen etterpå. ' +
          'Trekk ut ordrenummeret som et heltall hvis det nevnes. Sett confidence lavt hvis nummeret er uklart eller ikke nevnt. ' +
          `Ekstra kontekst om nåværende skjerm: ${contextJson}`,
        responseSchema: ORDER_LOOKUP_SCHEMA,
      }
    case 'project_status':
      return {
        systemInstruction:
          'En prosjektleder spør en norsk elektriker-app om fremdriften i et prosjekt. Appen har allerede regnet ut tallene (per rom, per fagfelt) — ' +
          'de ligger i konteksten under. Din jobb er KUN å formulere et naturlig, muntlig svar basert på disse tallene — ikke finn på egne tall. ' +
          `KONTEKST (allerede aggregert lokalt):\n${contextJson}`,
        responseSchema: PROJECT_STATUS_SCHEMA,
      }
    case 'classify_intent':
      return {
        systemInstruction:
          'En norsk elektriker rister telefonen og snakker, men appen vet ikke fra sammenhengen hva de vil gjøre. Avgjør om ytringen handler om: ' +
          '"gap_check" (fortelle om utført arbeid for å fylle ut et skjema), "order_lookup" (slå opp/starte dokumentasjon på en navngitt ordre), ' +
          '"project_status" (spørre hvordan et prosjekt ligger an), eller "unclear" hvis ingen av delene passer godt. ' +
          `Kontekst om nåværende skjerm: ${contextJson}`,
        responseSchema: CLASSIFY_INTENT_SCHEMA,
      }
    default:
      return null
  }
}

async function callGemini(apiKey: string, spec: GeminiSpec, body: AiVoiceRequest): Promise<Record<string, unknown>> {
  const parts: Record<string, unknown>[] = []
  if (body.audio) {
    parts.push({ inline_data: { mime_type: body.audio.mimeType || AUDIO_MIME_FALLBACK, data: body.audio.base64 } })
  }
  if (body.text) {
    parts.push({ text: body.text })
  }
  if (parts.length === 0) {
    throw new Error('verken lyd eller tekst i forespørselen')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          systemInstruction: { parts: [{ text: spec.systemInstruction }] },
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: spec.responseSchema,
          },
        }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Gemini svarte ${res.status}: ${errText.slice(0, 300)}`)
    }

    const json = await res.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof text !== 'string') throw new Error('tomt svar fra Gemini')

    return JSON.parse(text)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Firmaets egen Gemini-nøkkel (Supabase Vault, se migrasjon 20260811190000) hvis
 * satt, ellers Ampex' delte nøkkel. Ampex er tenkt som ekte multi-firma SaaS —
 * dette isolerer AI-kostnad/kvote per firma etter hvert, uten å kreve at et nytt
 * firma skaffer en Google-konto før de kan bruke assistenten i det hele tatt.
 */
async function resolveGeminiApiKey(ctx: {
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }
  supabaseAdmin: { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }
}): Promise<string | null> {
  const { data: companyId } = await ctx.supabase.rpc('current_company_id')
  if (typeof companyId === 'string') {
    const { data: companyKey } = await ctx.supabaseAdmin.rpc('get_company_ai_key', {
      p_company_id: companyId,
      p_provider: 'gemini',
    })
    if (typeof companyKey === 'string' && companyKey.length > 0) return companyKey
  }
  return Deno.env.get('GEMINI_API_KEY') ?? null
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    let body: AiVoiceRequest
    try {
      body = await req.json()
    } catch {
      return Response.json({ ok: false, error: 'ugyldig forespørsel' })
    }

    const apiKey = await resolveGeminiApiKey(ctx)
    if (!apiKey) {
      console.error('[ai-voice] Ingen Gemini-nøkkel tilgjengelig (verken firma- eller delt nøkkel)')
      return Response.json({ ok: false, error: 'AI ikke konfigurert' })
    }

    if (body.mode === 'live_token') {
      try {
        const { token, model, voice } = await createLiveToken(apiKey)
        return Response.json({ ok: true, token, model, voice })
      } catch (err) {
        console.error('[ai-voice] live_token feilet:', err)
        return Response.json({ ok: false, error: err instanceof Error ? err.message : 'ukjent feil' })
      }
    }

    const spec = buildSpec(body)
    if (!spec) {
      return Response.json({ ok: false, error: `ukjent modus: ${body.mode}` })
    }

    try {
      const result = await callGemini(apiKey, spec, body)
      return Response.json({ ok: true, ...result })
    } catch (err) {
      // Kaster ALDRI en feil klienten ikke kan parse — alltid en body den kan lese
      // (se lib/ai/gemini-client.ts). HTTP 200 uansett utfall, ok-feltet bærer status.
      console.error('[ai-voice] feilet:', err)
      return Response.json({ ok: false, error: err instanceof Error ? err.message : 'ukjent feil' })
    }
  }),
}
