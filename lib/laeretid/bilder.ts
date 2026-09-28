/**
 * Bildene i en læretidslogg — ta med kameraet, eller hent de du alt har tatt.
 *
 * Tormod 27.09.2026: «før du skriver så kan du ta bildene du vanligvis ville
 * tatt utenfor inne i appen … da kan du skrive kort under det bilde du nettopp
 * tok. Da blir det lettere å huske. Og det må funke selv om du har tatt
 * bildene utenfor.»
 *
 * Reglene:
 *   - Bildet lagres PÅ TELEFONEN først, under en sti som er bildets id. Raden
 *     finnes uansett om nettet gjør det (regel 2); opplastingen prøves etterpå,
 *     og det som ikke kom fram tas igjen neste gang (`lastOppVentende`).
 *   - Tatt i appen: tiden er nå. Hentet fra kamerarullen: tiden leses fra EXIF
 *     (`tidFraExif`), og BARE tiden — posisjonen lagres aldri.
 *   - Notatet skrives av ham, ordrett. Ingen modell pusser på det ved fangst.
 *   - R2-nøkkelen er `laeretid/<logg>/<bilde>.jpg`. Signeringen legger den under
 *     lærlingens egen id, ikke et firma — læretid eies av lærlingen.
 */
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Q } from '@nozbe/watermelondb'
import randomId from '@nozbe/watermelondb/utils/common/randomId'
import { database } from '../db'
import { LaeretidBilde, LaeretidLogg } from '../db/models/laeretid'
import { signedR2Url } from '../drawings-storage'
import { arbeidsdatoFraBilder, tidFraExif } from './bildetid'

const MAPPE = (FileSystem.documentDirectory ?? '') + 'laeretid/'

/** Der bildet ligger på denne telefonen. Utledet av id-en — ingen kolonne trengs. */
export function lokalSti(bildeId: string): string {
  return `${MAPPE}${bildeId}.jpg`
}

function r2Nokkel(loggId: string, bildeId: string): string {
  return `laeretid/${loggId}/${bildeId}.jpg`
}

async function sikreMappe() {
  const info = await FileSystem.getInfoAsync(MAPPE)
  if (!info.exists) await FileSystem.makeDirectoryAsync(MAPPE, { intermediates: true })
}

async function lastOpp(bilde: LaeretidBilde): Promise<boolean> {
  if (!bilde.loggId) return false
  const nokkel = r2Nokkel(bilde.loggId, bilde.id)
  try {
    const url = await signedR2Url(nokkel, 'put')
    const res = await FileSystem.uploadAsync(url, lokalSti(bilde.id), {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    })
    if (res.status >= 300) return false
    await database.write(async () => { await bilde.update(r => { r.r2Nokkel = nokkel }) })
    return true
  } catch {
    return false
  }
}

async function lagre(logg: LaeretidLogg, brukerId: string, uri: string, tattAt: Date | null): Promise<LaeretidBilde> {
  await sikreMappe()
  // Fila først, raden etterpå: en rad uten fil (appen drept midt i kopien)
  // ville vært et tomt bilde for alltid. Id-en lages her, så fila kan hete det.
  const id = randomId()
  await FileSystem.copyAsync({ from: uri, to: lokalSti(id) })
  const antall = await database.get<LaeretidBilde>('laeretid_bilde').query(Q.where('logg_id', logg.id)).fetchCount()
  const bilde = await database.write(async () =>
    database.get<LaeretidBilde>('laeretid_bilde').create(r => {
      r._raw.id = id
      r.laerlingId = brukerId
      r.loggId = logg.id
      r.tattAt = tattAt
      r.rekkefolge = antall
      r.notat = null
      r.modellbeskrivelse = null
      r.r2Nokkel = null
    }),
  )
  void lastOpp(bilde)
  return bilde
}

async function kameratilgang(): Promise<boolean> {
  return (await ImagePicker.requestCameraPermissionsAsync()).granted
}

