/**
 * Firmaet som AVSENDER — brevhodet på alt som forlater appen.
 *
 * Dataene ligger i `public.companies` på serveren og har ingen lokal tabell.
 * Å hente dem ved hver utskrift ville betydd at en montør i en kjeller ikke
 * får laget dokumentet sitt, så de caches i `local_storage` og friskes opp når
 * det finnes nett. Dokumentet er viktigere enn at adressen er sekunder fersk.
 */
import { database } from './db'
import { supabase } from './supabase'
import type { Avsender } from './pdf/dokument'

const NOKKEL = 'firma:avsender'

export type Firma = Avsender & { hentetAt?: string }

/** Cachet avsender. Null bare hvis vi ALDRI har hentet den. */
export async function lagretFirma(): Promise<Firma | null> {
  const raa = await database.localStorage.get<string>(NOKKEL)
  if (!raa) return null
  try {
    return JSON.parse(raa) as Firma
  } catch {
    return null
  }
}

/** Henter fra serveren og oppdaterer cachen. Returnerer null uten nett. */
export async function oppfriskFirma(): Promise<Firma | null> {
  try {
    const { data: companyId } = await supabase.rpc('current_company_id')
    if (!companyId) return null
    const { data, error } = await supabase
      .from('companies')
      .select('name, org_number, firma_street, firma_postnr, firma_poststed, firma_contact_name')
      .eq('id', companyId)
      .single()
    if (error || !data) return null

    const adresse = [
      data.firma_street,
      [data.firma_postnr, data.firma_poststed].filter(Boolean).join(' '),
    ].filter(Boolean).join(', ')

    const firma: Firma = {
      navn: data.name ?? 'Ampex',
      orgnr: data.org_number ?? null,
      adresse: adresse || null,
      hentetAt: new Date().toISOString(),
    }
    await database.localStorage.set(NOKKEL, JSON.stringify(firma))
    return firma
  } catch {
    return null
  }
}

/**
 * Avsenderen til et dokument. Cache først (dokumentet skal alltid kunne lages),
 * server som oppfriskning. Faller tilbake på et navn framfor å feile — et
 * dokument uten brevhode er bedre enn ingen dokument.
 */
export async function hentAvsender(): Promise<Avsender> {
  const lagret = await lagretFirma()
  if (lagret) {
    void oppfriskFirma() // i bakgrunnen; neste utskrift får ferske data
    return lagret
  }
  return (await oppfriskFirma()) ?? { navn: 'Ampex' }
}
