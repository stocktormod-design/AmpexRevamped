import { Q } from '@nozbe/watermelondb'
import {
  AudioContext,
  AudioManager,
  AudioRecorder,
  type AudioBufferQueueSourceNode,
} from 'react-native-audio-api'
import { database } from '../db'
import { Order, orderStatusLabel } from '../db/models/order'
import { OrderDocument } from '../db/models/order-document'
import { OrderScan } from '../db/models/order-scan'
import { FormTemplate } from '../db/models/form-template'
import { Project } from '../db/models/project'
import { Room } from '../db/models/room'
import { findByOrderNumber } from '../orders'
import { byggLag1, byggLag2, byggLag3 } from './instruks'
import { verktoyrettigheter } from './verktoy-tilgang'
import { nyNonce } from './vask'
import {
  addOrderMember,
  findColleagueByName,
  getCurrentUser,
  getOrderMembers,
  isOrderMember,
  listMyOrders,
  type CurrentUser,
} from '../order-access'
import { syncQuietly } from '../db/sync'
import { TimeEntry } from '../db/models/time-entry'
import { finnAktivitet } from '../activities'
import { OrderExtra, type TilleggPrising } from '../db/models/order-extra'
import { Quote } from '../db/models/quote'
import { resolveTemplate, listAllTemplates, type TemplateCatalogEntry } from '../forms/resolve'
import { startVoiceFill, applyVoiceFill, type VoiceFillEntry } from '../forms/voice-fill'
import { emitVoiceLevel } from './voice-level'
import { isEchoCancelledMicAvailable, startEchoCancelledMic } from '../../modules/ampex-splat'
import { getPreferredVoice } from './voice-prefs'
import { Reminder } from '../db/models/reminder'
import { AssistantNote } from '../db/models/assistant-note'
import {
  spenningsfall,
  lastStroem,
  vernKarakteristikk,
  koordinerKabelVern,
  kortslutningEnde,
  regnUt,
  VARMEKABEL_VEILEDNING,
} from '../elektro'
import { getForecast } from '../weather'
import { computeProjectProgress, progressToSpokenContext } from '../project-progress'
import { fetchLiveToken, reportVoiceUsage, type VoiceCap } from './gemini-client'
import { base64ToBytes, bytesToBase64, floatToPcm16Bytes, rmsFraPcm16 } from './pcm'
import type { VoiceRouteContext } from './voice-drafts'
import { sokVareVerktoy, taUtMateriellVerktoy, leggTilMateriellVerktoy } from './materiell-tools'
import { nyttTilbudVerktoy, tilbudslinjeVerktoy, tilbudssumVerktoy } from './tilbud-tools'
import { SYSTEM_INSTRUCTION, TOOL_DECLARATIONS } from './assistant-contract'
import { runTool } from './tools-runtime'

// Gemini Live: rå PCM16 little-endian begge veier — 16kHz opp, 24kHz ned
// (dokumentert format, ikke valgbart). 100ms-chunks opp gir ~3,2KB per melding:
// lav nok latens for samtale, få nok meldinger til at JS-tråden ikke drukner.
const INPUT_SAMPLE_RATE = 16000
const INPUT_CHUNK_FRAMES = 1600
const OUTPUT_SAMPLE_RATE = 24000

// Ephemeral tokens har sin EGEN WS-metode: BidiGenerateContentConstrained på
// v1alpha, med rå (u-URL-enkodet) token i ?access_token= — vanlige BidiGenerateContent
// + API-nøkkel-kanalene svarer bare 1008 «unregistered caller» på tokens. Fasit er
// googleapis/js-genai src/live.ts (apiKey.startsWith('auth_tokens/')-grenen).
/*
 * Klient-VAD. Live-API-et har egen VAD, men den forutsetter at vi strømmer ALT —
 * og fakturerer alt: 25 tokens/sek for stillhet, drill og radioen i bilen. Med
 * automaticActivityDetection.disabled sender vi bare tale, innrammet av
 * activityStart/activityEnd, og betaler for det brukeren faktisk sier.
 *
 * Tallene er de samme som i mind-session.ts, der de er felt-tunet:
 *  - TALE_RMS 0.02: under dette er det ikke tale (AEC-mikrofonen gir renere signal).
 *  - STILLE_MS 800: Google krever MINST 500 ms stillhet før activityEnd, ellers
 *    kuttes pauser midt i setninger. 800 er Pipecats standard.
 *  - AVBRYT_MS 400: barge-in-terskel. Folk backchanneler («mm») 7x oftere enn
 *    de avbryter; 400 ms slipper kvitteringene gjennom og fanger korreksjoner.
 *  - IDLE_MS: ingen tale på tre minutter → økten lukkes. Det er DETTE som gjør
 *    at et glemt åpent skift ikke koster noe — ikke taket.
 */
const TALE_RMS = 0.02
const STILLE_MS = 800
const MIN_TALE_MS = 300
const MAKS_TALE_MS = 20_000
const AVBRYT_MS = 400
const FORBUFFER_BITER = 4
const IDLE_MS = 3 * 60_000

const LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained'

