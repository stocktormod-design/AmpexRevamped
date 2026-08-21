import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)
const rot = fileURLToPath(new URL('.', import.meta.url))

/**
 * `lib/tokens.js` er CommonJS fordi tailwind.config.js må kunne `require` den.
 * Nettleseren kan ikke lese den formen, og vi vil ikke ha en andre kopi av
 * paletten — regelen i tokens.js er at ingen skjerm bruker en farge som ikke
 * står der.
 *
 * Derfor leses fila her, i Node, og serveres som to virtuelle moduler:
 * `virtual:ampex-tokens.css` (custom properties) og `virtual:ampex-tokens`
 * (samme verdier som typet JS). Ett sted å endre, to måter å lese.
 */
function ampexTokens(): Plugin {
  const CSS_ID = 'virtual:ampex-tokens.css'
  const JS_ID = 'virtual:ampex-tokens'
  const les = () => require('../lib/tokens.js') as {
    colors: Record<string, string>
    spacing: Record<string, number>
    radius: Record<string, number>
    sizes: Record<string, number>
  }

  const kebab = (s: string) => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase())

  return {
    name: 'ampex-tokens',
    resolveId: id => (id === CSS_ID || id === JS_ID ? '\0' + id : null),
    load(id) {
      if (id !== '\0' + CSS_ID && id !== '\0' + JS_ID) return null
      const t = les()
      if (id === '\0' + JS_ID) return `export default ${JSON.stringify(t)}`
      const linjer = [
        ...Object.entries(t.colors).map(([k, v]) => `  --c-${kebab(k)}: ${v};`),
        ...Object.entries(t.spacing).map(([k, v]) => `  --s-${kebab(k)}: ${v}px;`),
        ...Object.entries(t.radius).map(([k, v]) => `  --r-${kebab(k)}: ${v}px;`),
        ...Object.entries(t.sizes).map(([k, v]) => `  --z-${kebab(k)}: ${v}px;`),
      ]
      return `:root {\n${linjer.join('\n')}\n}`
    },
  }
}

export default defineConfig({
  plugins: [react(), ampexTokens()],
  clearScreen: false,
  resolve: {
    alias: {
      // Delt LOGIKK med montørappen — parser, prisregler, varegrupper.
      // Delt UI finnes ikke og skal ikke finnes; se docs/DESKTOP_OG_IMPORT.md.
      '@delt': fileURLToPath(new URL('../lib', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri kjører dev-serveren på fast port; feiler den, skal den ikke snike
  // seg over på en annen som konfigurasjonen ikke peker på.
  server: { port: 5174, strictPort: true, fs: { allow: [rot, fileURLToPath(new URL('..', import.meta.url))] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome110' },
  envPrefix: ['VITE_'],
})
