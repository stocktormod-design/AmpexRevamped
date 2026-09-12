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

type Mode =
  | 'gap_check'
  | 'order_lookup'
  | 'project_status'
  | 'classify_intent'
  | 'live_token'
  | 'form_import'
  | 'mind'
  | 'tale'
  | 'voice_usage'

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
  /**
   * mind: hele kontrakten kommer fra klienten — systeminstruks OG verktøyskjema.
   * Samme begrunnelse som for Live (se liveConnectConstraints): verktøyene
   * IMPLEMENTERES på klienten mot WatermelonDB, så deklarasjonene hører hjemme
   * ved siden av implementasjonen. Serveren er en tynn proxy som holder nøkkelen.
   */
  systemInstruction?: string
  tools?: unknown[]
  /**
   * Tidligere turer i samtalen, i Geminis `contents`-format. Klienten sender en
   * KOMPAKT tilstand, ikke en voksende transkripsjon — se lib/ai/mind.ts.
   */
  historikk?: Record<string, unknown>[]
  /**
   * voice_usage: klienten rapporterer forbruket ved øktslutt. Bruker og firma
   * utledes av JWT-en i SQL (voice_usage_add), så en klient kan aldri skrive på
   * andres teller — bare på sin egen, og bare oppover.
   */
  forbruk?: { speech_sec: number; in_tok: number; out_tok: number }
}

type GeminiSpec = {
  systemInstruction: string
  responseSchema: Record<string, unknown>
}

const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
// native-audio, ikke 3.1-flash-live. De to er ulike motorer, og forskjellen er
// hørbar på norsk: testet side om side 2026-09-04, native-audio vant klart.
// Prisen er den samme ($3/1M inn, $12/1M ut) — så det er ingen avveining.
const GEMINI_LIVE_MODEL = Deno.env.get('GEMINI_LIVE_MODEL') ?? 'gemini-2.5-flash-native-audio-latest'
// Prebuilt-stemme for Live (bytt uten app-utrulling: supabase secrets set GEMINI_LIVE_VOICE=Orus).
//
// STANDARD ER MANN, og det er et kvalitetsvalg, ikke et smaksvalg: de kvinnelige
// stemmene treffer ikke norsk prosodi — de lander mellom dialekter og blir
// slitsomme å høre på over en arbeidsdag. Charon er den dypeste og roligste.
// Andre mannlige: Orus (nøytral), Fenrir (kraftig), Puck (kvikk).
// Kvinnelige finnes fortsatt i velgeren under Meg: Kore, Aoede, Leda, Zephyr.
const GEMINI_LIVE_VOICE = Deno.env.get('GEMINI_LIVE_VOICE') ?? 'Charon'
const GEMINI_TIMEOUT_MS = 20_000

// Turbasert assistent («mind»): lyd inn, verktøykall ut. Erstatteren for Live.
//
// Flash-Lite er valgt fordi den er BILLIGST PÅ LYD, ikke fordi den er svakest:
// lyd inn koster $0,50/1M — dobbelt av tekst, men en femtedel av Live sin
// lyd-UT-pris ($12/1M). Vi ber aldri modellen snakke; den returnerer et
// verktøykall, og telefonen setter setningen sammen selv.
//
// thinkingLevel settes IKKE her: MINIMAL er allerede standard på Flash-Lite, og
// et feilstavet felt gir 400 i stedet for en tregere modell. Skal du opp på
// gemini-3-flash (som IKKE defaulter til minimal), sett GEMINI_MIND_THINKING=minimal.
const GEMINI_MIND_MODEL = Deno.env.get('GEMINI_MIND_MODEL') ?? 'gemini-3.1-flash-lite'
const GEMINI_MIND_THINKING = Deno.env.get('GEMINI_MIND_THINKING') ?? ''
// Kortere enn GEMINI_TIMEOUT_MS: dette er en samtaletur, ikke en dokumentjobb.
// Brukeren står med telefonen i hånda — 12s er allerede langt forbi «gi opp».
const GEMINI_MIND_TIMEOUT_MS = 12_000

