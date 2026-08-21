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

type Mode = 'gap_check' | 'order_lookup' | 'project_status' | 'classify_intent' | 'live_token' | 'form_import'

type AiVoiceRequest = {
  mode: Mode
  routeContext: string
  audio?: { base64: string; mimeType: string }
  text?: string
  context?: unknown
  /** live_token: be om et token UTEN lås, etter at en låst økt ble avvist ved setup. */
  ulaast?: boolean
  /** form_import: PDF eller bilde av firmaets eget skjema. */
  dokument?: { base64: string; mimeType: string }
}

type GeminiSpec = {
  systemInstruction: string
  responseSchema: Record<string, unknown>
}

const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
const GEMINI_LIVE_MODEL = Deno.env.get('GEMINI_LIVE_MODEL') ?? 'gemini-3.1-flash-live-preview'
// Prebuilt-stemme for Live (bytt uten app-utrulling: supabase secrets set GEMINI_LIVE_VOICE=Orus).
//
// STANDARD ER MANN, og det er et kvalitetsvalg, ikke et smaksvalg: de kvinnelige
// stemmene treffer ikke norsk prosodi — de lander mellom dialekter og blir
// slitsomme å høre på over en arbeidsdag. Charon er den dypeste og roligste.
// Andre mannlige: Orus (nøytral), Fenrir (kraftig), Puck (kvikk).
// Kvinnelige finnes fortsatt i velgeren under Meg: Kore, Aoede, Leda, Zephyr.
const GEMINI_LIVE_VOICE = Deno.env.get('GEMINI_LIVE_VOICE') ?? 'Charon'
const GEMINI_TIMEOUT_MS = 20_000

// Skjemaimport er en SJELDEN operasjon med varig resultat: en mal leses inn én
// gang og brukes så på hver eneste jobb i årevis. Da er det riktig å bruke den
// dyre modellen — kostnaden er engangs, feilen er ikke. Faller tilbake til
// standardmodellen hvis navnet ikke finnes, så et modellbytte hos Google ikke
// tar funksjonen med seg.
const GEMINI_IMPORT_MODEL = Deno.env.get('GEMINI_IMPORT_MODEL') ?? 'gemini-2.5-pro'
// Et skannet skjema på fire sider tar lengre tid enn en talesetning. Klienten
// venter tilsvarende lenge (se CLIENT_IMPORT_TIMEOUT_MS i lib/ai/gemini-client.ts).
const GEMINI_IMPORT_TIMEOUT_MS = 110_000
// Gemini tar inntil 20 MB i én forespørsel, base64 blåser opp med en tredel.
// Vi stopper godt under, og sier fra HVORFOR i stedet for å la Google gjøre det.
const IMPORT_MAX_BASE64 = 12 * 1024 * 1024

// Ephemeral token for Gemini Live: klienten kobler til Live-WebSocketen direkte
// (lyd-streaming kan ikke gå via denne funksjonen uten å doble latens), men skal
// ALDRI se den ekte API-nøkkelen. Tokenet er engangs (uses: 1) og kortlevd —
// verdiene under er bevisst stramme: en økt må STARTES innen 2 min (mer enn nok,
// klienten kobler til umiddelbart etter svaret), og kan vare i inntil 30 min.
const LIVE_TOKEN_SESSION_START_WINDOW_MS = 2 * 60_000
const LIVE_TOKEN_MAX_SESSION_MS = 30 * 60_000

// Nødbryter: sett `supabase secrets set GEMINI_LIVE_UNLOCK=1` hvis låsingen under
// skulle avvise ekte økter i felt. Da er stemmen tilbake i drift uten utrulling,
// og problemet kan feilsøkes i ro. Skal normalt være av.
const LIVE_CONSTRAINTS_OFF = Deno.env.get('GEMINI_LIVE_UNLOCK') === '1'

/**
 * Hva tokenet låses til, og hvorfor akkurat dette.
 *
 * Uten `liveConnectConstraints` er tokenet bare kortlevd og engangs — men det
 * sier ingenting om HVA det kan brukes til. Fanger noen det opp i
 * tominuttersvinduet, kan de åpne en økt mot hvilken som helst modell, med
 * hvilken som helst systeminstruks, på FIRMAETS kvote.
 *
 * Låst:
 *  - `model` — den faktiske trusselen. En dyr modell på andres regning.
 *  - `responseModalities: ['AUDIO']` — hindrer at tokenet gjenbrukes som en
 *    gratis tekst-LLM.
 *
 * IKKE låst, med vilje:
 *  - `sessionResumption` — Googles eget eksempel setter den til `{}`, men
 *    klienten sender et `handle` for å gjenoppta forrige samtale (10 min).
 *    Å låse den til tom ville drept gjenopptagelsen.
 *  - `speechConfig` — stemmen er et personlig valg i Meg-fanen, og skal kunne
 *    variere per bruker.
 *  - `systemInstruction` og `tools` — instruksen bygges på klienten fordi den
 *    inneholder brukerens navn, notater, påminnelser og firmaets skjemakatalog.
 *    Google anbefaler å flytte den serverside; det krever at all den konteksten
 *    sendes hit først, og er en egen jobb. Notert som gjenstående herding.
 */
