import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { callAiVoice } from '../ai/gemini-client'
import { normaliserImport, type Importresultat } from './import'

/**
 * Fra fil på telefonen til et redigerbart utkast. Holder skjermen tynn: alt som
 * kan feile (filvalg, lesing, nettverk, modellsvar) håndteres her, og skjermen
 * får enten et resultat eller én setning den kan vise.
 */

/** Rå filstørrelse vi slipper gjennom. Base64 legger på en tredel, og
 *  edge-funksjonen stopper på 12 MB — vi vil si fra FØR opplastingen, ikke etter. */
const MAKS_BYTES = 8 * 1024 * 1024

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  webp: 'image/webp',
}

export type Valgtfil = { uri: string; navn: string; mimeType: string; bytes: number }

/**
 * PDF eller bilde. Bilde er med fordi et skjema like ofte finnes som et
 * telefonbilde av et papirark som det finnes som fil — og fotoveien går gjennom
 * Filer-appen, så vi slipper en ny avhengighet og et nytt dev-build for å ta
 * imot den.
 */
export async function velgSkjemafil(): Promise<Valgtfil | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
  })
  if (res.canceled || !res.assets?.[0]) return null
  const a = res.assets[0]
  const endelse = (a.name ?? '').split('.').pop()?.toLowerCase() ?? ''
  const mimeType = a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : (MIME[endelse] ?? 'application/pdf')
  return { uri: a.uri, navn: a.name ?? 'skjema', mimeType, bytes: a.size ?? 0 }
}

export type Lesetilstand =
  | { ok: true; resultat: Importresultat }
  | { ok: false; feil: string }

export async function lesSkjemafil(fil: Valgtfil): Promise<Lesetilstand> {
  if (fil.bytes > MAKS_BYTES) {
    return {
      ok: false,
      feil: `Fila er ${(fil.bytes / 1024 / 1024).toFixed(1)} MB. Grensen er 8 MB — lagre PDF-en på nytt med lavere oppløsning, eller del den i to.`,
    }
  }

  let base64: string
  try {
    base64 = await FileSystem.readAsStringAsync(fil.uri, { encoding: 'base64' })
  } catch {
    return { ok: false, feil: 'Fikk ikke lest fila. Prøv å velge den på nytt.' }
  }

  const svar = await callAiVoice({
    mode: 'form_import',
    routeContext: 'skjema',
    dokument: { base64, mimeType: fil.mimeType },
    context: { filnavn: fil.navn },
  })

  if (!svar.ok) {
    if (svar.reason === 'timeout') {
      return { ok: false, feil: 'Det tok for lang tid å lese skjemaet. Er det mange sider, prøv å dele det opp.' }
    }
    if (svar.reason === 'network') {
      return { ok: false, feil: 'Ingen forbindelse. Skjemaimport krever nett — resten av appen gjør ikke det.' }
    }
    return { ok: false, feil: svar.detail || 'Klarte ikke lese skjemaet.' }
  }

  const resultat = normaliserImport(svar)
  if (resultat.seksjoner.length === 0) {
    return {
      ok: false,
      feil: 'Fant ingen punkt i dokumentet. Er det et skjema, eller er skanningen for utydelig til å leses?',
    }
  }
  return { ok: true, resultat }
}
