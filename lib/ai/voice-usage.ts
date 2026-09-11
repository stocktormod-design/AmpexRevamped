/**
 * Firmaets stemmeforbruk og tak — datalaget for Meg → Stemme.
 *
 * Alt går gjennom SQL-funksjoner som utleder bruker og firma av JWT-en, så
 * klienten kan verken se andre firmaer eller endre tak den ikke eier. Se
 * migrasjonene voice_usage_and_tiers / voice_usage_company_views_and_limits.
 *
 * Kroner regnes HER, ikke i SQL: prisen har falt tre ganger på ett år, og den
 * skal kunne endres på ett sted uten en migrasjon. Sekunder tale er sannheten;
 * kroner er et estimat oppå den.
 */
import { supabase } from '../supabase'

/** Googles listepris for native-audio Live (per 1M tokens), og kurs. Ett sted. */
export const PRIS = {
  usdPer1MInn: 3.0,
  usdPer1MUt: 12.0,
  nokPerUsd: 10.5,
  /** Lyd = 25 tokens/sek. Brukes kun til å anslå tale-ut når vi ikke har tokens. */
  tokPerSek: 25,
} as const

export type Tier = 'av' | 'standard' | 'utvidet' | 'ubegrenset'

export const TIER_TEKST: Record<Tier, { navn: string; beskrivelse: string }> = {
  av: { navn: 'Av', beskrivelse: 'Kun systemstemmen. Assistenten virker, men uten Live.' },
  standard: { navn: 'Standard', beskrivelse: '1 time egen tale per dag. Deretter systemstemmen.' },
  utvidet: { navn: 'Utvidet', beskrivelse: '3 timer egen tale per dag.' },
  ubegrenset: { navn: 'Ubegrenset', beskrivelse: 'Intet tak. Regningen følger bruken.' },
}

export type DagRad = { dag: string; tale_sek: number; tok_inn: number; tok_ut: number; okter: number; brukere: number }
export type BrukerRad = {
  user_id: string; navn: string; rolle: string
  tale_sek: number; tok_inn: number; tok_ut: number; okter: number; dager: number
}
export type FirmaTak = { tier: Tier; cap_sec: number | null; standard_cap_sec: number | null }

/** Estimert kostnad i kroner for et sett tokens. Tale ut dominerer (64 % av regningen). */
export function kroner(tokInn: number, tokUt: number): number {
  const usd = (tokInn / 1e6) * PRIS.usdPer1MInn + (tokUt / 1e6) * PRIS.usdPer1MUt
  return usd * PRIS.nokPerUsd
}

export async function erFirmaadmin(): Promise<boolean> {
  const { data } = await supabase.rpc('voice_er_firmaadmin')
  return data === true
}

export async function hentPerDag(dager = 30): Promise<DagRad[]> {
  const { data, error } = await supabase.rpc('voice_usage_firma_per_dag', { p_dager: dager })
  if (error) throw error
  return (data ?? []) as DagRad[]
}

export async function hentPerBruker(dager = 30): Promise<BrukerRad[]> {
  const { data, error } = await supabase.rpc('voice_usage_firma_per_bruker', { p_dager: dager })
  if (error) throw error
  return (data ?? []) as BrukerRad[]
}

export async function hentTak(): Promise<FirmaTak> {
  const { data, error } = await supabase.rpc('voice_firma_tak')
  if (error) throw error
  const rad = (Array.isArray(data) ? data[0] : data) as FirmaTak | undefined
  return rad ?? { tier: 'standard', cap_sec: 3600, standard_cap_sec: 3600 }
}

/** p_cap_sec null = bruk tierens standard. */
export async function settTak(tier: Tier, capSec: number | null): Promise<void> {
  const { error } = await supabase.rpc('voice_sett_firma_tak', { p_tier: tier, p_cap_sec: capSec })
  if (error) throw error
}

export function formatMin(sek: number): string {
  const m = Math.round(sek / 60)
  if (m < 60) return `${m} min`
  const t = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${t} t` : `${t} t ${r} min`
}