function liveConnectConstraints(): Record<string, unknown> | undefined {
  if (LIVE_CONSTRAINTS_OFF) return undefined
  return {
    model: `models/${GEMINI_LIVE_MODEL}`,
    config: { responseModalities: ['AUDIO'] },
  }
}

async function issueToken(apiKey: string, constraints: Record<string, unknown> | undefined): Promise<string> {
  const now = Date.now()
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      uses: 1,
      newSessionExpireTime: new Date(now + LIVE_TOKEN_SESSION_START_WINDOW_MS).toISOString(),
      expireTime: new Date(now + LIVE_TOKEN_MAX_SESSION_MS).toISOString(),
      ...(constraints ? { liveConnectConstraints: constraints } : {}),
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
  return json.name
}

/**
 * En sikkerhetsherding som kan slå ut stemmen er ikke en herding, det er en
 * feil med god begrunnelse. Derfor to fallback-veier:
 *
 *  1. HER: avviser Google selve `liveConnectConstraints`-formen (feil feltnavn,
 *     feil nesting, ikke støttet på modellen), utstedes tokenet uten lås i
 *     stedet for at økten dør. Vi er da tilbake på gårsdagens sikkerhet — ikke
 *     bedre, men heller ikke verre, og svaret sier `laast: false` så det ikke
 *     blir en stille nedgradering.
 *  2. `ulaast`: klienten ber om et ulåst token etter at en LÅST økt ble avvist
 *     ved setup. Det svekker ikke trusselmodellen — den handler om et token som
 *     snappes opp i tominuttersvinduet, og den som allerede har brukerens
 *     innlogging kan uansett be om så mange tokens den vil.
 */
async function createLiveToken(
  apiKey: string,
  ulaast: boolean,
): Promise<{ token: string; model: string; voice: string; laast: boolean }> {
  const constraints = ulaast ? undefined : liveConnectConstraints()
  const felles = { model: GEMINI_LIVE_MODEL, voice: GEMINI_LIVE_VOICE }
  if (!constraints) return { token: await issueToken(apiKey, undefined), ...felles, laast: false }
  try {
    return { token: await issueToken(apiKey, constraints), ...felles, laast: true }
  } catch (err) {
    console.error('[ai-voice] låst token avvist av Google — utsteder ulåst:', err)
    return { token: await issueToken(apiKey, undefined), ...felles, laast: false }
  }
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

const FORM_IMPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tittel: { type: 'STRING', description: 'Skjemaets tittel, ordrett fra dokumentet.' },
    kategori: { type: 'STRING', enum: ['Sluttkontroll', 'Risiko / SJA', 'HMS', 'Måleprotokoll', 'Egenkontroll', 'Diverse'] },
    merknad: { type: 'STRING', description: 'Én setning om hva du så: antall sider, kvalitet, og hva du eventuelt måtte utelate.' },
    seksjoner: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tittel: { type: 'STRING', description: 'Overskriften i dokumentet. Tom streng hvis skjemaet ikke er delt opp.' },
          felt: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING', description: 'Kort snake_case-id på norsk, utledet av etiketten. Må være unik i hele skjemaet.' },
                type: { type: 'STRING', enum: ['check', 'text', 'multiline', 'number', 'choice', 'table', 'info', 'photo'] },
                label: { type: 'STRING', description: 'Teksten slik den står i dokumentet. Ikke omskriv, ikke forkort.' },
                paakrevd: { type: 'BOOLEAN', description: 'Kun hvis dokumentet selv markerer punktet som obligatorisk.' },
                hjelp: { type: 'STRING', description: 'Veiledning/henvisning som står ved punktet, f.eks. «jf. NEK 400 pkt. 6.4».' },
                valg: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Kun for type=choice: alternativene som faktisk står i dokumentet.' },
                kolonner: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Kun for type=table: kolonneoverskriftene.' },
                enhet: { type: 'STRING', description: 'Kun for type=number: A, V, MΩ, mm², °C …' },
                vises_hvis: {
                  type: 'OBJECT',
                  nullable: true,
                  properties: {
                    felt: { type: 'STRING', description: 'id-en til et punkt LENGER OPPE i skjemaet.' },
                    er: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Svarene som utløser visning — ordrett fra det punktets alternativer.' },
                  },
                  required: ['felt', 'er'],
                },
                usikkert: { type: 'STRING', description: 'Fyll KUN når du er usikker: én setning om hva som var uklart. La stå tom ellers.' },
              },
              required: ['id', 'type', 'label'],
            },
          },
        },
        required: ['tittel', 'felt'],
      },
    },
  },
  required: ['tittel', 'kategori', 'merknad', 'seksjoner'],
}

