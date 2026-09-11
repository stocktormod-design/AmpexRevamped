import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // React Native har ingen localStorage: uten en eksplisitt `storage` blir
    // sesjonen liggende i minnet, og etter kaldstart er `getUser()` null selv
    // om brukeren «er innlogget». Da forsvinner alt auth-avhengig i stillhet
    // — bilen på Meg, «tildelt meg», faglig godkjenning — mens lokal data
    // fortsatt vises, så feilen ser ut som manglende innhold, ikke utlogging.
    // (Funnet på enhet 2026-08-29: uid:NULL med korrekt tildelt bil lokalt.)
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
