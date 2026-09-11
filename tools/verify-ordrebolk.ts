/**
 * Selvtest for ordrebunkene.
 *
 *   npm run verify:ordrebolk
 *
 * Bunkene styrer hvem som gjør hva. Havner en ordre i feil bunke, ligger den
 * enten hos feltet når den venter på kontoret, eller motsatt — og den typen
 * feil oppdages først når noen spør hvorfor fakturaen aldri gikk.
 */
import { bolkFor, BOLKREKKEFOLGE, grupper, sammenlign, type Sorterbar } from '../lib/ordrebolk'

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

// ── De fem statusene blir tre bunker ───────────────────────────────────────

sjekk('mottatt er åpen', bolkFor('mottatt'), 'apen')
sjekk('planlagt er åpen', bolkFor('planlagt'), 'apen')
sjekk('pågår er åpen', bolkFor('pagaar'), 'apen')
sjekk('fakturaklar venter på godkjenning', bolkFor('fakturaklar'), 'godkjenning')
sjekk('fakturert er fakturert', bolkFor('fakturert'), 'fakturert')

// En ordre som forsvinner fra alle bunkene fordi noen la til en status er verre
// enn en som ligger feil. Ukjent havner blant de åpne.
sjekk('ukjent status havner blant de åpne', bolkFor('noe_nytt'), 'apen')
sjekk('tom status havner blant de åpne', bolkFor(''), 'apen')

// ── Lesrekkefølgen ────────────────────────────────────────────────────────

// Det som venter på et menneske står øverst. Det avsluttede nederst.
sjekk('til godkjenning leses først', BOLKREKKEFOLGE, ['godkjenning', 'apen', 'fakturert'])

// ── Sortering innad ───────────────────────────────────────────────────────

const rad = (over: Partial<Sorterbar>): Sorterbar => ({ bolk: 'apen', godkjent: false, nummer: 1, ...over })

sjekk('nyeste ordrenummer først', [rad({ nummer: 3 }), rad({ nummer: 9 }), rad({ nummer: 5 })].sort(sammenlign).map(r => r.nummer), [9, 5, 3])
sjekk('ordre uten nummer havner sist', [rad({ nummer: null }), rad({ nummer: 2 })].sort(sammenlign).map(r => r.nummer), [2, null])
sjekk('to uten nummer beholder rekkefølgen', [rad({ nummer: null }), rad({ nummer: null })].length, 2)

// Den viktige: i «Til godkjenning» kommer de UGODKJENTE først, uansett nummer.
// De venter på et menneske; de godkjente venter bare på at noen trykker faktura.
const godkjenning = [
  rad({ bolk: 'godkjenning', godkjent: true, nummer: 20 }),
  rad({ bolk: 'godkjenning', godkjent: false, nummer: 3 }),
  rad({ bolk: 'godkjenning', godkjent: true, nummer: 19 }),
  rad({ bolk: 'godkjenning', godkjent: false, nummer: 11 }),
].sort(sammenlign)
sjekk('ugodkjente først i godkjenningsbunken', godkjenning.map(r => r.godkjent), [false, false, true, true])
sjekk('og nummer sorterer innenfor hver halvdel', godkjenning.map(r => r.nummer), [11, 3, 20, 19])

// Godkjent-flagget skal IKKE flytte noe i de andre bunkene — der er det uten
// betydning, og en sortering som brukte det ville sett tilfeldig ut.
const apne = [
  rad({ bolk: 'apen', godkjent: true, nummer: 4 }),
  rad({ bolk: 'apen', godkjent: false, nummer: 8 }),
].sort(sammenlign)
sjekk('godkjent påvirker ikke de åpne', apne.map(r => r.nummer), [8, 4])

// ── Grupperingen ──────────────────────────────────────────────────────────

const alle = [
  rad({ bolk: 'fakturert', nummer: 1 }),
  rad({ bolk: 'apen', nummer: 7 }),
  rad({ bolk: 'godkjenning', godkjent: false, nummer: 5 }),
  rad({ bolk: 'apen', nummer: 9 }),
]
const g = grupper(alle)
sjekk('tre bunker, i lesrekkefølge', g.map(x => x.bolk), ['godkjenning', 'apen', 'fakturert'])
sjekk('navnene er menneskelige', g.map(x => x.navn), ['Til godkjenning', 'Åpne', 'Fakturert'])
sjekk('de åpne er sortert', g[1].rader.map(r => r.nummer), [9, 7])

// En tom bunke er en overskrift uten innhold. Den skal ikke tegnes.
sjekk('tomme bunker droppes', grupper([rad({ bolk: 'apen', nummer: 1 })]).map(x => x.bolk), ['apen'])
sjekk('ingenting inn gir ingenting ut', grupper([]), [])

console.log(feil === 0 ? '\nAlle påstander holder.' : `\n${feil} påstander feilet.`)
process.exit(feil === 0 ? 0 : 1)
