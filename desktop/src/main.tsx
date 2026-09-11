import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { AuthProvider } from '@/auth'
// Tokenene er en virtuell modul (se vite.config.ts) og kan derfor ikke hentes
// med @import fra styles.css — postcss-import løper før vite-pluginene og leter
// etter en fil på disk. Den lastes her i stedet, før stilarket som bruker den.
import 'virtual:ampex-tokens.css'
import '@/styles.css'

const rot = document.getElementById('rot')
if (!rot) throw new Error('Fant ikke #rot')

createRoot(rot).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
