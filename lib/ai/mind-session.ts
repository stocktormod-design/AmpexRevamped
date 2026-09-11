import { AudioManager, AudioRecorder } from 'react-native-audio-api'
import { isEchoCancelledMicAvailable, startEchoCancelledMic } from '../../modules/ampex-splat'
import type { Order } from '../db/models/order'
import { loadAssistantContext, runMindTurn, type AssistantContext } from './mind'
import { base64ToBytes, floatToPcm16Bytes, rmsFraPcm16, wavBase64FromPcm16 } from './pcm'
import { emitVoiceLevel } from './voice-level'
import { siSetning, stoppTale } from './tale-cache'
import { forvarmTalecache } from './tale-forvarm'
import { komponerSvar } from './tale-maler'
import type { VoiceRouteContext } from './voice-drafts'

/**
 * Turbasert samtaleøkt — erstatteren for LiveSession.
 *
 * Speiler LiveSessions grensesnitt med vilje (`start`/`stop`, samme callbacks),
 * så bytte av motor i voice-session.tsx er én linje og ikke en omskriving av UI-et.
 *
 * Forskjellen fra Live er hvor turtakingen bor. Live lot Google bestemme når du
 * var ferdig å snakke; her gjør telefonen det, og sender ETT klipp når du faktisk
 * er ferdig. Det er billigere, men det flytter også ansvaret: er endepunkt-
 * deteksjonen dårlig, føles hele assistenten dårlig, uansett hvor god modellen er.
 */

const SAMPLE_RATE = 16000

/**
 * Terskler for turtaking. ENERGIBASERT — dette er den midlertidige versjonen.
 *
 * Neste steg bytter dette mot Smart Turn v3.1, som hører på intonasjon og nøling
 * i stedet for volum, og dermed vet forskjell på «jeg tenker» og «jeg er ferdig».
 * Grensesnittet er med vilje smalt (`vurderEndepunkt`) så byttet blir isolert.
 *
 * 800 ms er ikke tilfeldig: det er Pipecats standardport, empirisk tunet mot en
 * stor brukerbase. Den gamle veien i voice-session.tsx ventet 3000 ms — det er
 * grunnen til at den aldri kunne føles levende, ikke modellen.
 */
const TALE_RMS = 0.02
const STILLE_MS = 800
const MIN_TALE_MS = 300
const MAKS_TALE_MS = 20_000

/**
 * Hvor lenge brukeren må snakke mens assistenten snakker før vi tolker det som
 * en avbrytelse.
 *
 * Dette tallet er det viktigste i fila. I 30 timer opptak backchannelet folk sju
 * ganger oftere enn de faktisk avbrøt — så en ren energiterskel stopper
 * assistenten hver gang noen sier «mm», og det oppleves som at den er nervøs.
 * 400 ms slipper de korte kvitteringene gjennom uten å reagere, og fanger enhver
 * ekte korreksjon («nei, det var tolv meter»), som alltid er lengre.
 */
const AVBRYT_MS = 400

/** Lyd vi holder på FØR tale ble oppdaget, så avbrytelsens første ord ikke går tapt. */
const FORBUFFER_BITER = 4

export type MindStage = 'connecting' | 'active'

export type MindSessionCallbacks = {
  onStage: (stage: MindStage) => void
  onEnd: (error?: string) => void
  onOrderFound?: (order: Order) => void
  onOpenForm?: (orderId: string, templateId: string) => void
  onNavigate?: (path: string) => void
}

type Tilstand = 'lytter' | 'tenker' | 'snakker'

export class MindSession {
  private ended = false
  private tilstand: Tilstand = 'lytter'
  private earpiece = false

  private micSub: { remove: () => void } | null = null
  private recorder: AudioRecorder | null = null
  /** Sant kun når mikrofonen er ekko-kansellert i maskinvare. Styrer om barge-in er mulig. */
  private harAek = false

  private ctx: AssistantContext | null = null
  private historikk: Record<string, unknown>[] = []

  /** Lyd for turen som bygges nå. */
  private biter: Uint8Array[] = []
  private forbuffer: Uint8Array[] = []
  private taleStartetMs = 0
  private sistLydMs = 0
  private avbrytStartetMs = 0

  private turAvbryter: AbortController | null = null

  constructor(
    private routeContext: VoiceRouteContext,
    private callbacks: MindSessionCallbacks,
  ) {}

