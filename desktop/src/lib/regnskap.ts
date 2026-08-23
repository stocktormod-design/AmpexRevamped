import { supabase } from '@/supabase'

/**
 * Fakturautkast ut til firmaets regnskapssystem.
 *
 * Alt går gjennom Edge Functionen `regnskap`, og det er ikke en omvei. Tokenene
 * ligger i Supabase Vault og hentes med `service_role` — et Tripletex
 * `employeeToken` gir tilgang til hele regnskapet, og skal aldri finnes i en
 * nettleser.
 *
 * Kontoret sender derfor bare ordre-ID-en. Fakturagrunnlaget regnes på
 * serveren, av samme `lib/invoicing.ts` som skjermen her viser. Kunne klienten
 * sendt sitt eget grunnlag, ville klienten bestemt hva kunden faktureres.
 *
 * ── Det som IKKE skjer her ────────────────────────────────────────────────
 *
 * Ampex utsteder aldri en faktura. Dette lager et UTKAST — en ufakturert ordre
 * i Tripletex, et fakturautkast i Fiken — og knappen som gjør det til en ekte
 * faktura med nummer trykkes av et menneske inne i regnskapssystemet.
 *
 * `markerFakturert()` i `ordre-lager.ts` er noe annet: den fører ordren videre
 * i Ampex' egen flyt. De to henger sammen, men den ene er ikke den andre.
 */

type Svar<T> = ({ ok: true } & T) | { ok: false; error: string; kanProvesIgjen?: boolean }

async function kall<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<Svar<T>>('regnskap', { body })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Tomt svar fra serveren.')
  if (!data.ok) throw new Error(data.error)
  return data as T
}

export type Sendt = {
  system: string
  utkastId: string
  kundeId: string
  bruttoOre: number
}

/**
 * Sender ordren som fakturautkast.
 *
 * Er kunden ikke opprettet i regnskapet fra før, opprettes hun der først og
 * `external_id` skrives tilbake — regnskapet eier kunderegisteret. Ordren må
 * derfor ha en kunde fra kunderegisteret, ikke bare et navn skrevet på fri
 * hånd; serveren avviser den ellers.
 */
export async function sendTilRegnskap(ordreId: string): Promise<Sendt> {
  const { sendt } = await kall<{ sendt: Sendt }>({ handling: 'send-utkast', ordre_id: ordreId })
  return sendt
}

/**
 * Status på utkastet ute i regnskapet.
 *
 * `ikke_sendt` betyr at ordren aldri har vært pushet. `utkast` betyr at den
 * ligger der, men at ingen har fakturert den ennå — det er tilstanden man
 * purrer på seg selv for.
 */
export async function hentRegnskapsstatus(ordreId: string): Promise<string> {
  const { status } = await kall<{ status: string }>({ handling: 'status', ordre_id: ordreId })
  return status
}