// Google Søk-grounding har EGEN dagskvote — når den er tom avviser Google HELE økten ved
// setup (close 1011, «exceeded your current quota»). Feilsøkt 2026-08-13: alle økter døde
// «stille» en hel dag fordi søkeverktøyet sto i setup. Når det skjer: koble til på nytt
// uten søk og husk det en halvtime — assistenten virker alltid, søk kommer tilbake selv.
let searchQuotaBlockedUntil = 0

export type LiveStage = 'connecting' | 'active'

export type LiveSessionCallbacks = {
  onStage: (stage: LiveStage) => void
  /** Økten er over — uansett årsak. `error` satt hvis den døde unaturlig. */
  onEnd: (error?: string) => void
  /** Modellen slo opp en ordre som finnes lokalt — UI kan tilby navigasjon. */
  onOrderFound?: (order: Order) => void
  /** Modellen er ferdig å fylle et skjemautkast — UI navigerer til skjemaet for verifisering. */
  onOpenForm?: (orderId: string, templateId: string) => void
  /** Guide-navigasjon: modellen åpner en skjerm direkte (f.eks. ordren den nettopp opprettet). */
  onNavigate?: (path: string) => void
  /** Dagstaket er nådd — ingen økt startet. UI faller tilbake til turbasert + systemstemme. */
  onCapHit?: (cap: VoiceCap) => void
}


// RNs WebSocket kan levere binære rammer; Live-APIet sender JSON i dem.
const utf8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'


const BASE64_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < BASE64_CHARS.length; i++) table[BASE64_CHARS.charCodeAt(i)] = i
  return table
})()

/** Base64 med PCM16LE → Float32-samples [-1,1]. Ren JS — ingen bridge-rundtur per chunk. */
function pcm16Base64ToFloat32(b64: string): Float32Array {
  let len = b64.length
  while (len > 0 && b64.charCodeAt(len - 1) === 61) len-- // strip '='
  const byteCount = Math.floor((len * 3) / 4)
  const bytes = new Uint8Array(byteCount)
  let o = 0
  for (let i = 0; i + 3 < len; i += 4) {
    const a = BASE64_LOOKUP[b64.charCodeAt(i)]
    const b = BASE64_LOOKUP[b64.charCodeAt(i + 1)]
    const c = BASE64_LOOKUP[b64.charCodeAt(i + 2)]
    const d = BASE64_LOOKUP[b64.charCodeAt(i + 3)]
    bytes[o++] = (a << 2) | (b >> 4)
    if (o < byteCount) bytes[o++] = ((b & 15) << 4) | (c >> 2)
    if (o < byteCount) bytes[o++] = ((c & 3) << 6) | d
  }
  // Rest på 2/3 tegn (uten padding) — forekommer ikke fra Gemini, men vær robust.
  const rem = len % 4
  if (rem >= 2) {
    const i = len - rem
    const a = BASE64_LOOKUP[b64.charCodeAt(i)]
    const b = BASE64_LOOKUP[b64.charCodeAt(i + 1)]
    if (o < byteCount) bytes[o++] = (a << 2) | (b >> 4)
    if (rem === 3 && o < byteCount) {
      const c = BASE64_LOOKUP[b64.charCodeAt(i + 2)]
      bytes[o++] = ((b & 15) << 4) | (c >> 2)
    }
  }
  const samples = new Float32Array(byteCount >> 1)
  for (let i = 0; i < samples.length; i++) {
    const v = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
    samples[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000
  }
  return samples
}

// ÉN delt AudioContext for hele appens levetid — IKKE ny per økt. Per-økt
// create/close lekket native audio-enheter når close() hang på en kontekst
// skadet av audio-avbrudd (bakgrunnsstrøm): etter et par økter var iOS-lyden
// så wedged at kun omstart av telefonen hjalp («virker bare etter reboot»).
let sharedAudioContext: AudioContext | null = null
function getSharedAudioContext(): AudioContext {
  if (!sharedAudioContext) sharedAudioContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE })
  return sharedAudioContext
}

// Samtale-fortsettelse: Live-APIets sessionResumption gir oss handles underveis;
// ny økt innen vinduet gjenopptar HELE samtalekonteksten («fortsett der vi slapp»
// etter at brukeren la på med rist). Modul-skopet — overlever LiveSession-instanser.
const RESUME_WINDOW_MS = 10 * 60_000
let lastResumeHandle: { handle: string; at: number } | null = null

// Global kø for iOS-audiosesjonens av/på: aktivering som overlapper forrige økts
// deaktivering kan «lykkes» mot en døende sesjon — økten kobler til, men mikrofon
// og høyttaler er døde og stumme (legg-på → rist-på-nytt-feilen). Retry hjelper
// ikke, for den døde aktiveringen KASTER ikke. Køen gjør overlapp fysisk umulig.
let audioSessionQueue: Promise<unknown> = Promise.resolve()
function queueAudioSessionActivity(active: boolean): Promise<void> {
  const run = async () => {
    try {
      await AudioManager.setAudioSessionActivity(active)
    } catch {
      if (!active) return // deaktivering som feiler er ufarlig
      await new Promise(r => setTimeout(r, 400))
      await AudioManager.setAudioSessionActivity(true)
    }
  }
  const next = audioSessionQueue.then(run, run)
  audioSessionQueue = next
  return next as Promise<void>
}

