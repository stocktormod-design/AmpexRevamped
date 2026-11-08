// Bygger Ampex-utvidelsen til extension/dist med Vite fra kontorappen (ingen egen
// node_modules). Tre filer, hver som IIFE: en innholdsside kan ikke være en modul.
//   node extension/bygg.mjs          (fra rota)
// Last inn i Chrome: chrome://extensions → Utviklermodus → «Last inn upakket» → extension/dist
import { readFileSync, rmSync, cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const her = fileURLToPath(new URL('.', import.meta.url))
const rot = fileURLToPath(new URL('..', import.meta.url))
const { build } = createRequire(rot + 'desktop/package.json')('vite')

const env = Object.fromEntries(readFileSync(rot + '.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
if (!env.EXPO_PUBLIC_SUPABASE_URL || !env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
  throw new Error('Mangler EXPO_PUBLIC_SUPABASE_URL/ANON_KEY i .env.local')
}

const ut = her + 'dist/'
rmSync(ut, { recursive: true, force: true })

for (const navn of ['bakgrunn', 'side', 'popup']) {
  await build({
    configFile: false,
    logLevel: 'warn',
    root: her,
    publicDir: false,
    resolve: { alias: { '@delt': rot + 'lib' } },
    define: {
      __SUPABASE_URL__: JSON.stringify(env.EXPO_PUBLIC_SUPABASE_URL),
      __SUPABASE_ANON__: JSON.stringify(env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    },
    build: {
      outDir: ut,
      emptyOutDir: false,
      minify: false, // lesbar kode i «Last inn upakket» — det er ingen hemmeligheter her
      lib: { entry: her + `src/${navn}.ts`, formats: ['iife'], name: `ampex_${navn}`, fileName: () => `${navn}.js` },
    },
  })
}
cpSync(her + 'public', ut, { recursive: true })
console.log('Bygget: extension/dist')
