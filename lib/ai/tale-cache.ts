import { AudioContext, type AudioBufferSourceNode } from 'react-native-audio-api'
import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from '../supabase'
import { base64ToBytes, wavBase64FromPcm16 } from './pcm'
import { speak, stopSpeaking } from './voice-speaker'

/**
 * Talecache: samme setning syntetiseres ÉN gang, i hele verden, for alltid.
 *
 * Trelagsmodell, i fallende rekkefølge:
 *   A. Lokal fil  — ~10 ms, gratis, den gode stemmen
 *   B. R2         — én nedlasting, så er den lokal for alltid
 *   C. Systemstemmen (expo-speech) — umiddelbar, alltid tilgjengelig, litt stivere
 *
 * Poenget er at C ALDRI får brukeren til å vente. Ved cachebom snakker
 * systemstemmen med en gang, mens R2-oppslaget og eventuell rendring skjer i
 * bakgrunnen. Neste gang noen sier den setningen — hvem som helst, hvilket som
 * helst firma — er den i lag A. Cachen varmer seg selv, og kvaliteten stiger
 * jo mer appen brukes.
 *
 * Det er dette som gjør at malene i lib/ai/tale-maler.ts er verdt noe: bit-
 * identiske setninger er det samme som treff.
 */

const MAPPE = `${FileSystem.cacheDirectory}tale/`

/** Bumpes hvis stemmen byttes — gamle klipp er da feil stemme, ikke feil tekst. */
const STEMME_REV = 'v1'

let mappeKlar = false
let spiller: AudioBufferSourceNode | null = null

/**
 * ÉN delt AudioContext for appens levetid — samme regel som LiveSession lærte
 * den harde veien: per-avspilling create/close lekker native lydenheter, og en
 * kontekst som har sovnet spiller lydløst uten å feile.
 *
 * Vi bruker react-native-audio-api og IKKE expo-audio her, av to grunner funnet
 * på ekte enhet: expo-audios spiller var merkbart lavere enn Live var på samme
 * telefon, og `play()` rett etter `createAudioPlayer()` gjorde ingenting fordi
 * fila ikke var lastet — uten at noe feilet, og uten at ferdig-callbacken fyrte.
 */
