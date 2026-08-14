import { database } from './index'
import { supabase } from '../supabase'

const OWNER_COMPANY_KEY = 'ampex_db_owner_company_id'

// Én positiv verifisering per prosess holder — company_id endrer seg ikke
// midt i en kjøring, og vi vil ikke spørre profiles ved hver forgrunnsretur.
let verifiedUserId: string | null = null

/**
 * Motstykket på enheten til RLS på serveren: lokal SQLite er én felles fil, og
 * uten dette ville en bruker fra et ANNET firma som logger inn på samme telefon
 * sett forrige firmas data — i UI-et og (verre) via AI-assistentens verktøy, som
 * leser hele lokal-databasen. Kalles ved innlogging FØR første synk.
 *
 * Kun destruktiv når vi POSITIVT vet at firmaet er et annet: uten nett (eller
 * uten profil-svar) gjør den ingenting — offline-først-appen skal ikke slette
 * lokale data på grunn av en feilet oppslagsforespørsel. Samme firma, annen
 * bruker → beholdes: det speiler RLS-semantikken (data er firma-scopet), og
 * lokale tabeller som ennå ikke synker (prosjekter, rom, skjema) ville ellers
 * blitt slettet permanent hver gang en kollega logget inn.
 */
export async function enforceCompanyBoundary(): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser()
    const user = data.user
    if (!user || user.id === verifiedUserId) return

    const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
    const companyId = profile?.company_id
    if (typeof companyId !== 'string' || companyId.length === 0) return

    const owner = await database.localStorage.get<string>(OWNER_COMPANY_KEY)
    if (owner !== companyId) {
      if (owner) {
        console.log('[company-guard] nytt firma på enheten — nullstiller lokal database')
        await database.write(() => database.unsafeResetDatabase())
      }
      await database.localStorage.set(OWNER_COMPANY_KEY, companyId)
    }
    verifiedUserId = user.id
  } catch (e) {
    // Aldri la en nettverks-/oppslagsfeil blokkere appen — da forblir bare
    // grensen uverifisert til neste trigger.
    console.log('[company-guard] utsatt:', e instanceof Error ? e.message : e)
  }
}
