/**
 * Ende-til-ende-test mot et Fiken TESTFORETAK.
 *
 *   FIKEN_TOKEN=… FIKEN_COMPANY_SLUG=… npm run verify:fiken
 *   … --fakturer      lager også faktura av utkastet (bare i testforetaket!)
 *
 * Fiken har ingen egen sandkasse. Testen er et foretak «som ikke er i
 * Brønnøysundregistrene» (Fiken kaller det demo/testforetak), og API-et er
 * gratis der. Skriptet leser `testCompany` fra `/companies/{slug}` og NEKTER
 * å kjøre hvis flagget ikke er sant: det oppretter kontakter, varer,
 * prosjekter, timer og fakturautkast.
 *
 * Kjeden er den samme som Tripletex-testen: hvem er jeg → foretak → kunde
 * (idempotent) → vare (idempotent) → prosjekt (idempotent) → aktivitet og
 * timebruker → timer → fakturautkast fra byggFakturagrunnlag → status →
 * (valgfritt) faktura → status «sendt/ubetalt». Harde påstander, ingen
 * testrunner.
 *
 * Tokens leses fra miljøet eller .env.local (git-ignorert).
 */
import { existsSync, readFileSync } from 'node:fs'
import { byggFakturagrunnlag, type MateriellInn, type TimeInn } from '../lib/invoicing'
import { FikenAdapter } from '../lib/accounting/fiken'

