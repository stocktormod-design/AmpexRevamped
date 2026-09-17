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
    navigator.serviceWorker.register('/sw.js').then(reg => {
      /**
       * Se etter ny kode mens fanen står åpen.
       *
       * Nettleseren spør av seg selv bare ved navigering, og kontoret er én
       * side som aldri navigerer — en fane som står åpen hele dagen ville
       * ikke sett en utrulling før noen lastet på nytt. `update()` er en
       * betinget GET mot `sw.js`; er den uendret, koster den et 304.
       *
       * Bare når fanen er synlig: en minimert fane skal ikke banke på
       * serveren hvert minutt.
       */
      const se_etter = () => { if (!document.hidden) reg.update().catch(() => {}) }
      setInterval(se_etter, 60_000)
      document.addEventListener('visibilitychange', se_etter)
    }).catch(() => {})
  })

  /**
   * Tar en NY arbeider over, må sida hente seg selv på nytt.
   *
   * `skipWaiting` + `claim` gjør at den nye arbeideren overtar med en gang,
   * men fanen som alt står åpen beholder HTML-en og filene den startet med.
   * Resultatet er en app som ser oppdatert ut i nettverksfanen og oppfører seg
   * som før på skjermen — nøyaktig det som skjedde da rullerettelsen var ute
   * og telefonen fortsatt ikke kunne rulle.
   *
   * `controllerchange` fyrer når overtakelsen er et faktum. Vakta hindrer
   * løkke: uten den kan en ny arbeider som tar over under omlastingen sette i
   * gang en ny omlasting.
   */
  let laster = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (laster) return
    laster = true
    window.location.reload()
  })
}

createRoot(rot).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
