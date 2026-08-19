/**
 * Selvtest for EFO/NELFO-parseren. Prosjektet har ingen testrunner, så dette
 * følger samme mønster som worker/tools/ — et kjørbart skript med harde
 * påstander som feiler høyt.
 *
 *   npm run verify:pricefile
 *
 * Ligger i tools/ (utenfor tsconfig) fordi det er et Node-skript — app-kilden har
 * ikke @types/node, og skriptet ville ellers brutt `tsc --noEmit`.
 *
 * Fixturen er håndskrevet mot spec E-NVare4.0r4 fordi vi ennå ikke har en ekte
 * grossistfil. Kommer en ekte fil inn, legg den i lib/pricefile/fixture/ og kjør
 * dette igjen — avvikslisten forteller umiddelbart hva vi har tolket feil.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseEfoNelfo, rundTilPakning, elnummer, dekodAnsi, base64TilBytes } from '../lib/pricefile/efo-nelfo'

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

// Løses fra repo-rota (der npm-skriptet kjøres), ikke fra __dirname — den peker
// inn i .tmp/ etter kompilering, der fixturen ikke ligger.
const tekst = readFileSync(join(process.cwd(), 'lib', 'pricefile', 'fixture', 'V4_eksempel.txt'), 'latin1')
const res = parseEfoNelfo(tekst)

// ── Hodepost ────────────────────────────────────────────────────────────────
sjekk('filtype er varefil', res.hode.filtype, 'vare')
sjekk('selgers orgnr', res.hode.selgerOrgnr, 'NO123456789MVA')
sjekk('kundenummer hos grossist', res.hode.kundeNr, '10042')
sjekk('valuta', res.hode.valuta, 'NOK')
sjekk('selgernavn', res.hode.selgerNavn, 'Grossist Test AS')
sjekk('gyldig fra er 1. aug 2026', res.hode.gyldigFra?.toISOString().slice(0, 10), '2026-08-01')

// ── Implisitte desimaler: den dyre fallgruven ───────────────────────────────
const kabel = res.varer[0]
sjekk('pris 2050 tolkes som 20,50 kr — IKKE 2050', kabel.pris, 20.5)
sjekk('mengde 10000 tolkes som 1,0', kabel.mengde, 1)
sjekk('salgspakning 1000000 tolkes som 100', kabel.salgspakning, 100)
sjekk('måleenhet 2 er meter', kabel.maaleEnhet, 'm')
sjekk('beskrivelse slås sammen', kabel.beskrivelse, 'PFXP 3G2,5 500V Kabel installasjon')
sjekk('lagerført J er true', kabel.lagerfoert, true)
sjekk('bruttopris uten rabatt gir nettopris lik pris', kabel.nettoPris, 20.5)

const stikk = res.varer[1]
sjekk('stikk pris 8900 er 89,00 kr', stikk.pris, 89)
sjekk('stikk salgspakning 100000 er 10', stikk.salgspakning, 10)
sjekk('status 1 er ny vare', stikk.status, 'ny')

const boks = res.varer[2]
sjekk('boks ikke lagerført', boks.lagerfoert, false)
sjekk('boks salgspakning 250000 er 25', boks.salgspakning, 25)

// ── El-nummer som join-nøkkel ───────────────────────────────────────────────
sjekk('elnummer plukkes for VareMrk=1', elnummer(kabel), '1234567')
sjekk('EAN-vare gir ingen elnummer', elnummer(res.varer[3]), null)
sjekk('EAN-merke tolkes', res.varer[3].merke, 'ean')

// ── VX / VA henger på riktig linjepost ──────────────────────────────────────
sjekk('kabel har to tilleggsposter', kabel.tillegg.length, 2)
sjekk('bilde-URL', kabel.tillegg[0], { feltId: 'BILDE', verdi: 'https://eksempel.no/bilder/1234567.jpg' })
sjekk('kabel har ett alternativ', kabel.alternativer.length, 1)
sjekk('alternativ er type A med pakning 500', kabel.alternativer[0], {
  merke: 'elnummer', vareNr: '1234568', type: 'alternativ', salgspakning: 500,
})
sjekk('FDV havnet på stikk, ikke på kabel', stikk.tillegg[0].feltId, 'FDV')

// ── Avvik ───────────────────────────────────────────────────────────────────
sjekk('to linjer havnet i avvik', res.avvik.length, 2)
sjekk('ukjent posttype fanget', res.avvik[0].grunn, 'ukjent posttype «SØPPEL»')
sjekk('linje uten varenummer fanget', res.avvik[1].grunn, 'linjepost uten varenummer')
sjekk('fire varer parset (søppel og tom varenr utelatt)', res.varer.length, 4)

// ── Avrunding til salgspakning: hindrer «100 stk av en 10-pakning» ──────────
sjekk('ber om 45 m kabel i pakning à 100 → 100', rundTilPakning(45, kabel), {
  antall: 100, pakninger: 1, pakningsstoerrelse: 100,
})
sjekk('ber om 12 stikk i pakning à 10 → 20', rundTilPakning(12, stikk), {
  antall: 20, pakninger: 2, pakningsstoerrelse: 10,
})
sjekk('vare uten pakning holdes uendret', rundTilPakning(7, { salgspakning: null }), {
  antall: 7, pakninger: null, pakningsstoerrelse: null,
})

// ── Æøå overlever ANSI-dekoding ─────────────────────────────────────────────
sjekk('norske tegn i avvikstekst', res.avvik[0].grunn.includes('SØPPEL'), true)

// ── base64 → bytes ────────────────────────────────────────────────────────────
// Telefonen leser fila som base64 (expo-file-system), og dekoderen er
// håndskrevet fordi atob ikke er garantert i runtime. Feiler den, blir HELE
// prisfila søppel — så den testes mot de ekte fixture-bytene.
{
  const raa = readFileSync(join(process.cwd(), 'lib', 'pricefile', 'fixture', 'V4_eksempel.txt'))
  const rundtur = base64TilBytes(raa.toString('base64'))
  sjekk('base64: samme lengde', rundtur.length, raa.length)
  sjekk('base64: identiske bytes', Buffer.from(rundtur).equals(raa), true)
  // Den avgjørende påstanden: base64 → bytes → dekodAnsi skal gi NØYAKTIG samme
  // streng som å lese fila direkte som latin1. Det er hele veien telefonen tar.
  sjekk('base64 → dekodAnsi === direkte latin1-lesing', dekodAnsi(rundtur), tekst)
  // Padding er den klassiske feilen: '=' må ignoreres, ikke tolkes som data.
  sjekk('base64: padding gir ikke ekstra byte', base64TilBytes('QQ==').length, 1)
  sjekk('base64: to padding-tegn', Array.from(base64TilBytes('QUI=')), [65, 66])
  sjekk('base64: uten padding', Array.from(base64TilBytes('QUJD')), [65, 66, 67])
}

console.log(feil === 0 ? '\nAlle sjekker passerte.' : `\n${feil} sjekk(er) feilet.`)
process.exit(feil === 0 ? 0 : 1)
