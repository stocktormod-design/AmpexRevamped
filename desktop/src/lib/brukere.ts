import { supabase } from '@/supabase'

/**
 * Brukere og firmaer — klientsida.
 *
 * Alt her går gjennom Edge Functions, og det er ikke en omvei: `companies` har
 * ingen insert-policy, og `profiles.company_id` avvises av `profiles_vern` for
 * enhver klient. Se `supabase/migrations/20260822120000_ampex_admin_og_invitasjon.sql`.
 *
 * Funksjonene svarer alltid HTTP 200 med et `ok`-felt, som ai-voice. En
 * nettverksfeil og en avvisning skal se like ut for den som skrev skjemaet, og
 * en 4xx uten body er umulig å vise fram.
 */

export type Invitasjonsstatus = 'invitert' | 'lagt-til' | 'finnes'

type Svar<T> = ({ ok: true } & T) | { ok: false; error: string }

async function kall<T>(funksjon: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<Svar<T>>(funksjon, { body })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Tomt svar fra serveren.')
  if (!data.ok) throw new Error(data.error)
  return data as T
}

/**
 * Inviter en ansatt inn i firmaet du selv hører til.
 *
 * Firmaet oppgis ikke, og kan ikke oppgis: funksjonen slår opp kallerens eget
 * `company_id` i basen. Det er forskjellen på en invitasjon og en vei inn i et
 * fremmed firma.
 */
export async function inviterAnsatt(epost: string, navn: string, rolle: string) {
  return kall<{ status: Invitasjonsstatus; navn: string; epost: string }>('inviter-ansatt', {
    epost, navn, rolle,
  })
}

export type AmpexFirma = {
  id: string
  name: string
  org_number: string | null
  created_at: string
  deleted_at: string | null
  ansatte: number
  aktive: number
}

export async function hentFirmaer() {
  const { firmaer } = await kall<{ firmaer: AmpexFirma[] }>('ampex-admin', { handling: 'firmaer' })
  return firmaer
}

export async function opprettFirma(inn: {
  navn: string
  org_nummer: string
  eier_epost: string
  eier_navn: string
}) {
  const { opprettet } = await kall<{ opprettet: { id: string; navn: string; eier_epost: string } }>(
    'ampex-admin',
    { handling: 'opprett', ...inn },
  )
  return opprettet
}

/**
 * Er den innloggede Ampex-administrator?
 *
 * `ampex_admins` har én policy: du får se din egen rad. Et tomt svar betyr
 * altså både «du står ikke der» og «du får ikke vite hvem som gjør det», og
 * begge deler er riktig svar her. Feiler spørringen — nett, utløpt økt — er
 * svaret nei: en skjult flate skal ikke dukke opp fordi noe gikk galt.
 */
export async function erAmpexAdmin(): Promise<boolean> {
  const { data, error } = await supabase
    .from('ampex_admins')
    .select('user_id')
    .maybeSingle()
  if (error) return false
  return data !== null
}
