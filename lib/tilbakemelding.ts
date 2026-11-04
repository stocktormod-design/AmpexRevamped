import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import * as Device from 'expo-device'
import { Paths } from 'expo-file-system'
import { supabase } from './supabase'

/**
 * TILBAKEMELDING (2026-11-04). Testere og brukere melder feil, forslag og ros fra
 * boblen nede til høyre. Teksten er deres egen; resten fylles inn automatisk så
 * Tormod slipper å spørre «hvilken telefon, hvilken versjon, hvor i appen?».
 *
 * Unntak fra regel 2 (offline-først via WatermelonDB), som skannloggen: dette er
 * en melding TIL Ampex, ikke firmadata. Uten nett legges den i kø i AsyncStorage
 * og sendes neste gang appen kommer i forgrunnen.
 */

export type TilbakemeldingType = 'feil' | 'forslag' | 'ros'

// Siste skjermer brukeren var på — «hvordan kom du hit» uten å spørre.
const SPOR_MAKS = 15
const spor: { rute: string; t: string }[] = []
export function registrerRute(rute: string) {
  if (spor.length > 0 && spor[spor.length - 1].rute === rute) return
  spor.push({ rute, t: new Date().toISOString() })
  if (spor.length > SPOR_MAKS) spor.shift()
}
export function gjeldendeRute(): string | null {
  return spor.length > 0 ? spor[spor.length - 1].rute : null
}

const startet = Date.now()
const KØ = 'ampex.tilbakemelding.ko'

type Rad = Record<string, unknown>

function enhetsdata() {
  let ledig: number | null = null
  try { ledig = Math.round(Paths.availableDiskSpace / 1048576) } catch {}
  return {
    app_versjon: Application.nativeApplicationVersion,
    bygg: Application.nativeBuildVersion,
    plattform: Platform.OS,
    os: `${Device.osName ?? Platform.OS} ${Device.osVersion ?? String(Platform.Version)}`,
    modell: Device.modelName ?? Device.modelId ?? null,
    ram_mb: Device.totalMemory ? Math.round(Device.totalMemory / 1048576) : null,
    ledig_disk_mb: ledig,
  }
}

export async function sendTilbakemelding(inn: {
  type: TilbakemeldingType
  tekst: string
  vurdering: number | null
}): Promise<'sendt' | 'i kø'> {
  const { data: { user } } = await supabase.auth.getUser()
  let companyId: string | null = null
  let rolle: string | null = null
  if (user) {
    const { data } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).maybeSingle()
    companyId = data?.company_id ?? null
    rolle = data?.role ?? null
  }
  const rad: Rad = {
    type: inn.type,
    tekst: inn.tekst.trim(),
    vurdering: inn.vurdering,
    company_id: companyId,
    rute: gjeldendeRute(),
    ruter: [...spor],
    ...enhetsdata(),
    ekstra: {
      rolle,
      minutter_i_appen: Math.round((Date.now() - startet) / 60000),
      skjerm: Device.deviceType,
      sendt_lokalt: new Date().toISOString(),
    },
  }
  if (await prøv(rad)) { void tømKø(); return 'sendt' }
  const kø: Rad[] = JSON.parse((await AsyncStorage.getItem(KØ)) ?? '[]')
  kø.push(rad)
  await AsyncStorage.setItem(KØ, JSON.stringify(kø.slice(-20)))
  return 'i kø'
}

async function prøv(rad: Rad): Promise<boolean> {
  try {
    const { error } = await supabase.from('tilbakemelding').insert(rad)
    return !error
  } catch { return false }
}

/** Kalles når appen kommer i forgrunnen. Ingen polling (regel 10). */
export async function tømKø() {
  const rå = await AsyncStorage.getItem(KØ)
  if (!rå) return
  const kø: Rad[] = JSON.parse(rå)
  const igjen: Rad[] = []
  for (const r of kø) if (!(await prøv(r))) igjen.push(r)
  if (igjen.length === 0) await AsyncStorage.removeItem(KØ)
  else await AsyncStorage.setItem(KØ, JSON.stringify(igjen))
}