let ctx: AudioContext | null = null
function lydKontekst(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

/**
 * 64-bits FNV-1a som to 32-bits halvdeler.
 *
 * Ikke krypto — bare en cache-nøkkel. Men 32 bit alene hadde vært for lite:
 * med noen titusen setninger i omløp er kollisjonssjansen reell (bursdags-
 * paradokset), og en kollisjon her betyr at assistenten sier feil setning med
 * full selvtillit. 64 bit gjør det umulig i praksis.
 */
function nokkel(tekst: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  return `${STEMME_REV}-${h1.toString(36)}${h2.toString(36)}`
}

async function sikreMappe(): Promise<void> {
  if (mappeKlar) return
  const info = await FileSystem.getInfoAsync(MAPPE)
  if (!info.exists) await FileSystem.makeDirectoryAsync(MAPPE, { intermediates: true })
  mappeKlar = true
}

function lokalSti(n: string): string {
  return `${MAPPE}${n}.wav`
}

/**
 * Leser opp en setning. Løser når lyden er ferdig — eller med en gang hvis
 * ingenting kunne spilles.
 *
 * Kaster aldri. En feilende cache skal degradere til systemstemmen, ikke til
 * stillhet: en assistent som tier fordi en nedlasting feilet er verre enn en
 * assistent med litt stiv stemme.
 */
export async function siSetning(tekst: string, opts?: { onDone?: () => void }): Promise<void> {
  const ferdig = () => opts?.onDone?.()

  try {
    await sikreMappe()
    const n = nokkel(tekst)
    const sti = lokalSti(n)
    const info = await FileSystem.getInfoAsync(sti)

    if (info.exists) {
      void spillFil(sti, tekst, ferdig)
      return
    }

    // Bom. Snakk NÅ med systemstemmen, og hent den gode versjonen i bakgrunnen
    // til neste gang. Brukeren venter aldri på nettverket for å få et svar.
    speak(tekst, { onDone: ferdig, onError: ferdig })
    void hentEllerRendre(tekst, n).catch(e => console.warn('Tale: bakgrunnshenting feilet:', e))
  } catch (e) {
    console.warn('Tale: cache utilgjengelig, bruker systemstemmen:', e)
    speak(tekst, { onDone: ferdig, onError: ferdig })
  }
}

/**
 * Legger en setning i cachen uten å spille den. Brukes av forvarmingen
 * (lib/ai/tale-forvarm.ts).
 *
 * Returnerer true hvis den faktisk ble hentet eller rendret nå, false hvis den
 * allerede lå der — så forvarmingen kan si hvor mye den gjorde.
 */
export async function forhandsrendre(tekst: string): Promise<boolean> {
  await sikreMappe()
  const n = nokkel(tekst)
  if ((await FileSystem.getInfoAsync(lokalSti(n))).exists) return false
  await hentEllerRendre(tekst, n)
  return (await FileSystem.getInfoAsync(lokalSti(n))).exists
}

export async function stoppTale(): Promise<void> {
  stoppAvspilling()
  await stopSpeaking()
}

async function spillFil(sti: string, tekst: string, onDone: () => void): Promise<void> {
  stoppAvspilling()
  try {
    const c = lydKontekst()
    // Konteksten sovner når audiosesjonen deaktiveres. Uten resume er avspilling
    // helt stum — og feiler lydløst, som er det verste feilmodus vi har.
    await c.resume().catch(() => {})
    const buffer = await c.decodeAudioData(sti)
    const kilde = c.createBufferSource()
    kilde.buffer = buffer
    kilde.connect(c.destination)
    kilde.onEnded = () => {
      if (spiller === kilde) spiller = null
      onDone()
    }
    spiller = kilde
    // start(0, 0) og ikke start(): biblioteket har offset=-1 som sentinel og
    // validerer så offset >= 0, så argumentløst kall kaster alltid RangeError.
    kilde.start(0, 0)
  } catch (e) {
    console.warn('Tale: avspilling feilet, bruker systemstemmen:', e)
    speak(tekst, { onDone, onError: onDone })
  }
}

function stoppAvspilling(): void {
  try {
    spiller?.stop(0)
  } catch {}
  spiller = null
}

/**
 * Bakgrunnsjobben: hent fra R2, ellers rendre og legg den DER for de neste.
 *
 * Rekkefølgen er ikke likegyldig. R2 spørres først fordi cachen er delt på tvers
 * av firma — setningene er de samme, så første montør som sier «La 10 meter PN
 * 3x2,5 på ordre 1042» betaler rendringen for alle andre som sier det siden.
 *
 * Rendringen skjer på serveren (nøkkelen bor der), men OPPLASTINGEN gjøres av
 * klienten med en signert PUT. Det er med vilje: R2-hemmelighetene bor kun i
 * r2-sign, og den grensen skal ikke brytes for å spare et rundturskall.
 */
async function hentEllerRendre(tekst: string, n: string): Promise<void> {
  const r2Key = `tale/${n}.wav`
  const sti = lokalSti(n)

  const hentUrl = await signertUrl(r2Key, 'get')
  if (hentUrl) {
    const res = await FileSystem.downloadAsync(hentUrl, sti).catch(() => null)
    if (res && res.status === 200) return
    // 404: ingen har bedt om denne setningen før. Slett den tomme fila
    // nedlastingen la igjen — ellers ser neste oppslag den som et treff og
    // spiller null sekunder lyd, som er verre enn systemstemmen.
    await FileSystem.deleteAsync(sti, { idempotent: true }).catch(() => {})
  }

  const { data, error } = await supabase.functions.invoke('ai-voice', {
    body: { mode: 'tale', routeContext: 'tale', text: tekst },
  })
  const svar = data as { lyd?: unknown; rate?: unknown; error?: string } | null
  if (error || typeof svar?.lyd !== 'string') {
    console.warn('Tale: rendring feilet:', error?.message ?? svar?.error)
    return
  }

  // Gemini TTS gir rå PCM16 uten header. Raten kommer fra serveren, ikke fra en
  // konstant her — hardkodet to steder blir de før eller siden ulike, og da
  // spiller klippet av i feil tempo uten at noe feiler.
  const rate = typeof svar.rate === 'number' ? svar.rate : 24000
  const wav = wavBase64FromPcm16([base64ToBytes(svar.lyd)], rate)
  await FileSystem.writeAsStringAsync(sti, wav, { encoding: FileSystem.EncodingType.Base64 })

  const leggUrl = await signertUrl(r2Key, 'put')
  if (!leggUrl) return
  await FileSystem.uploadAsync(leggUrl, sti, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  }).catch(e => console.warn('Tale: opplasting til R2 feilet:', e))
}

async function signertUrl(key: string, method: 'get' | 'put'): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('r2-sign', { body: { key, method } })
  if (error || typeof data?.url !== 'string') return null
  return data.url
}
