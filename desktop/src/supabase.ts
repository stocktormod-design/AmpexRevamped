import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Mangler nøklene, skal appen si det på skjermen i stedet for å kaste en
 * uleselig feil fra createClient. Kontor-PC-en settes opp av noen som ikke
 * kommer til å åpne devtools.
 */
export const mangler = !url || !anonKey

/**
 * Kjører vi i en vanlig nettleser, eller i Tauri-skallet?
 *
 * Forskjellen er ikke kosmetisk. Nettleseren på ampex.no er stedet e-postlenka
 * fra «glemt passord» lander, med tokenene i hash-en. Tauri laster appen fra et
 * internt skjema og har ingen callback-URL i det hele tatt — der er svaret
 * fortsatt nei, som det alltid har vært.
 */
export const iNettleser =
  typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)

/** Nettadressen e-postlenkene skal komme tilbake til. */
export const tilbakeUrl = iNettleser
  ? window.location.origin + window.location.pathname
  : 'https://ampex.no/'

/**
 * En e-postlenke som ikke virket forteller det i hash-en: `error_code` og
 * `error_description`. Den må leses HER, før klienten opprettes — supabase-js
 * tømmer hash-en med en gang den har sett på den, og da er beskjeden borte før
 * første render.
 */
function lesLenkefeil(): string | null {
  if (!iNettleser) return null
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const kode = h.get('error_code')
  const tekst = h.get('error_description')
  if (!kode && !tekst) return null

  // Hash-en er ikke en rute — la den ikke bli liggende og dukke opp igjen ved
  // neste oppfriskning.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)

  if (kode === 'otp_expired' || /expired|invalid/i.test(tekst ?? '')) {
    return 'Lenka er utløpt eller allerede brukt. Be om en ny nedenfor.'
  }
  return tekst ?? 'Lenka virket ikke.'
}

export const lenkeFeil = lesLenkefeil()

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'ugyldig', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: iNettleser,
  },
})
