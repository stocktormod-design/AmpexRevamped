/**
 * Selvtest for ukeplanen (ordrekalenderen). Samme mønster som verify-timesheet.
 *
 *   npm run verify:kalender
 *
 * Feilen som koster her er en jobb i feil dag: da står ingen på døra til
 * kunden. De to måtene det skjer på er (a) sommertid, som gjør et døgn 23
 * eller 25 timer langt, og (b) jobber fra nabouken som lekker inn.
 */
import { byggUkeplan, standardDag, ukeStart } from '../lib/schedule-calc'

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

type Jobb = { id: string; scheduledAt: Date | null }
const jobb = (id: string, d: Date | null): Jobb => ({ id, scheduledAt: d })
const ider = <T extends Jobb>(js: T[]) => js.map(j => j.id)

// Uke 34 i 2026: mandag 17. – søndag 23. august.
const uke = ukeStart(new Date(2026, 7, 19))

// ── Fordeling på dag ─────────────────────────────────────────────────────────
{
  const plan = byggUkeplan(uke, [
    jobb('ons-14', new Date(2026, 7, 19, 14, 0)),
    jobb('ons-08', new Date(2026, 7, 19, 8, 0)),
    jobb('man', new Date(2026, 7, 17, 7, 30)),
    jobb('søn-2359', new Date(2026, 7, 23, 23, 59)),
    jobb('uten', null),
    jobb('forrige-uke', new Date(2026, 7, 16, 12, 0)),
    jobb('neste-uke', new Date(2026, 7, 24, 12, 0)),
  ])
  sjekk('mandag', ider(plan.dager[0].jobber), ['man'])
  // Klokkeslett bestemmer rekkefølgen i dagen, ikke rekkefølgen de kom inn i.
  sjekk('onsdag sortert på klokkeslett', ider(plan.dager[2].jobber), ['ons-08', 'ons-14'])
  // Søndag 23:59 er ukens siste minutt — den skal ikke havne i neste uke.
  sjekk('søndag 23:59 er inne', ider(plan.dager[6].jobber), ['søn-2359'])
  sjekk('søndagen FØR er ute', ider(plan.dager.flatMap(d => d.jobber)).includes('forrige-uke'), false)
  sjekk('mandagen ETTER er ute', ider(plan.dager.flatMap(d => d.jobber)).includes('neste-uke'), false)
  // En jobb uten dato er ikke planlagt — men den skal ikke forsvinne heller.
  sjekk('uten dato havner for seg', ider(plan.utenDato), ['uten'])
  sjekk('sum teller kun uken', plan.sumJobber, 4)
  sjekk('maks per dag', plan.maksPerDag, 2)
  sjekk('sju dager', plan.dager.length, 7)
}

// ── Sommertid ────────────────────────────────────────────────────────────────
// Norge stiller klokka natt til søndag 29. mars 2026 (fram) og 25. oktober
// 2026 (tilbake). En floor-divisjon på 86 400 000 bommer med en dag her.
{
  const vaar = ukeStart(new Date(2026, 2, 25)) // mandag 23. mars
  const plan = byggUkeplan(vaar, [jobb('søndag-etter-omstilling', new Date(2026, 2, 29, 10, 0))])
  sjekk('søndag i sommertidsuken (vår) er dag 6', ider(plan.dager[6].jobber), ['søndag-etter-omstilling'])

  const host = ukeStart(new Date(2026, 9, 21)) // mandag 19. oktober
  const plan2 = byggUkeplan(host, [jobb('søndag-etter-omstilling', new Date(2026, 9, 25, 10, 0))])
  sjekk('søndag i sommertidsuken (høst) er dag 6', ider(plan2.dager[6].jobber), ['søndag-etter-omstilling'])
}

// ── Hvilken dag åpnes ────────────────────────────────────────────────────────
{
  const plan = byggUkeplan(uke, [jobb('tor', new Date(2026, 7, 20, 9, 0))])
  // Er du i uken, er dagen din i dag.
  sjekk('i dag når uken er inneværende', standardDag(plan, new Date(2026, 7, 19, 16, 0)), 2)
  // Blar du til en annen uke, er mandag som regel tom — åpne der jobbene er.
  sjekk('første dag med jobber ellers', standardDag(plan, new Date(2026, 8, 2)), 3)
  sjekk('mandag når uken er tom', standardDag(byggUkeplan(uke, []), new Date(2026, 8, 2)), 0)
}

console.log(feil === 0 ? '\nAlle sjekker passerte.' : `\n${feil} sjekk(er) feilet.`)
process.exit(feil === 0 ? 0 : 1)