function lesEnv(navn: string): string | undefined {
  if (process.env[navn]) return process.env[navn]
  if (!existsSync('.env.local')) return undefined
  const m = new RegExp(`^${navn}=(.*)$`, 'm').exec(readFileSync('.env.local', 'utf8'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined
}

const token = lesEnv('FIKEN_TOKEN')
const slug = lesEnv('FIKEN_COMPANY_SLUG')
const fakturer = process.argv.includes('--fakturer')

if (!token || !slug) {
  console.error('Mangler FIKEN_TOKEN og/eller FIKEN_COMPANY_SLUG (i miljøet eller .env.local).')
  console.error('Lag et testforetak i Fiken («Registrer et foretak som ikke er i Brønnøysundregistrene»),')
  console.error('og en personlig API-nøkkel under Rediger konto → API. Slug står i adresselinja: fiken.no/foretak/<slug>/…')
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
  const fiken = new FikenAdapter({ companySlug: slug!, token: token! })
  const kjoring = Date.now().toString(36)

  // 0. Hvem er jeg, og er dette et testforetak?
  const meg = krev('hvem er jeg', await fiken.hvemErJeg())
  console.log(`  ${meg.navn} <${meg.epost}>`)
  const foretak = krev('foretak lest', await fiken.hentForetak())
  console.log(`  ${foretak.navn} (${foretak.slug}) · test=${foretak.testForetak} · api=${foretak.harApiTilgang}`)
  if (!foretak.testForetak) {
    console.error(`Nekter: «${foretak.navn}» er ikke et testforetak. Dette skriptet lager kunder, varer, prosjekter, timer og fakturautkast.`)
    process.exit(2)
  }

  // 1. Kunde — idempotent på org.nr, og på vår lokale ID (memberNumberString)
  const kunde = {
    navn: 'Ampex Testkunde AS', erBedrift: true, orgNr: '999888777',
    epost: 'faktura@ampex-test.no', telefon: '99999999',
    adresse: 'Testveien 1', postnummer: '0250', poststed: 'Oslo', lokalId: 'lokal-kunde-1',
  }
  const kundeId = krev('kunde synket', await fiken.synkKunde(kunde))
  sjekk('samme kunde-ID andre gang', krev('kunde synket igjen', await fiken.synkKunde(kunde)), kundeId)

  // 2. Vare — idempotent på varenummer (el-nummer)
  const vare = { nummer: '1234567', navn: 'PFXP 3G2,5 500V', enhet: 'm', salgsprisOre: 2490, kostprisOre: 1420, mva: 'hoy' as const }
  const vareId = krev('vare synket', await fiken.synkVare(vare))
  sjekk('samme vare-ID andre gang', krev('vare synket igjen', await fiken.synkVare(vare)), vareId)

  // 3. Prosjekt — idempotent på nummer
  const prosjekt = {
    navn: `Ampex test ${kjoring}`, nummer: `AMPEX-${kjoring}`, kundeEksternId: kundeId,
    startDato: new Date(), beskrivelse: 'Opprettet av verify:fiken',
  }
  const prosjektId = krev('prosjekt synket', await fiken.synkProsjekt(prosjekt))
  sjekk('samme prosjekt-ID andre gang', krev('prosjekt synket igjen', await fiken.synkProsjekt(prosjekt)), prosjektId)

  // 4. Aktivitet og timebruker — begge idempotente på navn
  const aktivitetId = krev('aktivitet synket', await fiken.synkAktivitet('Montasje', 89000))
  sjekk('samme aktivitet andre gang', krev('aktivitet igjen', await fiken.synkAktivitet('Montasje', 89000)), aktivitetId)
  const timebrukerId = krev('timebruker synket', await fiken.synkTimebruker(meg.navn, meg.epost))

  // 5. Timer på prosjektet
  const timeId = krev('timer ført', await fiken.foerTimer({
    ansattEksternId: timebrukerId, aktivitetNavn: 'Montasje', prosjektEksternId: prosjektId,
    dato: new Date(), timer: 2.5, kommentar: 'Trekking og kobling',
  }))
  console.log(`  timeføring ${timeId}`)

  // 6. Fakturautkast fra det samme grunnlaget appen bygger (samme tall som verify-invoicing)
  const materiell: MateriellInn[] = [
    { id: 'm1', beskrivelse: 'PFXP 3G2,5 500V', antall: 40, enhet: 'm', elnummer: '1234567', enhetsprisKr: 24.9, kostprisKr: 14.2 },
  ]
  const timer: TimeInn[] = [
    { id: 't1', aktivitetId: 'a1', aktivitetNavn: 'Montasje', aktivitetTimepris: 890, aktivitetFakturerbar: true, personId: 'p1', personNavn: meg.navn || 'Tormod', dato: 0, timer: 2.5, notat: 'Trekking og kobling' },
  ]
  const grunnlag = byggFakturagrunnlag(materiell, timer)
  sjekk('grunnlag har to linjer', grunnlag.linjer.length, 2)
  console.log(`  grunnlag: netto ${(grunnlag.nettoOre / 100).toFixed(2)} kr, mva ${(grunnlag.mvaOre / 100).toFixed(2)} kr`)

  const utkastId = krev('fakturautkast opprettet', await fiken.opprettFakturautkast({
    lokalOrdreId: 'lokal-ordre-1', ordrenummer: 42, tittel: 'Ny kurs til garasje',
    kundeEksternId: kundeId, dato: new Date(), forfallsdager: 14, grunnlag,
    ordreTekst: 'Utført i Testveien 1', prosjektEksternId: prosjektId,
    vareIder: { '1234567': vareId },
  }))
  const utkast = krev('utkast lest tilbake', await fiken.hentUtkast(utkastId))
  sjekk('utkastets netto = grunnlagets netto (øre)', utkast.nettoOre, grunnlag.nettoOre)
  sjekk('utkastets brutto = grunnlagets brutto (øre)', utkast.bruttoOre, grunnlag.bruttoOre)
  sjekk('status før fakturering', krev('status', await fiken.hentFakturastatus(`utkast:${utkastId}`)), 'utkast')

  // 7. Valgfritt: lag faktura av utkastet
  if (fakturer) {
    const fakturaId = krev('faktura opprettet fra utkast', await fiken.fakturerUtkast(utkastId))
    const status = krev('status etter fakturering', await fiken.hentFakturastatus(fakturaId))
    sjekk('fakturaen er utstedt og ubetalt', ['sendt', 'utkast'].includes(status), true)
    console.log(`  faktura ${fakturaId} · ${status}`)
  } else {
    console.log('  (hopper over fakturering — kjør med --fakturer for å lage faktura i testforetaket)')
  }

  if (feil) { console.error(`\n${feil} påstand(er) feilet.`); process.exit(1) }
  console.log('\nAlt grønt.')
}

main().catch(e => { console.error(e); process.exit(1) })
