/**
 * Ende-til-ende-test mot Tripletex SANDKASSE (api-test.tripletex.tech).
 *
 *   TRIPLETEX_CONSUMER_TOKEN=… TRIPLETEX_EMPLOYEE_TOKEN=… npm run verify:tripletex
 *   … --fakturer      utsteder også fakturaen fra ordren (bare i sandkassa!)
 *
 * Hele kjeden appen skal bruke: økt → hvem er jeg → kunde (idempotent) → prosjekt
 * (idempotent) → varer (idempotent) → timer på prosjektet → ordre med produkt- og
 * timelinjer fra byggFakturagrunnlag → status «utkast» → (valgfritt) faktura → «sendt».
 * Harde påstander, ingen testrunner. Nekter å kjøre mot produksjon.
 */
import { byggFakturagrunnlag, type MateriellInn, type TimeInn } from '../lib/invoicing'
import { TripletexAdapter, TRIPLETEX_TEST, kroner } from '../lib/accounting/tripletex'

const consumer = process.env.TRIPLETEX_CONSUMER_TOKEN
const employee = process.env.TRIPLETEX_EMPLOYEE_TOKEN
const base = process.env.TRIPLETEX_BASE ?? TRIPLETEX_TEST
const fakturer = process.argv.includes('--fakturer')

if (!consumer || !employee) {
  console.error('Mangler TRIPLETEX_CONSUMER_TOKEN / TRIPLETEX_EMPLOYEE_TOKEN')
  process.exit(2)
}
if (!/api-test\.tripletex\.tech/.test(base)) {
  console.error(`Nekter: ${base} er ikke sandkassa. Dette skriptet lager kunder, prosjekter, varer, timer og ordre.`)
  process.exit(2)
}

let feil = 0
function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
  } else console.log(`✓ ${navn}`)
}
function krev<T>(navn: string, r: { ok: true; verdi: T } | { ok: false; feil: string }): T {
  if (!r.ok) { console.error(`✗ ${navn}: ${r.feil}`); process.exit(1) }
  console.log(`✓ ${navn}`)
  return r.verdi
}