/** Ta ett bilde nå. Null hvis han avbrøt eller ikke ga tilgang. */
export async function taBilde(logg: LaeretidLogg, brukerId: string): Promise<LaeretidBilde | null> {
  if (!(await kameratilgang())) return null
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false })
  if (res.canceled || !res.assets[0]) return null
  return lagre(logg, brukerId, res.assets[0].uri, new Date())
}

/**
 * Hent bilder han alt har tatt. EXIF leses for tiden — og bare den. Er de
 * fleste fra en annen dag enn loggens, flyttes arbeidsdatoen dit: bilder fra
 * tirsdag hentet på torsdag er en logg fra tirsdag.
 */
export async function hentBilder(logg: LaeretidLogg, brukerId: string): Promise<LaeretidBilde[]> {
  // Ingen tilgangsforespørsel: iOS' egen bildevelger gir appen bare bildene han
  // velger, ikke hele biblioteket. Å be om full tilgang for det er å be om mer
  // enn vi trenger.
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 30,
    orderedSelection: true,
    quality: 0.7,
    exif: true,
  })
  if (res.canceled) return []
  const tider = res.assets.map(a => tidFraExif(a.exif as Record<string, unknown> | undefined))
  const ut: LaeretidBilde[] = []
  for (let i = 0; i < res.assets.length; i++) ut.push(await lagre(logg, brukerId, res.assets[i].uri, tider[i]))

  const dag = arbeidsdatoFraBilder(tider)
  if (dag && dag !== logg.arbeidsdato) {
    await database.write(async () => { await logg.update(l => { l.arbeidsdato = dag }) })
  }
  return ut
}

/** Fjern et bilde (soft delete via synken) og filen på telefonen. */
export async function fjernBilde(bilde: LaeretidBilde): Promise<void> {
  await database.write(async () => { await bilde.markAsDeleted() })
  await FileSystem.deleteAsync(lokalSti(bilde.id), { idempotent: true }).catch(() => {})
}

/**
 * Last opp det som ikke kom fram. Kalles når skjermen får fokus — aldri i en
 * løkke (regel 10).
 */
export async function lastOppVentende(loggId: string): Promise<void> {
  const ventende = await database.get<LaeretidBilde>('laeretid_bilde')
    .query(Q.where('logg_id', loggId), Q.where('r2_nokkel', null)).fetch()
  for (const b of ventende) {
    const info = await FileSystem.getInfoAsync(lokalSti(b.id))
    if (info.exists) await lastOpp(b)
  }
}

/**
 * Hvor bildet vises fra: filen på telefonen, ellers en signert R2-lenke (et
 * bilde tatt på en annen enhet). Null hvis det ikke finnes noe sted ennå.
 */
export async function bildeUri(bilde: LaeretidBilde): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(lokalSti(bilde.id))
  if (info.exists) return lokalSti(bilde.id)
  if (!bilde.r2Nokkel) return null
  try { return await signedR2Url(bilde.r2Nokkel, 'get') } catch { return null }
}

/**
 * Bildet som data-URI, for PDF-en. Fra telefonen når fila finnes her, ellers
 * lastet ned fra R2 (bildet ble tatt på en annen enhet). Null hvis det ikke
 * finnes noe sted.
 */
export async function bildeDataUri(bilde: LaeretidBilde): Promise<string | null> {
  try {
    let sti = lokalSti(bilde.id)
    if (!(await FileSystem.getInfoAsync(sti)).exists) {
      if (!bilde.r2Nokkel) return null
      sti = `${FileSystem.cacheDirectory}pdf-${bilde.id}.jpg`
      const url = await signedR2Url(bilde.r2Nokkel, 'get')
      const res = await FileSystem.downloadAsync(url, sti)
      if (res.status >= 300) return null
    }
    const b64 = await FileSystem.readAsStringAsync(sti, { encoding: FileSystem.EncodingType.Base64 })
    return `data:image/jpeg;base64,${b64}`
  } catch {
    return null
  }
}
