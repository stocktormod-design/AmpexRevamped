/**
 * Selvtest for tegningsutsnittet. Samme mønster som de andre: et kjørbart
 * skript med harde påstander, ingen testrunner.
 *
 *   npm run verify:tegning
 *
 * Dette er regningen kontoret og appen DELER. Driver de to fra hverandre,
 * havner en oppgave-pin ett sted på telefonen og et annet på kontorskjermen —
 * og en pin som peker feil sted i et maskinrom er verre enn ingen pin.
 *
 * De to feilene som koster mest:
 *   1. Zoom som ikke holder punktet under pekeren i ro. Da glir tegningen vekk
 *      mens man zoomer, og man må panorere tilbake hver gang.
 *   2. Utsnitt som ikke speiles riktig mellom ark med ULIKT format. «Samme
 *      sted» er ikke samme tallpar når det ene arket er stående og det andre
 *      liggende.
 */
import {
  finnPin, HELE_SIDEN, iFirkant, klemUtsnitt, MIN_BREDDE, panorer, speilTil,
  tilSide, tilSkjerm, utsnittshoyde, zoomniva, zoomOm,
  type Rute, type Utsnitt,
} from '../lib/tegning/viewport'

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

/** Flyttall trenger slingringsmonn — vi sammenligner ikke bit for bit. */
function nesten(navn: string, faktisk: number, forventet: number, margin = 1e-6) {
  const ok = Math.abs(faktisk - forventet) <= margin
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${forventet}\n    faktisk:   ${faktisk}`)
  } else {
    console.log(`✓ ${navn}`)
  }
}

// Kvadratisk rute og kvadratisk ark: da er regningen lett å lese i hodet.
const RUTE: Rute = { bredde: 1000, hoyde: 1000 }
const KVADRAT = 1

// ── Fram og tilbake ────────────────────────────────────────────────────────

{
  const midt = tilSkjerm({ x: 0.5, y: 0.5 }, HELE_SIDEN, RUTE, KVADRAT)
  sjekk('midt på arket er midt i ruta', midt, { x: 500, y: 500 })

  const hjorne = tilSkjerm({ x: 0, y: 0 }, HELE_SIDEN, RUTE, KVADRAT)
  sjekk('øvre venstre hjørne er origo', hjorne, { x: 0, y: 0 })

  // Den viktigste påstanden: konverteringen må være reversibel. Er den ikke
  // det, driver en pin litt for hver gang den tegnes om.
  const u: Utsnitt = { x: 0.2, y: 0.3, bredde: 0.4 }
  const p = { x: 0.35, y: 0.45 }
  const tilbake = tilSide(tilSkjerm(p, u, RUTE, KVADRAT), u, RUTE, KVADRAT)
  nesten('fram og tilbake gir samme x', tilbake.x, p.x)
  nesten('fram og tilbake gir samme y', tilbake.y, p.y)
}

// ── Zoom holder ankeret i ro ───────────────────────────────────────────────
//
// Zoomer man om midten i stedet for om pekeren, glir det man ser på vekk.

{
  const anker = { x: 250, y: 750 }
  const u = klemUtsnitt({ x: 0.1, y: 0.1, bredde: 0.8 }, RUTE, KVADRAT)
  const foer = tilSide(anker, u, RUTE, KVADRAT)

  const etter = zoomOm(u, anker, 2, RUTE, KVADRAT)
  const naa = tilSide(anker, etter, RUTE, KVADRAT)

  nesten('punktet under pekeren blir liggende (x)', naa.x, foer.x, 1e-9)
  nesten('punktet under pekeren blir liggende (y)', naa.y, foer.y, 1e-9)
  nesten('og zoomen ble faktisk doblet', etter.bredde, u.bredde / 2, 1e-9)
}

{
  // Zoom ut igjen skal gi utgangspunktet tilbake.
  const u = klemUtsnitt({ x: 0.2, y: 0.2, bredde: 0.5 }, RUTE, KVADRAT)
  const inn = zoomOm(u, { x: 400, y: 600 }, 2, RUTE, KVADRAT)
  const ut = zoomOm(inn, { x: 400, y: 600 }, 0.5, RUTE, KVADRAT)
  nesten('zoom inn og ut gir samme bredde', ut.bredde, u.bredde, 1e-9)
  nesten('samme x', ut.x, u.x, 1e-9)
}

// ── Grensene ───────────────────────────────────────────────────────────────

{
  const forLangtInn = zoomOm(HELE_SIDEN, { x: 500, y: 500 }, 1000, RUTE, KVADRAT)
  nesten('zoom stopper på taket', forLangtInn.bredde, MIN_BREDDE)

  const forLangtUt = zoomOm({ x: 0.4, y: 0.4, bredde: 0.2 }, { x: 500, y: 500 }, 0.001, RUTE, KVADRAT)
  nesten('zoom ut stopper på hele siden', forLangtUt.bredde, 1)

  sjekk('hele siden gir zoomnivå 1', zoomniva(HELE_SIDEN), 1)
  sjekk('kvart bredde gir 4×', zoomniva({ x: 0, y: 0, bredde: 0.25 }), 4)
}

{
  // Arket skal ikke kunne dras ut av syne.
  const dratt = panorer({ x: 0, y: 0, bredde: 0.5 }, 100000, 100000, RUTE, KVADRAT)
  sjekk('panorering klemmes til arket', [dratt.x, dratt.y], [0, 0])

  const dratt2 = panorer({ x: 0.5, y: 0.5, bredde: 0.5 }, -100000, -100000, RUTE, KVADRAT)
  nesten('og stopper på motsatt kant (x)', dratt2.x, 0.5)
  nesten('og stopper på motsatt kant (y)', dratt2.y, 0.5)
}

{
  // Er utsnittet større enn arket, skal arket SENTRERES — ikke ligge i hjørnet.
  const bredRute: Rute = { bredde: 2000, hoyde: 1000 }
  const u = klemUtsnitt(HELE_SIDEN, bredRute, KVADRAT)
  nesten('for høyt ark sentreres i stedet for å klemmes', u.y, (1 - utsnittshoyde(u, bredRute, KVADRAT)) / 2)
}

// ── Speiling mellom ark med ULIKT format ───────────────────────────────────
//
// Multiview-ruta er like stor, men planen kan være A3 liggende og snittet A4
// stående. «Samme sted» er da ikke samme tallpar.

{
  const staaende = 0.707   // A4 stående
  const liggende = 1.414   // A4 liggende

  const u: Utsnitt = { x: 0.25, y: 0.25, bredde: 0.5 }
  const speilet = speilTil(u, staaende, liggende, RUTE)

  nesten('bredden beholdes ved speiling', speilet.bredde, u.bredde)

  // Midtpunktet er det som skal bevares — ikke øvre kant.
  const midtFoer = u.y + utsnittshoyde(u, RUTE, staaende) / 2
  const midtEtter = speilet.y + utsnittshoyde(speilet, RUTE, liggende) / 2
  nesten('midtpunktet bevares på tvers av format', midtEtter, midtFoer, 1e-9)
}

{
  // Speiling til SAMME format skal ikke flytte noe.
  const u = klemUtsnitt({ x: 0.3, y: 0.2, bredde: 0.4 }, RUTE, KVADRAT)
  const speilet = speilTil(u, KVADRAT, KVADRAT, RUTE)
  nesten('samme format gir samme utsnitt (x)', speilet.x, u.x, 1e-9)
  nesten('samme format gir samme utsnitt (y)', speilet.y, u.y, 1e-9)
}

// ── Treffdeteksjon ─────────────────────────────────────────────────────────

{
  const rom = { x: 0.2, y: 0.2, w: 0.3, h: 0.2 }
  sjekk('punkt inne i rommet treffer', iFirkant({ x: 0.3, y: 0.3 }, rom), true)
  sjekk('punkt utenfor treffer ikke', iFirkant({ x: 0.6, y: 0.3 }, rom), false)
  sjekk('kanten regnes som innenfor', iFirkant({ x: 0.2, y: 0.2 }, rom), true)
}

{
  // Treffradius måles i PIKSLER: en pin er like stor uansett zoom.
  const pins = [
    { id: 'a', x: 0.25, y: 0.25 },
    { id: 'b', x: 0.75, y: 0.75 },
  ]
  const traff = finnPin(pins, { x: 250, y: 250 }, HELE_SIDEN, RUTE, KVADRAT)
  sjekk('klikk på pin treffer den', traff?.id, 'a')

  const bom = finnPin(pins, { x: 500, y: 500 }, HELE_SIDEN, RUTE, KVADRAT)
  sjekk('klikk i tomrommet treffer ingen', bom, null)

  // Zoomet inn ligger de to pinnene langt fra hverandre på skjermen, og
  // treffradiusen skal fortsatt være 18 piksler — ikke 18 sidekoordinater.
  const naer: Utsnitt = { x: 0.2, y: 0.2, bredde: 0.1 }
  const zoomTreff = finnPin(pins, tilSkjerm(pins[0], naer, RUTE, KVADRAT), naer, RUTE, KVADRAT)
  sjekk('treffer også når man er zoomet inn', zoomTreff?.id, 'a')
}

console.log('')
if (feil > 0) {
  console.error(`${feil} påstand(er) feilet.`)
  process.exit(1)
}
console.log('Alle påstander holder.')