function wsDataToString(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer && utf8Decoder) return utf8Decoder.decode(data)
  return null
}

/**
 * Én sanntidssamtale med Gemini Live: mikrofon-PCM streames opp over WebSocket,
 * modellens tale streames ned og spilles fortløpende. Avbrytelse (barge-in) og
 * tur-taking håndteres av serverens VAD — vi gjør ingen egen stillhetsdeteksjon,
 * i motsetning til det gamle opptak-og-send-løpet i voice-session.tsx.
 *
 * Verktøykall (ordreoppslag, prosjektstatus) kjøres HER, klientsidig mot lokal
 * WatermelonDB (regel 2) — modellen ser aldri rå tabelldata, kun svaret på det
 * konkrete spørsmålet.
 */
export class LiveSession {
  private ws: WebSocket | null = null
  private recorder: AudioRecorder | null = null
  private audioContext: AudioContext | null = null
  private queueNode: AudioBufferQueueSourceNode | null = null
  private callbacks: LiveSessionCallbacks
  private routeContext: VoiceRouteContext
  private ended = false
  private gotSetupComplete = false
  private receivedModelAudio = false
  private user: CurrentUser | null = null
  private templateCatalog: TemplateCatalogEntry[] = []
  private earpiece = false
  private dueReminders: string[] = []
  private userNotes: { id: string; content: string }[] = []
  // Jitter-buffer + koalescering: Gemini streamer lyden i mange små, ujevne
  // chunks. Enkeltvis i spillekøen gir de hørbare kutt ved hver buffergrense og
  // underrun midt i setninger. Vi samler derfor rå samples i JS og sender FÅ,
  // STORE buffere til køen: første flush etter ~450ms (jitter-pute per tur),
  // deretter i ~250ms-bolker.
  private pendingFloats: Float32Array[] = []
  private pendingSamples = 0
  private primed = false
  // Nivå-gate: react-native-audio-api har INGEN ekkokansellering (voiceChat-
  // modusen setter bare AVAudioSession-mode, aldri setVoiceProcessingEnabled), så
  // mikrofonen hører høyttaleren og serverens VAD «avbryter» modellen midt i ordet.
  // Mens modellen snakker slipper vi derfor kun HØY mikrofonlyd gjennom (snakk
  // høyt/tett på telefonen for å avbryte) — ekkoet fra høyttaleren ligger lavere.
  // Én høy chunk åpner gaten i en «hangover»-periode så resten av ytringen flyter
  // til serveren og gir ekte barge-in. Terskelen trenger felttuning (jf. rist).
  private playbackEndsAtMs = 0
  private micSub: { remove: () => void } | null = null
  private resumedConversation = false

  // Klient-VAD-tilstand
  private taleStartetMs = 0
  private sistLydMs = 0
  private avbrytStartetMs = 0
  private forbuffer: Uint8Array[] = []
  private aktivitetAapen = false
  private harAek = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  // Forbruk denne økten — rapporteres i finish()
  private taleSekunder = 0
  private tokInn = 0
  private tokUt = 0

  constructor(routeContext: VoiceRouteContext, callbacks: LiveSessionCallbacks) {
    this.routeContext = routeContext
    this.callbacks = callbacks
  }

  async start(): Promise<void> {
    // Zombie-vakt via globalThis (overlever Metro Fast Refresh, i motsetning til
    // modul-variabler): en hot-update midt i en økt remounter provideren (stage →
    // idle, liveRef → null) mens den GAMLE økten lever videre frakoblet — hun
    // «nekter å stoppe», og neste rist starter økt nr. 2 oppå. Én økt, alltid.
    const g = globalThis as { __ampexLiveSession?: LiveSession }
    if (g.__ampexLiveSession && g.__ampexLiveSession !== this) {
      console.log('Live: stopper foreldreløs økt (hot reload?)')
      try {
        g.__ampexLiveSession.stop()
      } catch {}
    }
    g.__ampexLiveSession = this

    this.callbacks.onStage('connecting')

    // Rolle/navn inn i systeminstruksen + varm cache for verktøyenes tilgangssjekker.
    this.user = await getCurrentUser()
    // Skjemakatalogen (bundlede + firmaets publiserte maler) hentes ved øktstart —
    // slik «kan» modellen firmaets egne skjemaer uten ny kode per firma.
    this.templateCatalog = await listAllTemplates().catch(() => [])
    // Hukommelsen om denne montøren inn i instruksen (id-er med, så glem_notat virker).
    if (this.user) {
      this.userNotes = await database
        .get<AssistantNote>('assistant_notes')
        .query(Q.where('user_id', this.user.id), Q.sortBy('created_at', Q.asc))
        .fetch()
        .then(rows => rows.map(n => ({ id: n.id, content: n.content })))
        .catch(() => [])
    }
    // Forfalte/dagens påminnelser inn i instruksen — assistenten nevner dem i åpningen.
    if (this.user) {
      const endOfDay = new Date()
      endOfDay.setHours(23, 59, 59, 999)
      this.dueReminders = await database
        .get<Reminder>('reminders')
        .query(Q.where('user_id', this.user.id), Q.where('status', 'open'), Q.where('due_at', Q.lte(endOfDay.getTime())), Q.sortBy('due_at', Q.asc))
        .fetch()
        .then(rows => rows.map(r => r.title))
        .catch(() => [])
    }

    await this.connectSocket()
  }