  async start(): Promise<void> {
    // Zombie-vakt via globalThis (overlever Metro Fast Refresh, i motsetning til
    // modul-variabler): en hot-update midt i en økt remounter provideren (stage →
    // idle, assistentRef → null) mens den GAMLE økten lever videre frakoblet — og
    // holder mikrofonen. Neste rist ville startet økt nr. 2 oppå, med to
    // mikrofoner som begge fyrer av turer. Én økt, alltid.
    const g = globalThis as { __ampexMindSession?: MindSession }
    if (g.__ampexMindSession && g.__ampexMindSession !== this) {
      console.log('Mind: stopper foreldreløs økt (hot reload?)')
      try {
        g.__ampexMindSession.stop()
      } catch {}
    }
    g.__ampexMindSession = this

    this.callbacks.onStage('connecting')
    try {
      // Konteksten hentes ÉN gang per økt, ikke per tur: katalogen og hukommelsen
      // endrer seg ikke midt i en samtale, og å bygge dem på nytt ville brutt
      // Geminis implisitte cache uten å gi modellen noe nytt.
      this.ctx = await loadAssistantContext(this.routeContext)
      // Fyller cachen med de vanligste setningene i bakgrunnen. Ikke ventet på:
      // den første økten skal ikke bli tregere av at den varmer opp for de neste.
      void forvarmTalecache()
      await this.startMic()
      if (this.ended) return
      this.callbacks.onStage('active')
    } catch (e) {
      this.finish(e instanceof Error ? e.message : 'Fikk ikke startet assistenten.')
    }
  }

  stop(): void {
    this.finish()
  }

  /**
   * Øre-privat lyd: løftes telefonen mot øret midt i en økt, flyttes lyden til
   * ørehøyttaleren. Hele bryteren er om `defaultToSpeaker` står i sesjons-
   * opsjonene — `playAndRecord` UTEN den ruter til øret.
   *
   * Virker uendret fra LiveSession selv om avspillingen nå veksler mellom
   * cachefil og systemstemme: dette er iOS' audiosesjon, ikke avspilleren.
   */
  setEarpiece(on: boolean): void {
    if (this.earpiece === on) return
    this.earpiece = on
    this.applyAudioSessionOptions()
  }

