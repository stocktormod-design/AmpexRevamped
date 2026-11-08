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

/**
 * Hva slags e-postlenke landet vi fra?
 *
 * `recovery` er «glemt passord». `invite` er en helt ny ansatt som aldri har
 * hatt et passord i det hele tatt. Begge deler er en innlogging UTEN passord,
 * og begge skal derfor ende i den samme skjermen — men de skal ikke si det
 * samme, og det er hele grunnen til at typen leses og ikke bare bekreftes.
 *
 * Leses her, av samme grunn som `lenkeFeil`: supabase-js tømmer hash-en så
 * snart den har sett på den. Hash-en røres ikke — tokenene ligger i den, og
 * klienten trenger dem noen millisekunder senere.
 */
function lesLenketype(): 'invite' | 'recovery' | null {
  if (!iNettleser) return null
  const t = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type')
  return t === 'invite' || t === 'recovery' ? t : null
}

export const lenkeType = lesLenketype()

/**
 * Vår EGEN lenke fra e-posten.
 *
 * ── Hvorfor vi ikke bruker `{{ .ConfirmationURL }}` ────────────────────────
 *
 * Den peker på `<prosjekt-id>.supabase.co/auth/v1/verify?...`. Teknisk helt
 * riktig, og helt feil for den som får den: en elektriker som får en lenke til
 * et domene han aldri har hørt om, med en tilfeldig bokstavsuppe foran, skal
 * IKKE klikke på den. Han har rett i å la være.
 *
 * I stedet sender malene `{{ .TokenHash }}` til vår egen adresse, og appen
 * løser koden inn med `verifyOtp`. Hele lenka står da på ampex.no. Supabase
 * selger et eget auth-domene som løser det samme for ti dollar i måneden;
 * dette koster ingenting og gjør i tillegg noe det ikke gjør:
 *
 * **Det tåler e-postskannere bedre.** Gmail og Outlook forhåndsåpner lenker
 * for å sjekke dem. Peker lenka rett på `/auth/v1/verify`, blir koden innløst
 * av skanneren, og brukeren får «utløpt» når han selv klikker. Peker den på
 * oss, må det kjøres JavaScript for at koden skal brukes — og det gjør de
 * færreste skannerne.
 *
 * Koden fjernes fra adressen med en gang den er lest. Den virker bare én gang,
 * og skal ikke bli liggende i historikken eller i en oppfriskning.
 */
export type Lenke = { type: 'invite' | 'recovery' | 'signup' | 'magiclink'; tokenHash: string }

function lesLenke(): Lenke | null {
  if (!iNettleser) return null
  const q = new URLSearchParams(window.location.search)
  const tokenHash = q.get('token_hash')
  const t = q.get('type')
  if (!tokenHash) return null
  if (t !== 'invite' && t !== 'recovery' && t !== 'signup' && t !== 'magiclink') return null

  window.history.replaceState(null, '', window.location.pathname)
  return { type: t, tokenHash }
}

export const lenke = lesLenke()

/**
 * Kom vi fra en invitasjon eller «glemt passord» — i DENNE fanen?
 *
 * Både hash-en og `?token_hash` er borte fra adressen så snart de er lest, så en
 * omlasting glemmer hvor vi kom fra. Og omlastingen kommer: på første besøk tar
 * service workeren over og laster sida på nytt (`controllerchange` i main.tsx).
 * Da var økta alt opprettet av lenka, passordskjermen forsvant, og den som
 * klikket sto inne på Oversikt uten å ha valgt passord (iser@live.no, 04.11).
 * Huskes derfor i sessionStorage — samme fane, borte når fanen lukkes — til
 * passordet er satt eller brukeren logger ut.
 */
const PASSORDLENKE = 'ampex.passordlenke'
function lesPassordlenke(): 'invite' | 'recovery' | null {
  if (!iNettleser) return null
  const ny = lenkeType ?? (lenke?.type === 'invite' || lenke?.type === 'recovery' ? lenke.type : null)
  try {
    if (ny) sessionStorage.setItem(PASSORDLENKE, ny)
    const t = sessionStorage.getItem(PASSORDLENKE)
    return t === 'invite' || t === 'recovery' ? t : null
  } catch {
    return ny
  }
}
export const passordlenke = lesPassordlenke()
export function glemPassordlenke() {
  try { sessionStorage.removeItem(PASSORDLENKE) } catch { /* privat vindu */ }
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'ugyldig', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: iNettleser,
  },
})
