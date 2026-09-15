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

/**
 * Tjenestearbeideren — bare i produksjonsbygget.
 *
 * I dev ville den lagt seg mellom Vite og nettleseren og servert gamle filer
 * etter en redigering; feilsøkingen av det koster mer enn den er verdt. Den
 * registreres etter `load` så den ikke konkurrerer med appens egen oppstart om
 * båndbredden på første besøk.
 *
 * `catch` er tomt med vilje: en nettleser som nekter (privat vindu, avslått
 * innstilling) skal gi en app uten hjemskjermikon, ikke en feil i konsollen.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(rot).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
