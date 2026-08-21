/**
 * Selvtest av ordreklokka — kjør: npm run verify:klokke
 *
 * Timer blir til lønn og til fakturalinjer. En avrunding som bommer med et
 * kvarter per jobb blir en time i uka, og ingen oppdager det før noen teller
 * etter. Derfor står regelen her, med tall.
 */
import { kvarter, timerTekst } from '../lib/order-clock-calc'

let feil = 0
function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (ok) { console.log(`✓ ${navn}`); return }
  feil++
  console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
}

console.log('ordreklokke\n')

/* ── Kvarter ────────────────────────────────────────────────────────────── */
// Ingen fører «2,37 t». Kvarteret er enheten faget faktisk bruker.
sjekk('et kvarter', kvarter(15), 0.25)
sjekk('en halvtime', kvarter(30), 0.5)
sjekk('en time', kvarter(60), 1)
sjekk('tre og et kvart', kvarter(195), 3.25)
sjekk('åtte timer', kvarter(480), 8)

// Rundingen skal treffe NÆRMESTE kvarter, ikke alltid opp og ikke alltid ned.
sjekk('12 min blir et kvarter', kvarter(12), 0.25)
sjekk('20 min blir et kvarter', kvarter(20), 0.25)
sjekk('23 min blir en halvtime', kvarter(23), 0.5)
sjekk('37 min blir en halvtime', kvarter(37), 0.5)
sjekk('38 min blir tre kvarter', kvarter(38), 0.75)

// Et kort besøk skal ikke bli null timer — da forsvinner arbeidet fra
// fakturaen, og montøren har vært der.
sjekk('6 min blir aldri null', kvarter(6), 0.25)
sjekk('0 min blir aldri null', kvarter(0), 0.25)

/* ── Til mennesket ──────────────────────────────────────────────────────── */
// «3,25 t» må regnes om i hodet. «3 t 15 min» må ikke.
sjekk('hele timer', timerTekst(3), '3 t')
sjekk('timer og minutter', timerTekst(3.25), '3 t 15 min')
sjekk('halv time', timerTekst(0.5), '30 min')
sjekk('kvarter', timerTekst(0.25), '15 min')
sjekk('lang dag', timerTekst(8.75), '8 t 45 min')

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')
