import { skannDiagnose } from './splat'
import { supabase } from './supabase'

// «Send skannlogg»: testere utenfor huset — skannet deres ligger bare på telefonen.
// Sender pipeline-loggen og tre kildebilder fra siste skann (se skannDiagnose).
export async function sendSkannlogg(): Promise<void> {
  const d = await skannDiagnose()
  const { error } = await supabase.from('skannlogg').insert({
    okt: d.okt, modell: d.modell, ios: d.ios, ram_mb: d.ramMB, ledig_mb: d.ledigMB, logg: d.logg, bilder: d.bilder,
  })
  if (error) throw error
}
