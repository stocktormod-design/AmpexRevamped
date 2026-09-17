/**
 * Stempler tjenestearbeideren med byggetidspunktet. Kjøres etter `vite build`.
 *
 * Cachenavnet i `public/sw.js` ER oppryddingen: `activate` sletter hver cache
 * som ikke heter det gjeldende navnet. Med et fast navn måtte noen huske å
 * bumpe et tall for hver utrulling — og glemte man det, satt en åpen fane
 * igjen på gammel kode uten å vite det.
 *
 * Nå får hver utrulling sitt eget navn. Nettleseren ser at `sw.js` er en annen
 * fil, installerer den nye, `skipWaiting` + `claim` lar den overta, og
 * `controllerchange` i main.tsx laster fanen én gang.
 *
 * Innlogging ligger i localStorage hos Supabase og røres ALDRI av dette — en
 * full cachetømming logger ingen ut.
 *
 * Egen fil og ikke en Vite-plugin fordi Vite kopierer `public/` etter at
 * plugin-krokene har kjørt; da stod plassholderen igjen i `dist/sw.js`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sti = fileURLToPath(new URL('../dist/sw.js', import.meta.url))
const stempel = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
const kilde = readFileSync(sti, 'utf8')

// Hele den siterte strengen byttes, ikke bare plassholderordet: ordet står
// også i kommentaren over konstanten, og en `replace` på det alene stemplet
// kommentaren mens selve cachenavnet ble stående uendret.
const MAL = "'ampex-kontor-__BYGG__'"

if (!kilde.includes(MAL)) {
  console.error(`sw.js mangler ${MAL} — cachen ville blitt stående på samme navn.`)
  process.exit(1)
}

const stemplet = kilde.replace(MAL, `'ampex-kontor-${stempel}'`)
if (stemplet.includes(MAL)) {
  console.error('sw.js har flere cachenavn å stemple. Rydd opp før utrulling.')
  process.exit(1)
}

writeFileSync(sti, stemplet)
console.log(`sw.js stemplet: ampex-kontor-${stempel}`)
