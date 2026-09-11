/**
 * Selvtest for internkontroll-skjelettet.
 *
 *   npm run verify:ik-skjelett
 *
 * Dette er ikke pengelogikk, men det er noe verre: et internkontrollsystem er
 * det Arbeidstilsynet og DSB ber om å få se. Et skjelett som teller feil, eller
 * som sier at systemet er komplett når avvikshåndteringen mangler, er en feil
 * som først oppdages på tilsyn.
 */
import {
  erForfalt,
  fullstendighet,
  IK_SKJELETT,
  maaVaereSkriftlig,
  nesteGjennomgang,
} from '../lib/ik/skjelett'

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

// ── Skjelettet henger sammen ───────────────────────────────────────────────

sjekk('numrene er unike', new Set(IK_SKJELETT.map(p => p.nummer)).size, IK_SKJELETT.length)
sjekk('ingen punkter uten tittel', IK_SKJELETT.filter(p => !p.tittel.trim()).length, 0)
sjekk('ingen punkter uten formål', IK_SKJELETT.filter(p => !p.formal.trim()).length, 0)
sjekk('ingen punkter uten hint til den som skal skrive', IK_SKJELETT.filter(p => !p.hint.trim()).length, 0)
sjekk('alle intervaller er innenfor det basen godtar', IK_SKJELETT.every(p => p.intervallMnd >= 1 && p.intervallMnd <= 120), true)

// ── Det forskriften krever skriftlig ───────────────────────────────────────

// Internkontrollforskriften § 5 tredje ledd: den skriftlige dokumentasjonen
// skal minst omfatte andre ledd nr. 4 til nr. 8. Det er fem punkter, og de er
// hele grunnlaget for «er systemet komplett».
const skriftlige = IK_SKJELETT.filter(p => p.maaVaereSkriftlig)
sjekk('fem punkter er merket som lovpålagt skriftlige', skriftlige.length, 5)
sjekk(
  'og det er nr. 4 til nr. 8 i forskriften',
  skriftlige.map(p => p.hjemmel),
  [
    'Internkontrollforskriften § 5 andre ledd nr. 4',
    'Internkontrollforskriften § 5 andre ledd nr. 5',
    'Internkontrollforskriften § 5 andre ledd nr. 6',
    'Internkontrollforskriften § 5 andre ledd nr. 7',
    'Internkontrollforskriften § 5 andre ledd nr. 8',
  ],
)
sjekk('avvikshåndtering er blant dem', maaVaereSkriftlig('4'), true)
sjekk('oversikt over lover er ikke krav om skriftlighet', maaVaereSkriftlig('6'), false)
sjekk('et ukjent nummer er ikke lovpålagt', maaVaereSkriftlig('99'), false)

// De el-faglige punktene har med vilje TOM hjemmel. En feil paragrafhenvisning
// i et IK-system er verre enn ingen, og faglig ansvarlig skal slå den opp selv.
sjekk(
  'elfaglige punkter oppgir ingen paragraf vi ikke er sikre på',
  IK_SKJELETT.filter(p => p.gruppe === 'elfag').every(p => p.hjemmel === ''),
  true,
)
sjekk(
  'men de har alle et hint som peker på riktig forskrift',
  IK_SKJELETT.filter(p => p.gruppe === 'elfag').every(p => p.hint.length > 40),
  true,
)

// ── Fullstendighet ─────────────────────────────────────────────────────────

const alle = IK_SKJELETT.map(p => ({
  nummer: p.nummer,
  harRutine: true,
  status: 'vedtatt',
  maaVaereSkriftlig: p.maaVaereSkriftlig,
}))

sjekk('et ferdig system er komplett', fullstendighet(alle).pa_plass, 5)
sjekk('og har ingenting utestående', fullstendighet(alle).manglerInnhold, [])

// Det farlige tilfellet: alt annet er skrevet, men avvikshåndteringen mangler.
const utenAvvik = alle.map(p => (p.nummer === '4' ? { ...p, harRutine: false } : p))
const f = fullstendighet(utenAvvik)
sjekk('mangler avvikshåndteringen, er systemet ikke komplett', f.pa_plass, 4)
sjekk('og punktet står navngitt', f.manglerInnhold, ['4'])

// Fjorten fine kapitler betyr ingenting hvis ingen av de fem er vedtatt.
const bareUtkast = alle.map(p => ({ ...p, status: 'utkast' }))
sjekk('skrevet, men ikke vedtatt, teller ikke', fullstendighet(bareUtkast).pa_plass, 0)
sjekk('og de fem står oppført som ikke vedtatt', fullstendighet(bareUtkast).ikkeVedtatt, ['1', '2', '3', '4', '5'])

// Punkter som IKKE er lovpålagt skriftlige skal aldri telle med, verken opp
// eller ned. Ellers kunne et firma «fylt opp» prosenten med egne kapitler
// forskriften ikke spør etter.
const medEgneKapitler = [
  ...alle,
  { nummer: '20', harRutine: true, status: 'vedtatt', maaVaereSkriftlig: false },
  { nummer: '21', harRutine: true, status: 'vedtatt', maaVaereSkriftlig: false },
]
sjekk('egne kapitler endrer ikke nevneren', fullstendighet(medEgneKapitler).kreves, 5)
sjekk('og de teller ikke som oppfylte krav heller', fullstendighet(medEgneKapitler).pa_plass, 5)

// ── Gjennomgangsfristen ────────────────────────────────────────────────────

const NAA = new Date('2026-08-21T12:00:00.000Z')

sjekk('aldri gjennomgått er ikke det samme som forfalt', erForfalt(null, 12, NAA), false)
sjekk('gjennomgått for en måned siden er ikke forfalt', erForfalt('2026-07-21', 12, NAA), false)
sjekk('gjennomgått for elleve måneder siden er ikke forfalt', erForfalt('2025-09-21', 12, NAA), false)
sjekk('gjennomgått for tretten måneder siden ER forfalt', erForfalt('2025-07-21', 12, NAA), true)
sjekk('kort intervall forfaller raskere', erForfalt('2026-05-21', 3, NAA), true)
sjekk('neste gjennomgang er ett år fram', nesteGjennomgang('2026-01-15', 12)?.toISOString().slice(0, 10), '2027-01-15')
sjekk('uten dato finnes ingen frist', nesteGjennomgang(null, 12), null)

// 31. januar pluss én måned finnes ikke. Datoen skal ikke bli ugyldig — den
// ruller til 3. mars, som er det JS gjør, og det er godt nok for en frist.
sjekk('månedsskifte gir en gyldig dato', Number.isNaN(nesteGjennomgang('2026-01-31', 1)?.getTime() ?? NaN), false)

console.log(feil === 0 ? '\nAlle påstander holder.' : `\n${feil} påstander feilet.`)
process.exit(feil === 0 ? 0 : 1)
