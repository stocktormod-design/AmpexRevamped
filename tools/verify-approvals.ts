/**
 * Selvtest for faglig godkjenning.
 *
 *   npm run verify:approvals
 *
 * Godkjenningen er en forskriftsfestet beslutning av et menneske. Den ene
 * måten koden kan svikte den på, er å la en godkjenning se gyldig ut etter at
 * grunnlaget er endret. Det er det denne testen finnes for.
 */
import { finnAvvik, sisteBeslutning, type Grunnlag, type Snapshot } from '../lib/approvals-calc'

let feil = 0

function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
  } else {
    console.log(`✓ ${navn}`)
  }
}

const naa: Grunnlag = {
  sumOre: 1240000, timer: 8, antallMateriell: 3,
  antallDokumenter: 2, antallFullforte: 2, antallSignaturer: 1, harKunde: true,
}
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  sumOre: 1240000, timer: 8, antallMateriell: 3,
  antallDokumenter: 2, antallSignaturer: 1,
  besluttetAt: new Date(2026, 7, 20), beslutning: 'godkjent', ...over,
})

sjekk('uendret grunnlag gir ingen avvik', finnAvvik(snap(), naa), [])

// Det klassiske: to timer føres etter at faglig ansvarlig har sagt ja.
sjekk('timer lagt til etterpå fanges',
  finnAvvik(snap({ timer: 6 }), naa), ['Timene er endret fra 6 til 8'])
sjekk('sum vises i kroner, ikke øre',
  finnAvvik(snap({ sumOre: 1100000 }), naa), ['Summen er endret fra 11000,00 kr til 12400,00 kr'])
sjekk('materiell', finnAvvik(snap({ antallMateriell: 2 }), naa), ['Materiellinjer er endret fra 2 til 3'])
sjekk('dokumenter', finnAvvik(snap({ antallDokumenter: 1 }), naa), ['Dokumenter er endret fra 1 til 2'])
sjekk('signaturer', finnAvvik(snap({ antallSignaturer: 0 }), naa), ['Signaturer er endret fra 0 til 1'])
sjekk('flere endringer listes hver for seg',
  finnAvvik(snap({ timer: 6, antallMateriell: 1 }), naa).length, 2)

// Et snapshot fra før feltet fantes skal ikke gi falskt alarm.
sjekk('null i snapshotet gir ikke avvik',
  finnAvvik(snap({ sumOre: null, timer: null, antallMateriell: null, antallDokumenter: null, antallSignaturer: null }), naa), [])
// En sum som ble redusert er like mye et avvik som en som økte.
sjekk('nedgang er også avvik',
  finnAvvik(snap({ sumOre: 1400000 }), naa), ['Summen er endret fra 14000,00 kr til 12400,00 kr'])
// Halve timer er normalt i faget og må vises med komma.
sjekk('halvtimer med norsk komma',
  finnAvvik(snap({ timer: 7.5 }), naa), ['Timene er endret fra 7,5 til 8'])

// Nyeste beslutning vinner — en ordre kan avvises, rettes og godkjennes.
const eldre = snap({ beslutning: 'avvist', besluttetAt: new Date(2026, 7, 18) })
const nyere = snap({ beslutning: 'godkjent', besluttetAt: new Date(2026, 7, 20) })
sjekk('nyeste beslutning vinner', sisteBeslutning([eldre, nyere])?.beslutning, 'godkjent')
sjekk('rekkefølgen i lista spiller ingen rolle', sisteBeslutning([nyere, eldre])?.beslutning, 'godkjent')
sjekk('ingen beslutninger gir null', sisteBeslutning([]), null)

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')
