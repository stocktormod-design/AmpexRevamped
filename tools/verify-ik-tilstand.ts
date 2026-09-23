/**
 * Selvtest for «er internkontrollen i orden?».
 *
 *   npm run verify:ik-tilstand
 *
 * Tallet øverst på IK-forsida er det eieren viser fram på tilsyn. Sier det
 * «i orden» når et kapittel er forfalt eller ulest, er det en feil som først
 * oppdages av DSB.
 */
import { kapittelTilstand, nesteKo, svar, type KapittelInn } from '../lib/ik/tilstand'

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

const naa = new Date('2026-09-23T10:00:00')
const k = (over: Partial<KapittelInn>): KapittelInn => ({
  id: 'x', nummer: '4', tittel: 'Avvik', status: 'vedtatt', maaVaereSkriftlig: true,
  harRutine: true, sistGjennomgatt: '2026-03-01', intervallMnd: 12, versjon: 2, endretEtterVedtak: false,
  lestAv: 3, skalLese: 3, ...over,
})

// ── Ett kapittel ──────────────────────────────────────────────────────────
sjekk('alt på plass er i orden', kapittelTilstand(k({}), naa).iOrden, true)
sjekk('uskrevet utkast mangler to ting, i rekkefølge',
  kapittelTilstand(k({ harRutine: false, status: 'utkast' }), naa).mangler, ['ikke_skrevet', 'ikke_vedtatt'])
sjekk('forfalt gjennomgang er ikke i orden',
  kapittelTilstand(k({ sistGjennomgatt: '2025-09-01' }), naa).mangler, ['gjennomgang_forfalt'])
sjekk('ingen delpoeng: én som ikke har lest holder kapittelet ute',
  kapittelTilstand(k({ lestAv: 2 }), naa).iOrden, false)
sjekk('ingen ansatte å spørre = ingen lesing mangler',
  kapittelTilstand(k({ lestAv: 0, skalLese: 0 }), naa).iOrden, true)
sjekk('utkast krever ikke lesing (ingenting vedtatt å lese)',
  kapittelTilstand(k({ status: 'utkast', lestAv: 0 }), naa).mangler, ['ikke_vedtatt'])
sjekk('rutine endret etter vedtak: ikke i orden før det er vedtatt på nytt',
  kapittelTilstand(k({ endretEtterVedtak: true }), naa).mangler, ['endret_etter_vedtak'])
sjekk('endringer i et utkast teller ikke som «etter vedtak»',
  kapittelTilstand(k({ status: 'utkast', endretEtterVedtak: true }), naa).mangler, ['ikke_vedtatt'])
sjekk('utgått kapittel er ikke vedtatt',
  kapittelTilstand(k({ status: 'utgatt' }), naa).mangler, ['ikke_vedtatt'])
sjekk('fristen er sist gjennomgått + intervall',
  kapittelTilstand(k({}), naa).frist?.toISOString().slice(0, 10), new Date('2027-03-01').toISOString().slice(0, 10))
sjekk('utkast har ingen frist', kapittelTilstand(k({ status: 'utkast' }), naa).frist, null)

// ── Svaret ────────────────────────────────────────────────────────────────
const s = svar([
  k({ id: 'a', nummer: '4' }),
  k({ id: 'b', nummer: '5', status: 'utkast' }),
  k({ id: 'c', nummer: '9', maaVaereSkriftlig: false }),
  k({ id: 'd', nummer: '1', maaVaereSkriftlig: false, sistGjennomgatt: '2025-01-01' }),
], naa)
sjekk('teller kapitler i orden', [s.iOrden, s.totalt], [2, 4])
sjekk('lovpålagte teller for seg', [s.lovpalagtIOrden, s.lovpalagtTotalt], [1, 2])
sjekk('neste frist er den nærmeste blant de som er i orden',
  s.nesteFrist?.getTime(), new Date('2027-03-01').getTime())

// ── Køen ──────────────────────────────────────────────────────────────────
const ko = nesteKo(
  svar([
    k({ id: 'ulest', nummer: '9', maaVaereSkriftlig: false, lestAv: 1 }),
    k({ id: 'uskrevet', nummer: '4', harRutine: false, status: 'utkast' }),
    k({ id: 'forfalt', nummer: '2', maaVaereSkriftlig: false, sistGjennomgatt: '2025-01-01' }),
    k({ id: 'snart', nummer: '6', maaVaereSkriftlig: false, sistGjennomgatt: '2025-10-10' }),
  ], naa),
  [
    { id: 'lav', tittel: 'Lav', alvorlighet: 'lav', status: 'apent', frist: null },
    { id: 'over', tittel: 'Over frist', alvorlighet: 'lav', status: 'apent', frist: '2026-09-22' },
    { id: 'idag', tittel: 'Frist i dag', alvorlighet: 'lav', status: 'apent', frist: '2026-09-23T12:00:00Z' },
    { id: 'lukket', tittel: 'Lukket', alvorlighet: 'kritisk', status: 'lukket', frist: '2020-01-01' },
    { id: 'hoy', tittel: 'Høy', alvorlighet: 'hoy', status: 'apent', frist: null },
  ],
  [
    { userId: '1', navn: 'Ola', type: 'fse', status: 'utgatt' },
    { userId: '2', navn: 'Kari', type: 'fse', status: 'utgatt' },
    { userId: '3', navn: 'Per', type: 'fse', status: 'gyldig' },
    { userId: '3', navn: 'Per', type: 'forstehjelp', status: 'utgaar' },
  ],
  naa,
)
const nokkel = ko.map(o => o.type === 'kapittel' ? `${o.grad}:k${o.tilstand.kapittel.nummer}:${o.mangel}`
  : o.type === 'avvik' ? `${o.grad}:a:${o.avvik.id}` : `${o.grad}:${o.kurs}:${o.status}:${o.hvem.join('+')}`)
sjekk('køen: nå først (avvik/kurs før ikke-lovpålagte kapitler), så snart, så gjøre med lovpålagte først', nokkel, [
  'na:a:over',
  'na:fse:utgatt:Ola+Kari',
  'na:k2:gjennomgang_forfalt',
  'snart:a:hoy',
  'snart:forstehjelp:utgaar:Per',
  'snart:k6:gjennomgang_snart',
  'gjore:k4:ikke_skrevet',
  'gjore:k9:ikke_lest',
])
sjekk('frist i dag er ikke over frist', nokkel.some(n => n.includes('idag')), false)
sjekk('lukkede avvik står aldri i køen', nokkel.some(n => n.includes('lukket')), false)

if (feil) { console.error(`\n${feil} feil`); process.exit(1) }
console.log('\nAlle påstander holder.')
