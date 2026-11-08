import AsyncStorage from '@react-native-async-storage/async-storage'
import { skannDiagnose, isNativeSplatAvailable } from '../modules/ampex-splat'
import { supabase } from './supabase'

// «Send skannlogg»: testere utenfor huset — skannet deres ligger bare på telefonen.
// Sender pipeline-loggen og tre kildebilder fra siste skann (se skannDiagnose).
//
// Sendes nå AUTOMATISK etter hvert skann og hver ombygging (ferdig, feilet eller avbrutt) —
// knappen ble aldri trykket (07.11). Hendelsen står øverst i loggteksten, så tabellen
// trenger ingen ny kolonne. Siste sendte økt huskes; ved oppstart sendes økten på nytt
// hvis den aldri kom fram (krasj under baken, eller uten nett).

const SIST_SENDT = 'skannlogg.sistSendtOkt'

export type Skannhendelse = 'ferdig' | 'feilet' | 'avbrutt' | 'ombygging' | 'ombygging feilet' | 'manuell' | 'ved oppstart'

export async function sendSkannlogg(hendelse: Skannhendelse = 'manuell', detalj?: string): Promise<void> {
  const d = await skannDiagnose()
  const topp = `== ${hendelse}${detalj ? ` — ${detalj}` : ''} · ${new Date().toISOString()} ==\n`
  const { error } = await supabase.from('skannlogg').insert({
    okt: d.okt, modell: d.modell, ios: d.ios, ram_mb: d.ramMB, ledig_mb: d.ledigMB, logg: topp + d.logg, bilder: d.bilder,
  })
  if (error) throw error
  if (d.okt) await AsyncStorage.setItem(SIST_SENDT, d.okt).catch(() => {})
}

/** Stille i bakgrunnen — skannet skal aldri vente på eller feile av loggen. */
export function sendSkannloggStille(hendelse: Skannhendelse, detalj?: string): void {
  if (!isNativeSplatAvailable) return
  sendSkannlogg(hendelse, detalj).catch(() => {})
}

/** Ved oppstart: siste økt på telefonen er ikke sendt → send den nå. */
// Oppstart og «app aktiv» kan fyre samtidig — uten vakt gikk samme økt inn tre ganger (Ingebrigt 08.11).
let paagaar: Promise<void> | null = null
export function sendUsendtSkannlogg(): Promise<void> {
  if (!isNativeSplatAvailable) return Promise.resolve()
  return (paagaar ??= sendUsendt().finally(() => { paagaar = null }))
}
async function sendUsendt(): Promise<void> {
  try {
    const d = await skannDiagnose()
    if (!d.okt || d.okt === (await AsyncStorage.getItem(SIST_SENDT))) return
    await sendSkannlogg('ved oppstart', 'ikke sendt forrige gang (krasj eller uten nett?)')
  } catch {}
}
