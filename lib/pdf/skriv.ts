/**
 * HTML → PDF → del/arkiver. Eneste sted `expo-print` og `expo-sharing` nevnes.
 *
 * Holdt bevisst tynt: alt som bestemmer hvordan dokumentet SER UT ligger i de
 * rene modulene ved siden av (og er selvtestet), mens dette laget bare gjør
 * jobben ingen selvtest kan gjøre — å snakke med operativsystemet.
 */
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import * as FileSystem from 'expo-file-system/legacy'
import { signedR2Url } from '../drawings-storage'

/** Filnavn kunden ser i delingsarket. Uten dette heter alt «print.pdf». */
function trygtFilnavn(navn: string): string {
  return navn
    .normalize('NFKD')
    .replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').replace(/[åÅ]/g, 'a')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'dokument'
}

/** HTML → PDF på disk. Returnerer lokal filsti. */
export async function skrivPdf(html: string, filnavn: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html })
  // printToFileAsync gir et tilfeldig navn; delingsarket viser filnavnet, og
  // «Sluttkontroll 2026-014.pdf» er hele forskjellen for den som mottar den.
  const mål = `${FileSystem.cacheDirectory}${trygtFilnavn(filnavn)}.pdf`
  await FileSystem.deleteAsync(mål, { idempotent: true })
  await FileSystem.moveAsync({ from: uri, to: mål })
  return mål
}

/** Lager PDF-en og åpner delingsarket (e-post, meldinger, Filer, skriver). */
export async function delPdf(html: string, filnavn: string): Promise<void> {
  const sti = await skrivPdf(html, filnavn)
  if (!(await Sharing.isAvailableAsync())) return
  await Sharing.shareAsync(sti, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: filnavn,
  })
}

/**
 * Laster PDF-en opp til R2 og returnerer nøkkelen — for arkivpakkens
 * `vedlegg`, som er en liste over R2-nøkler. Opplasting FØR registrering er
 * regelen ellers i arkivet: feiler den, skal ingen rad love et dokument som
 * ikke finnes.
 */
export async function lastOppPdf(lokalSti: string, nokkel: string): Promise<string> {
  const url = await signedR2Url(nokkel, 'put')
  const res = await FileSystem.uploadAsync(url, lokalSti, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  })
  if (res.status >= 300) throw new Error(`Opplasting feilet (${res.status})`)
  return nokkel
}
