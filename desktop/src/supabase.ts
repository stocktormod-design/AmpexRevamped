import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Mangler nøklene, skal appen si det på skjermen i stedet for å kaste en
 * uleselig feil fra createClient. Kontor-PC-en settes opp av noen som ikke
 * kommer til å åpne devtools.
 */
export const mangler = !url || !anonKey

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'ugyldig', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // WebView2 laster appen fra et internt skjema; det finnes ingen
    // callback-URL å plukke en sesjon ut av.
    detectSessionInUrl: false,
  },
})