  /**
   * Tokenhenting + WS-oppkobling. Egen metode fordi avvisning ved setup prøves på
   * nytt med færre antakelser — ferske engangs-tokens per forsøk. Stigen:
   *
   *   1. låst token + Google-søk
   *   2. låst token, uten søk        (kvoten på grounding er den vanlige synderen)
   *   3. ULÅST token, uten søk       (låsen selv er det siste vi mistenker)
   *
   * Trinn 3 finnes fordi en sikkerhetsherding som kan slå ut stemmen i felt ikke
   * er en herding. Vi kommer ikke lenger ned enn hit: er tokenet alt ulåst, er
   * problemet et annet, og da skal feilen SIES, ikke skjules bak flere forsøk.
   */
  private async connectSocket(opts?: { ulaast?: boolean }): Promise<void> {
    const auth = await fetchLiveToken({ ulaast: opts?.ulaast })
    if (!auth) {
      this.finish('Fikk ikke koblet til AI-tjenesten.')
      return
    }
    if ('cap' in auth) {
      // Taket er nådd. Ikke en feil — kalleren bytter til turbasert assistent.
      console.log(`Live: dagstak nådd (${auth.cap.usedSec}/${auth.cap.capSec ?? '∞'} s, tier ${auth.cap.tier})`)
      this.ended = true
      const g = globalThis as { __ampexLiveSession?: LiveSession }
      if (g.__ampexLiveSession === this) g.__ampexLiveSession = undefined
      this.callbacks.onCapHit?.(auth.cap)
      return
    }
    if (this.ended) return
    const useSearch = Date.now() >= searchQuotaBlockedUntil

    const voice = (await getPreferredVoice().catch(() => null)) ?? auth.voice
    console.log(`Live: kobler til (modell ${auth.model}, stemme ${voice ?? 'standard'})`)
    const ws = new WebSocket(`${LIVE_WS_URL}?access_token=${auth.token}`)
    this.ws = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      const resume =
        lastResumeHandle && Date.now() - lastResumeHandle.at < RESUME_WINDOW_MS
          ? { handle: lastResumeHandle.handle }
          : {}
      this.resumedConversation = 'handle' in resume
      if (this.resumedConversation) console.log('Live: gjenopptar forrige samtale')
      ws.send(
        JSON.stringify({
          setup: {
            sessionResumption: resume,
            model: `models/${auth.model}`,
            // Vår VAD, ikke Googles: se konstantene øverst. Uten dette fakturerer
            // Live hele mikrofonstrømmen, stillhet inkludert.
            realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                languageCode: 'nb-NO',
                // Personlig valg (Meg-fanen) vinner over firmastandarden fra serveren.
                ...(voice ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } : {}),
              },
            },
            systemInstruction: { parts: [{ text: this.buildSystemInstruction() }] },
            tools: useSearch ? TOOL_DECLARATIONS : TOOL_DECLARATIONS.filter(t => !('googleSearch' in t)),
          },
        }),
      )
    }
    ws.onmessage = event => {
      const text = wsDataToString(event.data)
      if (!text) return
      try {
        this.handleServerMessage(JSON.parse(text))
      } catch (e) {
        console.warn('Live: klarte ikke tolke servermelding:', e)
      }
    }
    ws.onerror = (e: any) => {
      console.warn('Live: WS-feil:', e?.message ?? e)
      this.finish('Mistet forbindelsen til AI-tjenesten.')
    }
    ws.onclose = (e: any) => {
      // Lukking FØR setupComplete = Google avviste økten (feil modell, ugyldig
      // token, avvist setup-melding) — close-koden/-grunnen er eneste spor vi får.
      console.warn(`Live: WS lukket (code=${e?.code}, reason=${e?.reason || 'ingen'})`)
      if (!this.gotSetupComplete && useSearch && !this.ended) {
        // Avvist ved setup med søkeverktøyet på: mest sannsynlig grounding-kvoten (1011),
        // men RN-WebSocket MASKERER server-close-koder — så vi prøver på nytt uten søk
        // UANSETT kode (selv-begrensende: neste forsøk har useSearch=false). Feilsøkt
        // 2026-08-13: kode-sjekk på 1011 traff aldri, retryen fyrte ikke.
        console.warn('Live: avvist ved setup — prøver på nytt uten Google-søk')
        searchQuotaBlockedUntil = Date.now() + 30 * 60_000
        void this.connectSocket()
        return
      }
      // Siste trinn: søket er alt av, og tokenet var LÅST. Da er låsen den eneste
      // antakelsen vi har igjen å fjerne. Ett forsøk, aldri flere — auth.laast er
      // false neste gang, så dette kan ikke bli en løkke.
      if (!this.gotSetupComplete && auth.laast && !this.ended) {
        console.warn('Live: avvist med låst token — prøver ulåst én gang')
        void this.connectSocket({ ulaast: true })
        return
      }
      // Kode + grunn inn i meldingen: i Release finnes ingen konsoll — assistenten
      // LESER feilen høyt, og det er eneste diagnosekanal i felt (TTS-loggtrikset).
      const detail = [e?.code, typeof e?.reason === 'string' ? e.reason.slice(0, 60) : '']
        .filter(Boolean).join(' — ')
      // Tokenet er låst til modell + lydmodus. Avvises oppsettet, er låsen den
      // mest sannsynlige nye årsaken — si det, ellers står operatøren og gjetter
      // mellom kvote, modellnavn og lås. Nødbryter: GEMINI_LIVE_UNLOCK=1.
      // Kom vi hit uten setupComplete, er BÅDE søket og låsen alt prøvd fjernet.
      // Da er årsaken noe annet — modellnavn, kvote eller nøkkel — og det er den
      // beskjeden som hjelper, ikke en peker mot låsen vi nettopp utelukket.
      const laasHint = !this.gotSetupComplete && !auth.laast ? ' Prøvd både med og uten låst token.' : ''
      this.finish(this.gotSetupComplete ? undefined : `AI-tjenesten avviste tilkoblingen${detail ? ` (${detail})` : ''}.${laasHint}`)
    }
  }

  /** Avslutt fra brukerens side (rist igjen / knapp). Trygg å kalle flere ganger. */
  stop(): void {
    this.finish()
  }


  /**
   * Lag 1 + lag 2. Se `lib/ai/instruks.ts` for hvorfor de er skilt.
   *
   * Kort: context caching er en PREFIKS-mekanisme. Da denne funksjonen limte
   * brukernavn, skjerm og påminnelser inn i den samme strengen, var hele
   * strengen unik per bruker, og det fantes ingen felles prefiks å cache —
   * uansett hvor mye statisk innhold som lå foran.
   *
   * Lag 3 (vær, aktiv ordre, påminnelser, notater) ligger IKKE her lenger. Det
   * er observasjoner, ikke regler, og de sendes som innhold i samtalen.
   */
  /**
   * Én nonce per økt. Innholdet i basen kan ikke kjenne den, og kan derfor
   * ikke lukke konvolutten sin egen og late som det som følger er systemets ord.
   * En ordre importert fra Tripletex i fjor kjenner ingen nonce fra i dag.
   */
  private readonly dataNonce = nyNonce()

  private buildSystemInstruction(): string {
    const ctx = this.routeContext
    const skjerm = ctx.screen === 'prosjekt' ? 'prosjekt' : ctx.screen === 'ordre' ? 'ordre' : 'annet'
    return [
      byggLag1(SYSTEM_INSTRUCTION),
      byggLag2({
        bruker: this.user ? { navn: this.user.name, rolle: this.user.role } : null,
        skjerm,
        maler: this.templateCatalog.map(t => ({ id: t.id, navn: t.name, kilde: t.source })),
        rettigheter: verktoyrettigheter(this.user?.role),
      }),
    ].join('\n\n')
  }

  /**
   * Lag 3 — situasjonen akkurat nå, som INNHOLD og aldri som instruks.
   *
   * Returnerer en tur som legges foran hilsenen. At den kommer som en melding
   * og ikke som en instruks er poenget: endrer været seg, kommer den nye
   * meldingen ETTER den gamle, og modellen ser rekkefølgen. Bygges instruksen
   * om i stedet, mister den at noe endret seg.
   */
  private byggSituasjon(): { role: 'user'; parts: { text: string }[] } | null {
    return byggLag3({
      paaminnelser: this.dueReminders,
      notater: this.userNotes.map(n => ({ id: n.id, innhold: n.content })),
    })
  }

  /** Telefon-mot-øret: rut lyden til ørehøyttaleren (privat, som en samtale) i stedet for speaker. */
  setEarpiece(on: boolean): void {
    if (this.earpiece === on) return
    this.earpiece = on
    if (this.audioContext) this.applyAudioSessionOptions()
  }

  private applyAudioSessionOptions(): void {
    // iosMode 'default', IKKE 'voiceChat': voiceChat legger telefonsamtale-
    // prosessering på UTGANGEN (dumpt/tett «tett nese»-klang på modellens stemme).
    // Vi trodde den ga ekkokansellering, men biblioteket aktiverer aldri det
    // (se nivå-gate-kommentaren) — modusen var kun kostnad, null gevinst.
    // playAndRecord UTEN defaultToSpeaker ruter til ørehøyttaleren — det er hele
    // earpiece-bryteren.
    // duckOthers: bakgrunnslyd (musikk/strøm) dempes under økten i stedet for en
    // sesjons-dragkamp der den andre appen til slutt STJELER sesjonen og dreper
    // både mikrofon og avspilling midt i økten.
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'default',
      iosOptions: this.earpiece
        ? ['allowBluetoothHFP', 'duckOthers']
        : ['defaultToSpeaker', 'allowBluetoothHFP', 'duckOthers'],
    })
  }

  private async startAudio(): Promise<void> {
    this.applyAudioSessionOptions()
    // Blir sesjonen likevel avbrutt (innkommende anrop, annen app tar over):
    // observer avbrudd og TA SESJONEN TILBAKE aktivt — uten dette døde økten
    // stille når en bakgrunnsstrøm spilte, og lyd/mikrofon kom aldri tilbake.
    try {
      AudioManager.observeAudioInterruptions(true)
      AudioManager.activelyReclaimSession(true)
    } catch {}
    await queueAudioSessionActivity(true)
    console.log('Live: audiosesjon aktiv')

    this.audioContext = getSharedAudioContext()
    // VEKK konteksten — ALLTID, deterministisk: den delte konteksten sovner når
    // forrige økts audiosesjon deaktiveres. Økt nr. 2+ var ellers PERFEKT i loggen
    // (tilkoblet, mottok lyd) men helt stum — enqueue mot en sovende kontekst
    // feiler lydløst. finish() suspenderer eksplisitt; her gjenopplives den.
    await this.audioContext.resume().catch(() => {})
    console.log(`Live: audiokontekst ${this.audioContext.state}`)
    this.queueNode = this.audioContext.createBufferQueueSource()
    this.queueNode.connect(this.audioContext.destination)
    // start(0, 0), IKKE start(): react-native-audio-api 0.13.2 har default offset=-1
    // som sentinel og validerer så offset >= 0 — argumentløst kall kaster alltid
    // RangeError. Eksplisitt 0-offset er semantisk likt og passerer valideringen.
    this.queueNode.start(0, 0)

    // Primærvei (iOS device): ekko-kansellert mikrofon (AmpexMicModule.swift,
    // Apples VoiceProcessingIO — samme som Gemini-appen). Hennes stemme trekkes
    // fra i HARDWARE → ingen selv-avbrytelse, full dupleks, naturlig barge-in.
    // Chunkene er ferdig PCM16@16kHz base64 — rett i realtimeInput.
    //
    // MERK at dette er et FORSØK, ikke en tilgjengelighetssjekk.
    // `isEchoCancelledMicAvailable` sier bare at modulen er KOMPILERT INN, ikke
    // at den virker her: på simulatoren er den kompilert inn, men
    // `setVoiceProcessingEnabled(true)` kaster fordi VoiceProcessingIO ikke
    // finnes der. Før 2026-08-20 drepte det hele økten med «Fikk ikke startet
    // mikrofonen» — fallbacken under, som står der NETTOPP for simulator, ble
    // aldri nådd. Nå faller vi gjennom på enhver feil, ikke bare på fravær.
    if (isEchoCancelledMicAvailable) {
      try {
        this.micSub = await startEchoCancelledMic(({ base64, rms }) => {
          if (this.ended || this.ws?.readyState !== WebSocket.OPEN) return
          this.harAek = true
          this.port(base64ToBytes(base64), rms)
        })
        console.log('Live: ekko-kansellert mikrofon aktiv')
        return
      } catch (e) {
        // Ingen AEC her — modellen vil høre seg selv. Fallbacken under demper det
        // ved å holde mikrofonen døv mens hun snakker. Dårligere, men i live.
        console.warn('Live: ekko-kansellert mikrofon utilgjengelig, faller tilbake:', e)
        this.micSub?.remove()
        this.micSub = null
      }
    }
    {
      // Fallback (simulator/Android, og enhver enhet der VoiceProcessingIO
      // svikter): bibliotekets recorder har ingen
      // AEC — mikrofonen holdes DØV mens modellen snakker, ellers avbryter hennes
      // egen høyttalerlyd henne (felt-målt 0.21–0.26 RMS, samme område som rop).
      const recorder = new AudioRecorder()
      this.recorder = recorder
      recorder.onAudioReady(
        { sampleRate: INPUT_SAMPLE_RATE, bufferLength: INPUT_CHUNK_FRAMES, channelCount: 1 },
        ({ buffer }) => {
          if (this.ended || this.ws?.readyState !== WebSocket.OPEN) return
          const samples = buffer.getChannelData(0)
          const bytes = floatToPcm16Bytes(samples)
          this.harAek = false
          this.port(bytes, rmsFraPcm16(bytes))
        },
      )
      recorder.onError(e => console.warn('Live: opptaksfeil:', e))
      await recorder.start()
    }
  }

  private handleServerMessage(msg: Record<string, any>): void {
    if (msg.setupComplete) {
      this.gotSetupComplete = true
      console.log('Live: setup OK — starter mikrofon')
      this.callbacks.onStage('active')
      this.nullstillIdle()
      this.startAudio()
        .then(() => console.log('Live: mikrofon streamer'))
        .catch(e => {
          console.warn('Live: mikrofonstart feilet:', e)
          this.finish('Fikk ikke startet mikrofonen.')
        })
      // Modellen venter ELLERS stille på at brukeren snakker først — uten en hørbar
      // hilsen virker økten død og brukeren rister den i senk. Tekst-turn her gir
      // umiddelbar talerespons og beviser samtidig hele lydkjeden ned til høyttaler.
      const situasjon = this.byggSituasjon()
      this.ws?.send(
        JSON.stringify({
          clientContent: {
            turns: [
              ...(situasjon ? [situasjon] : []),
              {
                role: 'user',
                parts: [
                  {
                    text: this.resumedConversation
                      ? 'Brukeren tok opp igjen samtalen deres. IKKE hils på nytt — fortsett der dere slapp med én kort setning.'
                      : `Økten har akkurat startet (klokka er ${new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}). ` +
                        'Hils KORT og rolig med riktig tid på døgnet — «God morgen», «God ettermiddag», «God kveld» — pluss ' +
                        'maks en HALV setning til (navnet, eller en forfalt påminnelse hvis det finnes). Ikke ramse opp hva du ' +
                        'kan, ikke lange tilbud — bare vær klar. Eksempel: «God morgen, Tormod.»',
                  },
                ],
              },
            ],
            turnComplete: true,
          },
        }),
      )
      return
    }

    const content = msg.serverContent
    if (content) {
      if (content.interrupted) {
        // Barge-in: brukeren snakket i munnen på modellen — kutt avspillingen NÅ.
        // (Logges også for å skille ekte/falske avbrytelser fra avspillingshakk:
        // hyppige avbrudd her mens brukeren er STILLE = mikrofonen hører høyttaleren.)
        console.log('Live: avbrutt (barge-in)')
        this.pendingFloats = []
        this.pendingSamples = 0
        this.primed = false
        this.playbackEndsAtMs = 0
        this.queueNode?.clearBuffers()
      }
      const parts: Record<string, any>[] = content.modelTurn?.parts ?? []
      for (const part of parts) {
        const inline = part.inlineData
        if (inline?.data && typeof inline.data === 'string') {
          if (!this.receivedModelAudio) {
            this.receivedModelAudio = true
            console.log('Live: mottar lyd fra modellen')
          }
          this.enqueueAudio(inline.data)
        }
      }
      if (content.turnComplete) {
        // Kort ytring som aldri nådde buffer-terskelen: spill det vi har. Og
        // nullstill primingen så NESTE tur også får jitter-pute foran seg.
        this.flushPending()
        this.primed = false
      }
    }

    // Forbruk: Google sender usageMetadata fortløpende med modalitet per post.
    // Vi summerer bare AUDIO — tekst (verktøykall) er øre og telles ikke mot taket.
    const um = msg.usageMetadata
    if (um) {
      for (const d of um.promptTokensDetails ?? []) if (d.modality === 'AUDIO') this.tokInn = Math.max(this.tokInn, um.promptTokenCount ?? 0)
      for (const d of um.responseTokensDetails ?? []) if (d.modality === 'AUDIO') this.tokUt = Math.max(this.tokUt, um.responseTokenCount ?? 0)
    }

    if (msg.toolCall?.functionCalls) {
      this.handleToolCalls(msg.toolCall.functionCalls)
    }

    // Fortløpende gjenopptagelses-handles — nyeste vinner, brukes av NESTE økt.
    const update = msg.sessionResumptionUpdate
    if (update?.resumable && typeof update.newHandle === 'string' && update.newHandle) {
      lastResumeHandle = { handle: update.newHandle, at: Date.now() }
    }
  }

  private static readonly JITTER_BUFFER_MS = 450
  private static readonly COALESCE_MS = 250

  private enqueueAudio(base64: string): void {
    const samples = pcm16Base64ToFloat32(base64)
    if (samples.length === 0) return
    this.pendingFloats.push(samples)
    this.pendingSamples += samples.length
    const pendingMs = this.pendingSamples / (OUTPUT_SAMPLE_RATE / 1000)
    if (!this.primed) {
      if (pendingMs < LiveSession.JITTER_BUFFER_MS) return
      this.primed = true
    } else if (pendingMs < LiveSession.COALESCE_MS) {
      return
    }
    this.flushPending()
  }

  private flushPending(): void {
    if (this.ended || !this.audioContext || !this.queueNode || this.pendingSamples === 0) return
    const merged = new Float32Array(this.pendingSamples)
    let offset = 0
    for (const chunk of this.pendingFloats) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.pendingFloats = []
    this.pendingSamples = 0
    try {
      const buffer = this.audioContext.createBuffer(1, merged.length, OUTPUT_SAMPLE_RATE)
      buffer.copyToChannel(merged, 0)
      this.queueNode.enqueueBuffer(buffer)
      // Bokfør når avspillingen (samlet kø) er ferdig — styrer mikrofon-gaten over.
      const durationMs = merged.length / (OUTPUT_SAMPLE_RATE / 1000)
      this.playbackEndsAtMs = Math.max(Date.now(), this.playbackEndsAtMs) + durationMs
    } catch (e) {
      console.warn('Live: klarte ikke legge lyd i kø:', e)
    }
  }

  private async handleToolCalls(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]): Promise<void> {
    const responses = []
    for (const call of calls) {
      const response = await runTool(
        {
          callbacks: this.callbacks,
          templateCatalog: this.templateCatalog,
          routeContext: this.routeContext,
        },
        call.name ?? '',
        call.args ?? {},
      )
      responses.push({ id: call.id, name: call.name, response })
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }))
    }
  }

  // ------------------------------------------------------------ klient-VAD

  /**
   * Alt fra mikrofonen går gjennom her. Sender BARE tale videre, innrammet av
   * activityStart/activityEnd, og holder et lite forbuffer så første stavelse
   * ikke går tapt. Mens modellen snakker gjelder barge-in-regelen i stedet.
   */
  private port(bytes: Uint8Array, rms: number): void {
    const na = Date.now()
    const modellSnakker = na < this.playbackEndsAtMs
    emitVoiceLevel({ level: rms, modelSpeaking: modellSnakker })

    if (modellSnakker && !this.aktivitetAapen) {
      this.vurderAvbrytelse(bytes, rms, na)
      return
    }

    const erTale = rms > TALE_RMS

    if (!this.aktivitetAapen) {
      this.forbuffer.push(bytes)
      if (this.forbuffer.length > FORBUFFER_BITER) this.forbuffer.shift()
      if (!erTale) return
      this.aapneAktivitet(na)
      for (const b of this.forbuffer) this.sendLyd(b)
      this.forbuffer = []
      return
    }

    this.sendLyd(bytes)
    if (erTale) this.sistLydMs = na

    const forLenge = na - this.taleStartetMs > MAKS_TALE_MS
    const stille = na - this.sistLydMs >= STILLE_MS
    if ((forLenge || stille) && na - this.taleStartetMs >= MIN_TALE_MS) this.sendAktivitetSlutt()
  }

  private vurderAvbrytelse(bytes: Uint8Array, rms: number, na: number): void {
    // Uten AEC er lyd fra mikrofonen stort sett vår egen høyttaler — da tolkes
    // ingenting som avbrytelse, ellers avbryter hun seg selv hver gang.
    if (!this.harAek) return
    if (rms <= TALE_RMS) {
      this.avbrytStartetMs = 0
      this.forbuffer = []
      return
    }
    this.forbuffer.push(bytes)
    if (this.forbuffer.length > FORBUFFER_BITER * 2) this.forbuffer.shift()
    if (this.avbrytStartetMs === 0) {
      this.avbrytStartetMs = na
      return
    }
    if (na - this.avbrytStartetMs < AVBRYT_MS) return
    // Ekte avbrytelse: åpne aktivitet MED lyden fra før vi bestemte oss.
    // Serveren svarer med `interrupted` og kutter sin egen tale.
    console.log('Live: brukeren avbrøt')
    this.aapneAktivitet(this.avbrytStartetMs)
    for (const b of this.forbuffer) this.sendLyd(b)
    this.forbuffer = []
    this.avbrytStartetMs = 0
  }

  private aapneAktivitet(na: number): void {
    this.aktivitetAapen = true
    this.taleStartetMs = na
    this.sistLydMs = na
    this.ws?.send(JSON.stringify({ realtimeInput: { activityStart: {} } }))
    this.nullstillIdle()
  }

  private sendAktivitetSlutt(): void {
    if (!this.aktivitetAapen) return
    this.aktivitetAapen = false
    this.taleSekunder += (Date.now() - this.taleStartetMs) / 1000
    this.ws?.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }))
    this.nullstillIdle()
  }

  private sendLyd(bytes: Uint8Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(
      JSON.stringify({
        realtimeInput: { audio: { mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`, data: bytesToBase64(bytes) } },
      }),
    )
  }

  private nullstillIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      console.log('Live: ingen tale på tre minutter — lukker økten')
      this.finish()
    }, IDLE_MS)
  }

  private finish(error?: string): void {
    if (this.ended) return
    this.ended = true
    // Alle øktdødsfall skal ha en logglinje — tause avslutninger kostet oss timer.
    console.log(`Live: økt avsluttet${error ? ` (${error})` : ''}`)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.aktivitetAapen) this.sendAktivitetSlutt()
    // Fyr-og-glem. Aldri await her: finish() må være synkron og aldri feile.
    if (this.taleSekunder > 0 || this.tokUt > 0) {
      reportVoiceUsage({ speechSec: this.taleSekunder, inTok: this.tokInn, outTok: this.tokUt })
      console.log(`Live: forbruk ${Math.round(this.taleSekunder)} s egen tale, ${this.tokInn} tok inn, ${this.tokUt} tok ut`)
    }
    const g = globalThis as { __ampexLiveSession?: LiveSession }
    if (g.__ampexLiveSession === this) g.__ampexLiveSession = undefined
    this.pendingFloats = []
    this.pendingSamples = 0
    emitVoiceLevel({ level: 0, modelSpeaking: false })

    try {
      this.micSub?.remove()
    } catch {}
    this.micSub = null
    try {
      this.recorder?.clearOnAudioReady()
      this.recorder?.stop()
    } catch {}
    this.recorder = null

    // Konteksten er DELT og lukkes aldri (se getSharedAudioContext) — kun økt-
    // noden stoppes/kobles fra. Avbrudds-observasjon og reclaim slås av så
    // biblioteket ikke fortsetter å kjempe om sesjonen etter at vi ga den fra oss.
    try {
      this.queueNode?.stop(0)
      ;(this.queueNode as unknown as { disconnect?: () => void })?.disconnect?.()
    } catch {}
    // Eksplisitt suspend → neste økts resume() er en deterministisk vekking i
    // stedet for gjetting på state-flagget (som kan være usynkront med native).
    void this.audioContext?.suspend().catch(() => {})
    this.queueNode = null
    this.audioContext = null
    try {
      AudioManager.observeAudioInterruptions(false)
      AudioManager.activelyReclaimSession(false)
    } catch {}
    void queueAudioSessionActivity(false)

    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        ws.close()
      } catch {}
    }

    this.callbacks.onEnd(error)
  }
}