async function main() {
  const tlx = new TripletexAdapter({ consumerToken: consumer!, employeeToken: employee!, baseUrl: base })
  const kjoring = Date.now().toString(36)   // unikt per kjøring så prosjekt/vare kan finnes igjen

  // 1. Økt + hvem er jeg
  krev('session-token opprettet', await tlx.opprettOkt())
  const meg = krev('hvem er jeg', await tlx.hvemErJeg())
  console.log(`  ansatt ${meg.ansattId}, selskap ${meg.selskapId}`)

  // 2. Kunde — idempotent
  const kunde = {
    navn: 'Ampex Testkunde AS', erBedrift: true, orgNr: '999888777',
    epost: 'faktura@ampex-test.no', telefon: '99999999',
    adresse: 'Testveien 1', postnummer: '0250', poststed: 'Oslo', lokalId: 'lokal-kunde-1',
  }
  const kundeId = krev('kunde synket', await tlx.synkKunde(kunde))
  sjekk('samme kunde-ID andre gang', krev('kunde synket igjen', await tlx.synkKunde(kunde)), kundeId)

  // 3. Prosjekt — idempotent på nummer
  const prosjekt = {
    navn: `Kjøkken – nye kurser (${kjoring})`, nummer: `AMPEX-${kjoring}`, kundeEksternId: kundeId,
    startDato: new Date(), beskrivelse: 'Ampex E2E-test',
    adresse: { gate: 'Testveien 1', postnummer: '0250', poststed: 'Oslo' },
  }
  const prosjektId = krev('prosjekt opprettet', await tlx.synkProsjekt(prosjekt))
  sjekk('samme prosjekt-ID andre gang', krev('prosjekt synket igjen', await tlx.synkProsjekt(prosjekt)), prosjektId)

  // 4. Varer — idempotent på nummer (el-nummer)
  const varer = [
    { nummer: '1234567', navn: 'PFSP 3G2,5', enhet: 'm', salgsprisOre: 2490, kostprisOre: 1450, mva: 'hoy' as const },
    { nummer: `AMPEX-STIKK-${kjoring}`, navn: 'Stikk infelt', enhet: 'stk', salgsprisOre: 18900, kostprisOre: 9600, mva: 'hoy' as const },
  ]
  const produktId = new Map<string, string>()
  for (const v of varer) produktId.set(v.nummer, krev(`vare synket: ${v.navn}`, await tlx.synkVare(v)))
  sjekk('samme produkt-ID andre gang', krev('vare synket igjen', await tlx.synkVare(varer[0])), produktId.get('1234567'))

  // 5. Timer på prosjektet
  const iDag = new Date()
  const t1 = krev('timeføring 1 (Montasje 4 t)', await tlx.foerTimer({
    ansattEksternId: meg.ansattId, aktivitetNavn: 'Montasje', prosjektEksternId: prosjektId,
    dato: iDag, timer: 4, kommentar: 'Trakk kurs til kjøkken',
  }))
  const t2 = krev('timeføring 2 (Kjøring 1 t)', await tlx.foerTimer({
    ansattEksternId: meg.ansattId, aktivitetNavn: 'Kjøring', prosjektEksternId: prosjektId, dato: iDag, timer: 1,
  }))
  const timerIgjen = krev('timer lest tilbake', await tlx.hentTimer(prosjektId, iDag, iDag))
  sjekk('to timeføringer på prosjektet', timerIgjen.filter(x => x.id === t1 || x.id === t2).length, 2)
  sjekk('sum timer = 5', timerIgjen.filter(x => x.id === t1 || x.id === t2).reduce((a, x) => a + x.timer, 0), 5)

  // 6. Grunnlag (identisk med verify-invoicing, kjente tall) → ordre med produktlinjer
  const materiell: MateriellInn[] = [
    { id: 'm1', beskrivelse: 'PFSP 3G2,5', antall: 50, enhet: 'm', elnummer: '1234567', enhetsprisKr: 24.9, kostprisKr: 14.5 },
    { id: 'm2', beskrivelse: 'Stikk infelt', antall: 3, enhet: 'stk', elnummer: `AMPEX-STIKK-${kjoring}`, enhetsprisKr: 189, kostprisKr: 96, rabattProsent: 10 },
  ]
  const timer: TimeInn[] = [
    { id: 't1', aktivitetId: 'a1', aktivitetNavn: 'Montasje', aktivitetTimepris: 850, aktivitetFakturerbar: true, personId: 'p1', personNavn: 'Tormod', dato: 0, timer: 4, notat: 'Trakk kurs til kjøkken' },
    { id: 't3', aktivitetId: 'a2', aktivitetNavn: 'Kjøring', aktivitetTimepris: 650, aktivitetFakturerbar: true, personId: 'p1', personNavn: 'Tormod', dato: 0, timer: 1 },
  ]
  const g = byggFakturagrunnlag(materiell, timer)
  console.log(`  grunnlag: ${g.linjer.length} linjer, netto ${kroner(g.nettoOre)} kr, mva ${kroner(g.mvaOre)} kr`)
  const ordreId = krev('ordre opprettet (produkt- og timelinjer, knyttet til prosjekt)', await tlx.opprettFakturautkast({
    lokalOrdreId: 'lokal-ordre-1', ordrenummer: 1001, tittel: 'Kjøkken – nye kurser',
    kundeEksternId: kundeId, dato: iDag, forfallsdager: 14, grunnlag: g,
    ordreTekst: 'Utført i Testveien 1, 0250 Oslo',
  }, { prosjektEksternId: prosjektId, produktIdForElnummer: produktId }))
  console.log(`  ordre ${ordreId}: ${base.replace('/v2', '')}/execute/orderMenu?orderId=${ordreId}`)
  sjekk('status før faktura = utkast', krev('status hentet', await tlx.hentFakturastatus(ordreId)), 'utkast')

  // 7. Faktura
  if (fakturer) {
    const fakturaId = krev('faktura utstedt fra ordren', await tlx.fakturerOrdre(ordreId))
    console.log(`  faktura-ID ${fakturaId}`)
    sjekk('status etter faktura = sendt', krev('status etter faktura', await tlx.hentFakturastatus(ordreId)), 'sendt')
    // 8. Betaling → «betalt»
    const typer = krev('betalingstyper hentet', await tlx.betalingstyper())
    const faktura = krev('faktura for ordren funnet', await tlx.hentFakturaForOrdre(ordreId))
    sjekk('faktura-ID matcher', faktura?.fakturaId, fakturaId)
    if (typer.length > 0 && faktura) {
      krev(`betaling registrert (${typer[0].navn || typer[0].id})`, await tlx.registrerBetaling(faktura.fakturaId, faktura.utestaendeOre, typer[0].id))
      sjekk('status etter betaling = betalt', krev('status etter betaling', await tlx.hentFakturastatus(ordreId)), 'betalt')
    } else {
      console.log('  (ingen betalingstyper i sandkassa — hopper over betaling)')
    }
  } else {
    console.log('  (hopper over fakturering — kjør med --fakturer for å utstede i sandkassa)')
  }

  if (feil > 0) { console.error(`\n${feil} feil`); process.exit(1) }
  console.log('\nAlt grønt.')
}

main().catch(e => { console.error(e); process.exit(1) })