// Talesyntese for cachen (lib/ai/tale-cache.ts).
//
// Gemini TTS og IKKE Google Cloud Text-to-Speech, av én tvingende grunn:
// Gemini-nøkler MÅ være låst til «Generative Language API» (Google avviste
// urestrikterte nøkler fra 19. juni 2026), og en nøkkel låst dit kan IKKE kalle
// texttospeech.googleapis.com. Cloud TTS ville krevd en helt separat nøkkel med
// egen livssyklus. Gemini TTS ligger på samme endepunkt som resten av
// assistenten og virker med nøkkelen vi allerede har.
//
// Stemmen er den SAMME som Live brukte (GEMINI_LIVE_VOICE, standard Charon), så
// migrasjonen ikke endrer hvordan assistenten høres ut. Begrunnelsen for at
// standarden er en mannsstemme står ved den konstanten.
//
// Utdata er rå PCM16 @ 24 kHz mono — klienten pakker det i WAV med
// wavBase64FromPcm16 (lib/ai/pcm.ts) før den lagrer. Serveren slipper å
// duplisere den koden.
//
// Modellen er Lives EGEN native-audio-motor, ikke TTS-API-et. Det er to ulike
// modeller, og forskjellen er hørbar: TTS-API-et (gemini-3.1-flash-tts-preview)
// leser tekst og høres ut som en opplesning, mens native-audio er den samme
// motoren som gjorde at Live hørtes menneskelig ut. Testet side om side på
// norsk — native-audio vant klart.
//
// Prisen følger med: $12/1M lyd-tokens mot $20/1M for TTS-API-et. Native-audio
// er altså BÅDE bedre og billigere her; det eneste den koster oss er at den må
// snakkes med over WebSocket (bidiGenerateContent) i stedet for en POST.
//
// ~113 lyd-tokens for en fire sekunders bekreftelse = under to hundredeler av
// en cent, og aldri igjen for den samme setningen takket være cachen.
const GEMINI_TALE_MODEL = Deno.env.get('GEMINI_TALE_MODEL') ?? 'gemini-2.5-flash-native-audio-latest'
const TTS_RATE = 24000
const TTS_TIMEOUT_MS = 20_000
const TTS_MAKS_TEGN = 400

