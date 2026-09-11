/**
 * Selvtest for serviceavtaler.
 *
 *   npm run verify:service
 *
 * Gjentakende arbeid er det mest lønnsomme et elektrofirma har, og en avtale
 * som bommer på datoen mister enten kunden (for sent) eller tilliten (for
 * tidlig). Tre klasser feil er lette å skrive og umulige å oppdage før et år
 * har gått:
 *
 *   1. **Månedsoverløp.** 31. januar + 1 måned er 28. februar. JS sier 3. mars.
 *   2. **Sommertid.** «Om 12 måneder» skal treffe samme DATO, ikke samme antall
 *      millisekunder — mars og oktober har døgn på 23 og 25 timer.
 *   3. **Utsatt kontroll.** Neste forfall regnes fra da det faktisk ble gjort,
 *      ellers kommer to kontroller tett og skjevheten varer for alltid.
 */
import {
  leggTilManeder, nesteForfallEtterUtforelse, forsteForfall, forfallsstatus,
  dagerTilForfall, kommendeForfall, intervallNavn, tilDagStart,
} from '../lib/service-calc'

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
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/* ── Månedsoverløp ─────────────────────────────────────────────────────────── */

sjekk('31. jan + 1 mnd = 28. feb (ikke 3. mars)',
  iso(leggTilManeder(new Date(2026, 0, 31), 1)), '2026-02-28')
sjekk('31. jan + 1 mnd i skuddår = 29. feb',
  iso(leggTilManeder(new Date(2024, 0, 31), 1)), '2024-02-29')
sjekk('31. mai + 1 mnd = 30. juni',
  iso(leggTilManeder(new Date(2026, 4, 31), 1)), '2026-06-30')
sjekk('15. mars + 12 mnd = 15. mars året etter',
  iso(leggTilManeder(new Date(2026, 2, 15), 12)), '2027-03-15')
sjekk('29. feb + 12 mnd = 28. feb (ikke-skuddår)',
  iso(leggTilManeder(new Date(2024, 1, 29), 12)), '2025-02-28')
sjekk('desember + 1 mnd krysser årsskiftet',
  iso(leggTilManeder(new Date(2026, 11, 15), 1)), '2027-01-15')

/* ── Sommertid: datoen skal holde, ikke millisekundene ─────────────────────── */

// Norge: sommertid starter siste søndag i mars, slutter siste søndag i oktober.
sjekk('over sommertidsstart (mars) beholder datoen',
  iso(leggTilManeder(new Date(2026, 1, 20), 2)), '2026-04-20')
sjekk('over sommertidsslutt (oktober) beholder datoen',
  iso(leggTilManeder(new Date(2026, 8, 25), 2)), '2026-11-25')
sjekk('årlig kontroll midt i sommertidsvinduet treffer samme dato',
  iso(nesteForfallEtterUtforelse(new Date(2026, 5, 1), { maneder: 12 })), '2027-06-01')

/* ── Utsatt kontroll flytter hele rekken ───────────────────────────────────── */

// Avtalt 1. mars, utført 1. mai (to måneder for sent). Neste skal være 1. mai
// året etter — IKKE 1. mars, som ville gitt bare ti måneder til neste kontroll.
sjekk('utsatt kontroll regnes fra utførelsen',
  iso(nesteForfallEtterUtforelse(new Date(2026, 4, 1), { maneder: 12 })), '2027-05-01')

sjekk('ny avtale uten kontroll ved start forfaller etter ett intervall',
  iso(forsteForfall(new Date(2026, 7, 29), { maneder: 12 })), '2027-08-29')
sjekk('ny avtale MED kontroll ved start forfaller med en gang',
  iso(forsteForfall(new Date(2026, 7, 29), { maneder: 12 }, true)), '2026-08-29')

/* ── Status og dager ───────────────────────────────────────────────────────── */

const naa = new Date(2026, 7, 29, 14, 30) // ettermiddag: klokkeslettet skal ikke telle

sjekk('forfall i går er forfalt', forfallsstatus(new Date(2026, 7, 28), naa), 'forfalt')
sjekk('forfall i dag er «nå»', forfallsstatus(new Date(2026, 7, 29, 8, 0), naa), 'naa')
sjekk('forfall om 30 dager er «nå» (varselvinduet)',
  forfallsstatus(new Date(2026, 8, 28), naa), 'naa')
sjekk('forfall om 31 dager er kommende', forfallsstatus(new Date(2026, 8, 29), naa), 'kommende')
sjekk('kortere varselvindu flytter grensen',
  forfallsstatus(new Date(2026, 8, 20), naa, 7), 'kommende')

sjekk('dagerTilForfall teller hele dager, ikke timer',
  dagerTilForfall(new Date(2026, 7, 30, 6, 0), naa), 1)
sjekk('forfalt gir negativt tall', dagerTilForfall(new Date(2026, 7, 27), naa), -2)
// Døgnet med 23 timer (sommertidsstart) må ikke gi 0 eller 2 dager.
sjekk('sommertidsdøgnet teller som én dag',
  dagerTilForfall(new Date(2026, 2, 30), new Date(2026, 2, 29)), 1)

/* ── Kommende forfall ──────────────────────────────────────────────────────── */

const rekke = kommendeForfall(new Date(2026, 0, 31), { maneder: 1 }, new Date(2026, 4, 1))
sjekk('månedlig rekke fra 31. januar bevarer «siste dag»-intensjonen',
  rekke.map(iso), ['2026-01-31', '2026-02-28', '2026-03-28', '2026-04-28'])
sjekk('rekken stopper på maks',
  kommendeForfall(new Date(2026, 0, 1), { maneder: 1 }, new Date(2036, 0, 1), 3).length, 3)
sjekk('tom rekke når vinduet er passert',
  kommendeForfall(new Date(2027, 0, 1), { maneder: 12 }, new Date(2026, 0, 1)), [])

/* ── Etiketter ─────────────────────────────────────────────────────────────── */

sjekk('12 måneder heter «Årlig»', intervallNavn(12), 'Årlig')
sjekk('ukjent intervall får en forståelig etikett', intervallNavn(7), 'Hver 7. måned')

sjekk('tilDagStart nullstiller klokka', tilDagStart(naa).getHours(), 0)

console.log(feil === 0 ? '\nAlle påstander grønne.' : `\n${feil} påstand(er) feilet.`)
process.exit(feil === 0 ? 0 : 1)
