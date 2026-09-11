/// <reference types="vite/client" />

declare module 'virtual:ampex-tokens.css'

declare module 'virtual:ampex-tokens' {
  const tokens: {
    colors: Record<string, string>
    spacing: Record<string, number>
    radius: Record<string, number>
    sizes: Record<string, number>
  }
  export default tokens
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