// Tonen er ikke pynt. Uten den legger modellen på en blid kundeservice-stemme
// med trykk på siste ord — «... på ordre 19292, MONTASJE?» — som er feil for en
// elektriker med hendene i en tavle.
//
// Merk formuleringen «ETT drag, uten pauser»: første forsøk ba om «rolig, som å
// lese av en måler», og modellen tok det bokstavelig og la inn opptil 0,6 sek
// nøling MIDT i setningen. Be om flat tone, ikke om ro.
const TALE_TONE = `Du er stemmen til Ampex-assistenten for norske elektrikere.
Snakk standard østnorsk bokmål med klar, nøytral uttale.
Si replikken i ETT drag, uten pauser inne i setningen. Jevnt tempo, normal hastighet, aldri nølende.
Nøytralt toneleie — verken blid eller dyster. Ingen entusiasme, ingen trykk på enkeltord.
Bare si det, som en beskjed over radioen.`

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
// REST-navnet er `bidiGenerateContentSetup` (AuthToken i ai.google.dev/api/live), ikke
// SDK-ets `liveConnectConstraints`. Med SDK-navnet svarte Google 400 «Unknown name», og
// hver eneste økt falt stille tilbake til ulåst token (funnet i loggen 2026-09-12).
function liveConnectConstraints(): Record<string, unknown> | undefined {
  if (LIVE_CONSTRAINTS_OFF) return undefined
  // Låsen ERSTATTER klientens oppsett for feltene den nevner — og for
  // realtimeInputConfig gjaldt det selv når klienten sendte sitt: uten denne linja
  // svarte Google 1007 «explicit activity control is not supported» på første
  // activityStart, og økten døde i det brukeren begynte å snakke (2026-09-12).
  return {
    model: `models/${GEMINI_LIVE_MODEL}`,
    generationConfig: { responseModalities: ['AUDIO'] },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
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
      ...(constraints ? { bidiGenerateContentSetup: constraints } : {}),
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

/**
 * Rendrer én setning til tale for talecachen. Returnerer WAV som base64.
 *
 * Kalles KUN ved cachebom, altså én gang per unik setning i hele systemet —
 * klienten laster resultatet opp til R2 etterpå, og alle andre henter det
 * derfra. Derfor er ikke latensen her kritisk: brukeren har allerede fått
 * svaret sitt lest opp av systemstemmen mens dette skjer i bakgrunnen.
 *
 * Lengdegrensen er en kostnadssperre, ikke en teknisk grense. Assistentens
 * bekreftelser er én til to setninger; kommer det noe på 2000 tegn hit, er det
 * en bug et annet sted, og den skal ikke bli dyr.
 */
async function callTale(apiKey: string, body: AiVoiceRequest): Promise<Record<string, unknown>> {
  const tekst = (body.text ?? '').trim()
  if (!tekst) throw new Error('tale krever text')
  if (tekst.length > TTS_MAKS_TEGN) throw new Error(`tale: for lang tekst (${tekst.length} tegn)`)

  // Live-motoren snakkes med over WebSocket, ikke REST. Vi kjører en kort
  // engangsøkt: sett opp, send replikken, samle lydbitene, lukk.
  const url =
    'wss://generativelanguage.googleapis.com/ws/' +
    'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent' +
    `?key=${encodeURIComponent(apiKey)}`

  const biter: string[] = []

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url)
    // Egen timeout: en WebSocket som aldri svarer henger til plattformen dreper
    // funksjonen, og da får klienten ingen feil å falle tilbake på.
    const timeout = setTimeout(() => {
      try { ws.close() } catch { /* allerede lukket */ }
      reject(new Error(`tale: tidsavbrudd etter ${TTS_TIMEOUT_MS} ms`))
    }, TTS_TIMEOUT_MS)

    const ferdig = (feil?: Error) => {
      clearTimeout(timeout)
      try { ws.close() } catch { /* allerede lukket */ }
      feil ? reject(feil) : resolve()
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: `models/${GEMINI_TALE_MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            // Lav temperatur: vi vil ha samme replikk levert likt hver gang, ikke
            // variasjon. Cachen lagrer én lydfil per setning uansett.
            temperature: 0.75,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_LIVE_VOICE } } },
          },
          systemInstruction: { parts: [{ text: TALE_TONE }] },
        },
      }))
    }

    ws.onmessage = async (ev: MessageEvent) => {
      try {
        // Deno gir Blob for binære rammer; Gemini svarer med JSON i begge former.
        const rå = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text()
        const melding = JSON.parse(rå)

        if (melding.setupComplete) {
          // «Din replikk» og ikke «Si dette» eller teksten rå. Målt på samme
          // setning: denne formuleringen ga 77 % taletid og null pauser inne i
          // setningen, mot 75 %/0 for «Si dette» og 73 %/1 for rå tekst.
          // Modellen leverer linja som SIN egen replikk i stedet for å lese den.
          ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: `Din replikk: «${tekst}»` }] }],
              turnComplete: true,
            },
          }))
          return
        }

        const deler = melding?.serverContent?.modelTurn?.parts ?? []
        for (const del of deler) {
          const data = del?.inlineData?.data
          if (typeof data === 'string') biter.push(data)
        }
        if (melding?.serverContent?.turnComplete) ferdig()
      } catch (e) {
        ferdig(e instanceof Error ? e : new Error(String(e)))
      }
    }

    ws.onerror = () => ferdig(new Error('tale: WebSocket-feil mot Gemini'))
    ws.onclose = () => {
      // Lukket uten turnComplete: enten fikk vi lyd likevel (godt nok), eller
      // ingenting (og da skal klienten få vite det).
      clearTimeout(timeout)
      biter.length > 0 ? resolve() : reject(new Error('tale: økten lukket uten lyd'))
    }
  })

  if (biter.length === 0) throw new Error('tomt svar fra Gemini native-audio')

  // Bitene er base64 av rå PCM16-segmenter. De skjøtes i binær form — å
  // konkatenere base64-strenger direkte gir søppel når en bit ikke er delelig på 3.
  const bytes = biter.map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)))
  const total = bytes.reduce((n, b) => n + b.length, 0)
  const samlet = new Uint8Array(total)
  let offset = 0
  for (const b of bytes) { samlet.set(b, offset); offset += b.length }

  let binær = ''
  for (const byte of samlet) binær += String.fromCharCode(byte)
  const lyd = btoa(binær)

  // Rå PCM16 — klienten legger på WAV-headeren. `rate` sendes med i stedet for
  // å hardkodes to steder: bommer den, høres stemmen ut som den er på lystgass.
  return { lyd, rate: TTS_RATE, format: 'pcm16', stemme: GEMINI_LIVE_VOICE, tegn: tekst.length }
}

/**
 * Turbasert assistenttur: ett lydklipp inn, verktøykall (og eventuelt kort tekst) ut.
 *
 * Dette er hele erstatningen for Gemini Live-WebSocketen. Forskjellen er ikke
 * modellen — det er taksameteret. Live fakturerer sesjonen, inkludert stillhet og
 * sin egen tale. Her betaler vi for de tre sekundene brukeren faktisk snakket.
 *
 * KONTRAKTEN KOMMER FRA KLIENTEN. Vi validerer at den finnes, men tolker den ikke:
 * verktøyene kjører mot WatermelonDB på telefonen, og et skjema serveren ikke kan
 * håndheve er et skjema serveren ikke skal eie.
 *
 * `usageMetadata` sendes ALLTID tilbake. Klienten trenger det til én ting som ikke
 * kan gjettes: `cachedContentTokenCount` forteller om den implisitte cachen faktisk
 * traff. Bommer den, koster systeminstruksen full pris og turen blir 2-3x dyrere —
 * uten at noe annet ser annerledes ut. Det er den eneste kostnadsantakelsen i hele
 * designet som kan svikte stille, så den skal være målt, ikke antatt.
 */
async function callMind(apiKey: string, body: AiVoiceRequest): Promise<Record<string, unknown>> {
  if (!body.audio && !body.text) throw new Error('mind krever audio eller text')
  if (typeof body.systemInstruction !== 'string' || !body.systemInstruction) {
    throw new Error('mind krever systemInstruction fra klienten')
  }
  if (!Array.isArray(body.tools) || body.tools.length === 0) {
    throw new Error('mind krever tools fra klienten')
  }

  const parts: Record<string, unknown>[] = []
  if (body.audio) {
    parts.push({
      inlineData: { mimeType: body.audio.mimeType || AUDIO_MIME_FALLBACK, data: body.audio.base64 },
    })
  }
  if (body.text) parts.push({ text: body.text })

  const contents = [...(body.historikk ?? []), { role: 'user', parts }]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GEMINI_MIND_TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MIND_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: body.systemInstruction }] },
          tools: body.tools,
          // AUTO, ikke ANY: assistenten MÅ kunne svare med ren tekst når brukeren
          // spør om noe («hvor mange timer har jeg denne uka?») eller når den
          // trenger en oppklaring. ANY ville tvunget fram et verktøykall også der.
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: {
            ...(GEMINI_MIND_THINKING ? { thinkingConfig: { thinkingLevel: GEMINI_MIND_THINKING } } : {}),
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
    const candidate = json?.candidates?.[0]
    const responseParts: Record<string, unknown>[] = candidate?.content?.parts ?? []

    const funksjonskall = responseParts
      .filter(p => p && typeof p === 'object' && 'functionCall' in p)
      .map(p => {
        const fc = (p as { functionCall: { name?: string; args?: unknown } }).functionCall
        return { navn: fc?.name ?? '', argumenter: fc?.args ?? {} }
      })
      .filter(k => k.navn)

    const tekst = responseParts
      .map(p => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : ''))
      .join('')
      .trim()

    const bruk = json?.usageMetadata ?? {}

    return {
      funksjonskall,
      tekst: tekst || null,
      // Rå modellsvar-deler tilbake: klienten må sende dem UENDRET som
      // `role: 'model'`-turn i neste kalls historikk, ellers mister Gemini
      // sporet av sitt eget verktøykall og kaller det på nytt.
      modellDeler: responseParts,
      avslutning: candidate?.finishReason ?? null,
      bruk: {
        inn: bruk.promptTokenCount ?? 0,
        cachet: bruk.cachedContentTokenCount ?? 0,
        ut: bruk.candidatesTokenCount ?? 0,
        totalt: bruk.totalTokenCount ?? 0,
      },
      modell: GEMINI_MIND_MODEL,
    }
  } finally {
    clearTimeout(timeout)
  }
}

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

    if (body.mode === 'voice_usage') {
      const f = body.forbruk
      if (!f) return Response.json({ ok: false, error: 'voice_usage krever forbruk' })
      const { error } = await ctx.supabase.rpc('voice_usage_add', {
        p_speech_sec: Math.round(f.speech_sec), p_in_tok: Math.round(f.in_tok),
        p_out_tok: Math.round(f.out_tok), p_sessions: 1,
      })
      if (error) console.error('[ai-voice] voice_usage_add feilet:', error)
      return Response.json({ ok: !error })
    }

    if (body.mode === 'live_token') {
      // Taket sjekkes HER, ved utstedelsen — det er det eneste stedet som ikke
      // kan omgås av en klient. Over taket: ingen token, og klienten faller
      // tilbake til den turbaserte assistenten med systemstemmen. Den slutter
      // ikke å virke, den blir bare gratis resten av dagen.
      const { data: kap, error: kapFeil } = await ctx.supabase.rpc('voice_cap_check')
      const rad = Array.isArray(kap) ? kap[0] : kap
      if (kapFeil) console.error('[ai-voice] voice_cap_check feilet, slipper gjennom:', kapFeil)
      else if (rad && rad.allowed === false) {
        return Response.json({ ok: false, reason: 'cap', tier: rad.tier, cap_sec: rad.cap_sec, used_sec: rad.used_sec })
      }
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

    if (body.mode === 'tale') {
      try {
        const result = await callTale(apiKey, body)
        return Response.json({ ok: true, ...result })
      } catch (err) {
        console.error('[ai-voice] tale feilet:', err)
        return Response.json({ ok: false, error: err instanceof Error ? err.message : 'ukjent feil' })
      }
    }

    if (body.mode === 'mind') {
      try {
        const result = await callMind(apiKey, body)
        return Response.json({ ok: true, ...result })
      } catch (err) {
        console.error('[ai-voice] mind feilet:', err)
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