  private applyAudioSessionOptions(): void {
    // duckOthers: bakgrunnslyd dempes i stedet for en sesjons-dragkamp der den
    // andre appen til slutt STJELER sesjonen og dreper mikrofonen midt i økten.
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'default',
      iosOptions: this.earpiece
        ? ['allowBluetoothHFP', 'duckOthers']
        : ['defaultToSpeaker', 'allowBluetoothHFP', 'duckOthers'],
    })
  }

  // ---------------------------------------------------------------- mikrofon

  private async startMic(): Promise<void> {
    this.applyAudioSessionOptions()

    // Samme stige som LiveSession, og av samme grunn: `isEchoCancelledMicAvailable`
    // sier bare at modulen er kompilert inn, ikke at den virker her. På simulator
    // er den kompilert inn men kaster ved oppstart. Derfor FORSØK, ikke sjekk.
    if (isEchoCancelledMicAvailable) {
      try {
        this.micSub = await startEchoCancelledMic(({ base64, rms }) => {
          if (this.ended) return
          this.behandleBit(base64ToBytes(base64), rms)
        })
        this.harAek = true
        console.log('Mind: ekko-kansellert mikrofon aktiv')
        return
      } catch (e) {
        console.warn('Mind: ekko-kansellert mikrofon utilgjengelig, faller tilbake:', e)
        this.micSub?.remove()
        this.micSub = null
      }
    }

    // Uten AEC hører mikrofonen høyttaleren. Da er barge-in umulig — vi holder
    // mikrofonen døv mens assistenten snakker i stedet. Dårligere samtale, men
    // et alternativ til at den avbryter seg selv på hvert eneste svar.
    const recorder = new AudioRecorder()
    this.recorder = recorder
    this.harAek = false
    recorder.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: 1600, channelCount: 1 }, ({ buffer }) => {
      if (this.ended) return
      const bytes = floatToPcm16Bytes(buffer.getChannelData(0))
      this.behandleBit(bytes, rmsFraPcm16(bytes))
    })
    recorder.start()
  }

  // ------------------------------------------------------------ turtakingen

  private behandleBit(bytes: Uint8Array, rms: number): void {
    const na = Date.now()
    emitVoiceLevel({ level: rms, modelSpeaking: this.tilstand === 'snakker' })

    if (this.tilstand !== 'lytter') {
      this.vurderAvbrytelse(rms, na, bytes)
      return
    }

    const erTale = rms > TALE_RMS

    if (this.taleStartetMs === 0) {
      // Ikke begynt ennå: hold et lite rullende vindu, så første stavelse er med
      // når vi først oppdager tale.
      this.forbuffer.push(bytes)
      if (this.forbuffer.length > FORBUFFER_BITER) this.forbuffer.shift()
      if (!erTale) return
      this.biter = [...this.forbuffer]
      this.forbuffer = []
      this.taleStartetMs = na
      this.sistLydMs = na
      return
    }

    this.biter.push(bytes)
    if (erTale) this.sistLydMs = na

    if (this.vurderEndepunkt(na)) void this.sendTur()
  }

  /**
   * Er brukeren ferdig å snakke?
   *
   * ENESTE stedet turtakingen avgjøres — Smart Turn erstatter kroppen her uten at
   * noe annet i fila endres.
   */
  private vurderEndepunkt(na: number): boolean {
    if (na - this.taleStartetMs > MAKS_TALE_MS) return true
    return na - this.sistLydMs >= STILLE_MS
  }

  private vurderAvbrytelse(rms: number, na: number, bytes: Uint8Array): void {
    // Uten AEC er «lyd fra mikrofonen» stort sett vår egen høyttaler. Å tolke det
    // som avbrytelse ville betydd at assistenten avbryter seg selv hver gang.
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

    // Ekte avbrytelse. Stopp alt som pågår og start turen på nytt — MED lyden
    // fra før vi bestemte oss, ellers mister vi ordene som utløste avbruddet.
    console.log('Mind: brukeren avbrøt')
    this.turAvbryter?.abort()
    this.turAvbryter = null
    void stoppTale()
    this.tilstand = 'lytter'
    this.biter = [...this.forbuffer]
    this.forbuffer = []
    this.taleStartetMs = this.avbrytStartetMs
    this.sistLydMs = na
    this.avbrytStartetMs = 0
  }

  // ------------------------------------------------------------------- turen

  private async sendTur(): Promise<void> {
    const varighetMs = this.sistLydMs - this.taleStartetMs
    const biter = this.biter

    this.biter = []
    this.taleStartetMs = 0
    this.sistLydMs = 0

    // For kort til å være noe: en dør, et hosteanfall, en drill i naborommet.
    // Kaster stille og fortsetter å lytte — å svare på støy er verre enn å tie.
    if (varighetMs < MIN_TALE_MS || biter.length === 0) return

    if (!this.ctx || this.ended) return

    this.tilstand = 'tenker'
    const avbryter = new AbortController()
    this.turAvbryter = avbryter

    const resultat = await runMindTurn({
      ctx: this.ctx,
      callbacks: {
        onOrderFound: this.callbacks.onOrderFound,
        onOpenForm: this.callbacks.onOpenForm,
        onNavigate: this.callbacks.onNavigate,
      },
      audio: { base64: wavBase64FromPcm16(biter, SAMPLE_RATE), mimeType: 'audio/wav' },
      historikk: this.historikk,
      avbryt: avbryter.signal,
    })

    if (this.ended) return
    if (this.turAvbryter !== avbryter) return // brukeren avbrøt — et nyere opptak gjelder
    this.turAvbryter = null

    if (!resultat.ok) {
      if (resultat.grunn === 'avbrutt') return
      this.tilstand = 'lytter'
      this.siOgLytt(
        resultat.grunn === 'network' || resultat.grunn === 'timeout'
          ? 'Jeg mistet nettet. Si det en gang til når du har dekning.'
          : 'Det gikk ikke. Prøv å si det på nytt.',
      )
      return
    }

    this.historikk = resultat.historikk
    console.log(
      `Mind: tur ferdig — ${resultat.utfoerte.length} verktøy, ` +
        `${resultat.bruk.inn} inn (${resultat.bruk.cachet} cachet), ${resultat.bruk.ut} ut`,
    )

    // Lokalt komponert bekreftelse vinner over modellens egen prosa: den er
    // bit-identisk hver gang og treffer derfor talecachen. Modellen tar turen
    // kun når malene ikke dekker den (spørsmål, oppklaringer, oppfølging).
    const si = komponerSvar(resultat.utfoerte) ?? resultat.si
    if (si) this.siOgLytt(si)
    else this.tilstand = 'lytter'
  }

  private siOgLytt(tekst: string): void {
    this.tilstand = 'snakker'
    void siSetning(tekst, {
      onDone: () => {
        if (this.ended) return
        // Kun tilbake til 'lytter' hvis vi fortsatt ER den som snakker: en
        // barge-in underveis har allerede satt tilstanden, og skal ikke overkjøres.
        if (this.tilstand === 'snakker') this.tilstand = 'lytter'
      },
    })
  }

  // ------------------------------------------------------------------ slutt

  private finish(error?: string): void {
    if (this.ended) return
    this.ended = true
    console.log(`Mind: økt avsluttet${error ? ` (${error})` : ''}`)

    const g = globalThis as { __ampexMindSession?: MindSession }
    if (g.__ampexMindSession === this) g.__ampexMindSession = undefined

    this.turAvbryter?.abort()
    this.turAvbryter = null
    void stoppTale()

    try {
      this.micSub?.remove()
    } catch (e) {
      console.warn('Mind: klarte ikke stoppe mikrofonen:', e)
    }
    this.micSub = null

    try {
      this.recorder?.stop()
    } catch (e) {
      console.warn('Mind: klarte ikke stoppe recorder:', e)
    }
    this.recorder = null

    emitVoiceLevel({ level: 0, modelSpeaking: false })
    this.callbacks.onEnd(error)
  }
}
