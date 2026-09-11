/**
 * Foto på ordre og i skjema — beviset når noe bestrides.
 *
 * FUNKSJON UTEN SKJERM: alt et UI trenger er `taOrdrefoto(orderId)` eller
 * `velgOrdrefoto(orderId)`. Hvordan knappen ser ut, om det er et kamera-ikon
 * eller et helt eget galleri, bestemmer UI-et.
 *
 * **Ingen databasemigrasjon.** Bildene bor i `order_scans` med `kind='foto'`:
 * tabellen har allerede nøyaktig formen et vedlegg trenger (ordre, art, tittel,
 * R2-nøkkel, hvem), og den er allerede koblet på synken. En ny tabell ville
 * kostet en migrasjon på både klient og server for å oppnå det samme.
 *
 * **Bildet lastes opp med én gang, filen beholdes lokalt.** Et bilde tatt i en
 * kjeller uten dekning må ikke gå tapt: opplastingen prøves, og feiler den,
 * står raden igjen uten `scan_path` og kan lastes opp senere
 * (`lastOppVentende`). Det motsatte — å vente med raden til opplastingen
 * lykkes — mister bildet i det appen lukkes.
 */
import { useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { database } from './db'
import { OrderScan } from './db/models/order-scan'
import { signedR2Url } from './drawings-storage'
import { supabase } from './supabase'

/** `kind` for bilder. Ligger her, ikke i modellen, så skann-typene står urørt. */
export const FOTO_KIND = 'foto'

/** Lokal sti → R2-nøkkel. Nøkkelen er stabil og inneholder ordren. */
function fotoNokkel(orderId: string, filnavn: string): string {
  const rent = filnavn.replace(/[^a-zA-Z0-9._-]/g, '-')
  return `foto/${orderId}/${Date.now()}-${rent}`
}

async function beOmTillatelse(kamera: boolean): Promise<boolean> {
  const svar = kamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync()
  return svar.granted
}

/** Tar bilde med kameraet. Null hvis brukeren avbrøt eller nektet tilgang. */
export async function taBilde(): Promise<string | null> {
  if (!(await beOmTillatelse(true))) return null
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.7, // et dokumentasjonsbilde trenger ikke være 12 MB på 4G
    exif: false, // posisjon i EXIF er personopplysning vi ikke har bruk for
  })
  return res.canceled ? null : res.assets[0].uri
}

/** Velger bilder fra galleriet. Tom liste hvis avbrutt. */
export async function velgBilder(maks = 10): Promise<string[]> {
  if (!(await beOmTillatelse(false))) return []
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: maks,
    quality: 0.7,
    exif: false,
  })
  return res.canceled ? [] : res.assets.map(a => a.uri)
}

/** Laster opp én fil til R2 og returnerer nøkkelen. Kaster ved feil. */
export async function lastOppFoto(lokalUri: string, nokkel: string): Promise<string> {
  const url = await signedR2Url(nokkel, 'put')
  const res = await FileSystem.uploadAsync(url, lokalUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  })
  if (res.status >= 300) throw new Error(`Opplasting feilet (${res.status})`)
  return nokkel
}

/**
 * Knytter et bilde til en ordre: rad først, opplasting etterpå.
 * Returnerer raden — den finnes uansett om nettet gjør det.
 */
export async function knyttFotoTilOrdre(
  orderId: string,
  lokalUri: string,
  tittel = 'Foto',
): Promise<OrderScan> {
  const filnavn = lokalUri.split('/').pop() ?? 'foto.jpg'
  const nokkel = fotoNokkel(orderId, filnavn)
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? null

  const rad = await database.write(async () =>
    database.get<OrderScan>('order_scans').create(r => {
      r.orderId = orderId
      r.kind = FOTO_KIND as OrderScan['kind']
      r.title = tittel
      r.scanPath = null // fylles når opplastingen lykkes
      r.createdBy = bruker
    }),
  )

  try {
    await lastOppFoto(lokalUri, nokkel)
    await database.write(async () => rad.update(r => { r.scanPath = nokkel }))
  } catch {
    // Bildet er ikke tapt: raden står, og `lastOppVentende` tar den senere.
    await lagreVentende(rad.id, lokalUri, nokkel)
  }
  return rad
}

/** Kamera → ordre i ett kall. Null hvis brukeren avbrøt. */
export async function taOrdrefoto(orderId: string, tittel?: string): Promise<OrderScan | null> {
  const uri = await taBilde()
  if (!uri) return null
  return knyttFotoTilOrdre(orderId, uri, tittel)
}

/** Galleri → ordre. Returnerer radene som ble laget. */
export async function velgOrdrefoto(orderId: string, tittel?: string): Promise<OrderScan[]> {
  const urier = await velgBilder()
  const rader: OrderScan[] = []
  for (const uri of urier) rader.push(await knyttFotoTilOrdre(orderId, uri, tittel))
  return rader
}

/* ── Ventende opplastinger ─────────────────────────────────────────────────── */

const VENTENDE = 'foto:ventende'
type Ventende = Record<string, { uri: string; nokkel: string }>

async function lesVentende(): Promise<Ventende> {
  const raa = await database.localStorage.get<string>(VENTENDE)
  try {
    return raa ? (JSON.parse(raa) as Ventende) : {}
  } catch {
    return {}
  }
}

async function lagreVentende(radId: string, uri: string, nokkel: string): Promise<void> {
  const alle = await lesVentende()
  alle[radId] = { uri, nokkel }
  await database.localStorage.set(VENTENDE, JSON.stringify(alle))
}

/**
 * Prøver alle bilder som ikke kom fram. Kalles der synken ellers trigges
 * (forgrunn, nettverksretur) — aldri i en løkke (regel 10).
 * Returnerer antall som lyktes.
 */
export async function lastOppVentende(): Promise<number> {
  const alle = await lesVentende()
  const idr = Object.keys(alle)
  if (idr.length === 0) return 0

  let ok = 0
  for (const radId of idr) {
    const { uri, nokkel } = alle[radId]
    try {
      await lastOppFoto(uri, nokkel)
      const rad = await database.get<OrderScan>('order_scans').find(radId).catch(() => null)
      if (rad) await database.write(async () => rad.update(r => { r.scanPath = nokkel }))
      delete alle[radId]
      ok++
    } catch {
      // Fortsatt uten nett — la den stå.
    }
  }
  await database.localStorage.set(VENTENDE, JSON.stringify(alle))
  return ok
}

/* ── Lesing ────────────────────────────────────────────────────────────────── */

/** Bildene på en ordre, reaktivt. */
export function useOrdrefoto(orderId: string | null | undefined): OrderScan[] {
  const [foto, setFoto] = useState<OrderScan[]>([])
  useEffect(() => {
    if (!orderId) { setFoto([]); return }
    const sub = database
      .get<OrderScan>('order_scans')
      .query(Q.where('order_id', orderId), Q.where('kind', FOTO_KIND), Q.sortBy('created_at', Q.desc))
      .observe()
      .subscribe(setFoto)
    return () => sub.unsubscribe()
  }, [orderId])
  return foto
}

/** Signert nedlastings-URL for visning. Null hvis bildet ikke er lastet opp. */
export async function fotoUrl(rad: OrderScan): Promise<string | null> {
  if (!rad.scanPath) return null
  try {
    return await signedR2Url(rad.scanPath, 'get')
  } catch {
    return null
  }
}

/** Sletter bildet fra ordren. Filen i R2 blir liggende (soft delete, regel 5). */
export async function slettFoto(rad: OrderScan): Promise<void> {
  await database.write(async () => rad.markAsDeleted())
}
