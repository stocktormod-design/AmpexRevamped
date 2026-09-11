/**
 * PCM- og base64-hjelpere for taleflyten.
 *
 * Håndrullet fordi React Native ikke har `Buffer` eller `atob`/`btoa` som
 * håndterer binærdata trygt. Samme grunn som i lib/ai/live-session.ts — men her
 * jobber vi med BYTES, ikke Float32: den ekko-kansellerte mikrofonen leverer
 * ferdig PCM16LE base64, og en samtaletur er bare de bitene skjøtt sammen med
 * en WAV-header foran.
 */

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const BASE64_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < BASE64_CHARS.length; i++) table[BASE64_CHARS.charCodeAt(i)] = i
  return table
})()

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += BASE64_CHARS[b0 >> 2]
    out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : '='
  }
  return out
}

export function base64ToBytes(b64: string): Uint8Array {
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
  return bytes
}

/** Float32-samples [-1,1] → PCM16LE-bytes. Fallback-mikrofonen leverer floats. */
export function floatToPcm16Bytes(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    const v = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    const int = v | 0
    bytes[i * 2] = int & 0xff
    bytes[i * 2 + 1] = (int >> 8) & 0xff
  }
  return bytes
}

/**
 * Skjøter PCM16LE-biter til én WAV og returnerer den som base64.
 *
 * WAV og ikke rå PCM fordi Gemini da får samplingsrate og kanaltall fra fila
 * selv. Rå `audio/pcm` krever at raten oppgis riktig i mimeType, og en feil der
 * gir ikke en feilmelding — den gir en modell som hører deg snakke i feil tempo
 * og transkriberer tilsvarende. 44 bytes header er billig forsikring.
 */
export function wavBase64FromPcm16(chunks: Uint8Array[], sampleRate: number): string {
  let dataLength = 0
  for (const c of chunks) dataLength += c.length

  const out = new Uint8Array(44 + dataLength)
  const view = new DataView(out.buffer)

  const skrivTekst = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
  }

  skrivTekst(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  skrivTekst(8, 'WAVE')
  skrivTekst(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM-blokkens lengde
  view.setUint16(20, 1, true) // format 1 = PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate: rate * kanaler * bytes per sample
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  skrivTekst(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }

  return bytesToBase64(out)
}

/** RMS over PCM16LE-bytes. Brukes når mikrofonen ikke gir oss nivået selv. */
export function rmsFraPcm16(bytes: Uint8Array): number {
  const n = bytes.length >> 1
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
    const s = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000
    sum += s * s
  }
  return Math.sqrt(sum / n)
}
