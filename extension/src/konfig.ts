/**
 * Supabase-prosjektet. Anon-nøkkelen er offentlig (den ligger i appen også) —
 * det er RLS og brukerens egen innlogging som beskytter dataene. Settes ved
 * bygging fra rotas .env.local (`EXPO_PUBLIC_SUPABASE_*`), se bygg.mjs.
 */
declare const __SUPABASE_URL__: string
declare const __SUPABASE_ANON__: string

export const KONFIG = { url: __SUPABASE_URL__, anonKey: __SUPABASE_ANON__ }