const FORM_IMPORT_INSTRUKS =
  'Du leser et norsk elektrofaglig skjema — sluttkontroll, samsvarserklæring, risikovurdering/SJA, måleprotokoll, ' +
  'egenkontroll eller en sjekkliste — og gjør det om til en utfyllbar mal. Kilden kan være fra SpeedyCraft, Cordel, ' +
  'Handyman, NELFO, eller et Word-dokument firmaet har laget selv.\n\n' +
  'GRUNNREGEL: gjengi skjemaet, ikke forbedre det. Ikke legg til punkt som ikke står der, ikke slå sammen punkt, ' +
  'ikke skriv om ordlyden. Den som lastet opp dette skal kjenne igjen sitt eget skjema.\n\n' +
  'SLIK KJENNER DU IGJEN TYPENE:\n' +
  '- Avkryssing med Ja/Nei/Ikke aktuelt, eller ruter som skal hukes av → check\n' +
  '- Egne svaralternativer skrevet ut (f.eks. «Lav / Middels / Høy») → choice med akkurat de alternativene\n' +
  '- Rutenett med kolonneoverskrifter som fylles rad for rad (kursfortegnelse, måleprotokoll) → table\n' +
  '- Måleverdi med benevning → number med enhet\n' +
  '- Én linje for navn, sted, anleggsnummer → text. Flere linjer for beskrivelse → multiline\n' +
  '- Erklæringstekst, forklaring eller instruks som ikke skal fylles ut → info\n' +
  '- Et felt der dokumentet ber om foto/vedlegg → photo\n\n' +
  'OVERSKRIFTER blir seksjoner, ikke punkt. Er skjemaet ikke delt opp, lag én seksjon med tom tittel.\n\n' +
  '«HVIS JA, BESKRIV …» er en betingelse: bruk vises_hvis mot punktet over, med svaret ordrett. Betingelser kan ' +
  'BARE peke oppover i skjemaet.\n\n' +
  'SIGNATURFELT OG SIGNATURRUTER skal du IKKE lage punkt av — Ampex har sin egen kundesignatur med tidsstempel. ' +
  'Nevn det i merknad i stedet. Navnefelt som «Kontrollert av» er derimot et vanlig text-punkt.\n\n' +
  'ER DU USIKKER — uskarp skanning, tvetydig punkt, en tabell du ikke får lest kolonnene i — så FYLL UT usikkert ' +
  'med én setning om hva som var uklart. Et menneske går gjennom alt før dette tas i bruk, og en ærlig usikkerhet ' +
  'er langt mer verdt for dem enn en selvsikker gjetning. Ikke la punkt være ute fordi de var vanskelige.'

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
    case 'form_import':
      return {
        systemInstruction: `${FORM_IMPORT_INSTRUKS}\n\nKONTEKST FRA APPEN:\n${contextJson}`,
        responseSchema: FORM_IMPORT_SCHEMA,
      }
    default:
      return null
  }
}

async function callGemini(apiKey: string, spec: GeminiSpec, body: AiVoiceRequest): Promise<Record<string, unknown>> {
  const erImport = body.mode === 'form_import'
  const parts: Record<string, unknown>[] = []
  if (body.audio) {
    parts.push({ inline_data: { mime_type: body.audio.mimeType || AUDIO_MIME_FALLBACK, data: body.audio.base64 } })
  }
  if (body.dokument) {
    if (body.dokument.base64.length > IMPORT_MAX_BASE64) {
      throw new Error('Fila er for stor. Del opp skjemaet, eller last opp én PDF med lavere oppløsning.')
    }
    parts.push({ inline_data: { mime_type: body.dokument.mimeType, data: body.dokument.base64 } })
  }
  if (body.text) {
    parts.push({ text: body.text })
  }
  if (parts.length === 0) {
    throw new Error('verken lyd, dokument eller tekst i forespørselen')
  }

  const modeller = erImport && GEMINI_IMPORT_MODEL !== GEMINI_MODEL
    ? [GEMINI_IMPORT_MODEL, GEMINI_MODEL]
    : [GEMINI_MODEL]

  let sisteFeil: unknown = null
  for (const modell of modeller) {
    try {
      return await enGeminiRunde(apiKey, spec, parts, modell, erImport ? GEMINI_IMPORT_TIMEOUT_MS : GEMINI_TIMEOUT_MS)
    } catch (err) {
      sisteFeil = err
      // Bare modellnavnet skal utløse fallback. En kvotefeil eller en dårlig
      // forespørsel blir ikke bedre av å prøves på nytt mot en annen modell —
      // da er det feilen selv brukeren skal få se.
      const melding = err instanceof Error ? err.message : String(err)
      if (!/ 404:|NOT_FOUND|is not found|not supported/i.test(melding)) throw err
      console.warn(`[ai-voice] modell ${modell} utilgjengelig — faller tilbake:`, melding)
    }
  }
  throw sisteFeil
}

async function enGeminiRunde(
  apiKey: string,
  spec: GeminiSpec,
  parts: Record<string, unknown>[],
  modell: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modell}:generateContent`,
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
        const { token, model, voice, laast } = await createLiveToken(apiKey, body.ulaast === true)
        // `laast` sier om tokenet FAKTISK fikk liveConnectConstraints — ikke om vi
        // ba om dem. Klienten bruker det til to ting: å stille en bedre diagnose
        // når Google avviser oppsettet, og å be om ett ulåst forsøk før den gir opp.
        return Response.json({ ok: true, token, model, voice, laast })
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
