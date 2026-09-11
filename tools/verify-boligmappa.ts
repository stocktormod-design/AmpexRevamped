/**
 * Selvtest av Boligmappa-klienten MOT SANDKASSEN.
 *
 * Som `verify:tripletex`: ingen stubber, ekte HTTP. Den svarer på det de rene
 * enhetstestene ikke kan — at innlogging, lesing og oppretting faktisk virker
 * mot den tjenesten som står der ute i dag.
 *
 * Krever i .env.local: BOLIGMAPPA_TOKEN_URL, BOLIGMAPPA_JOBS_BASE,
 * BOLIGMAPPA_CLIENT_ID, BOLIGMAPPA_CLIENT_SECRET, BOLIGMAPPA_TEST_BRUKER,
 * BOLIGMAPPA_TEST_PASSORD.
 *
 * Oppretting er AV som standard — sandkassen er delt, og en testjobb blir
 * liggende. Kjør med `--opprett` for å ta det steget.
 */
import { BoligmappaKlient } from '../lib/boligmappa/klient'

function kreves(n: string): string {
  const v = process.env[n]
  if (!v) { console.error(`Mangler ${n} i miljøet`); process.exit(1) }
  return v
}
let feilet = 0
function sjekk(ok: boolean, tekst: string) {
  console.log(`${ok ? '✓' : '✗'} ${tekst}`)
  if (!ok) feilet++
}

async function main() {
  const k = new BoligmappaKlient({
    tokenUrl: kreves('BOLIGMAPPA_TOKEN_URL'),
    jobsBase: kreves('BOLIGMAPPA_JOBS_BASE'),
    klientId: kreves('BOLIGMAPPA_CLIENT_ID'),
    klientHemmelighet: kreves('BOLIGMAPPA_CLIENT_SECRET'),
  })

  const inn = await k.loggInn(kreves('BOLIGMAPPA_TEST_BRUKER'), kreves('BOLIGMAPPA_TEST_PASSORD'))
  sjekk(inn.ok, `innlogging${inn.ok ? '' : ' — ' + inn.feil}`)
  if (!inn.ok) process.exit(1)

  const liste = await k.jobber(1, 5)
  sjekk(liste.ok, `hentet jobbliste${liste.ok ? '' : ' — ' + liste.feil}`)
  if (!liste.ok) process.exit(1)
  sjekk(typeof liste.verdi.totalRecords === 'number', `${liste.verdi.totalRecords} jobber i kontoen`)
  sjekk(liste.verdi.jobs.length > 0, `første side har ${liste.verdi.jobs.length} rader`)

  const forste = liste.verdi.jobs[0]
  sjekk(!!forste?.boligmappaNumber, `jobb ${forste?.jobNumber} ligger på eiendom ${forste?.boligmappaNumber}`)

  const en = await k.jobb(forste.jobNumber)
  sjekk(en.ok, `hentet enkeltjobb${en.ok ? '' : ' — ' + en.feil}`)
  if (en.ok) sjekk(en.verdi.jobNumber === forste.jobNumber, 'samme jobbnummer tilbake')

  // Feilveien skal være lesbar, ikke en rå gateway-melding.
  const tull = await k.jobb(1)
  sjekk(!tull.ok, `ukjent jobbnummer avvises (${tull.ok ? '?' : tull.status})`)

  if (process.argv.includes('--opprett')) {
    const ny = await k.opprettJobb({
      boligmappaNumber: forste.boligmappaNumber,
      organizationNumber: Number(forste.organizationNumber ?? 0),
      title: 'Ampex selvtest',
      initialDescription: 'Opprettet av npm run verify:boligmappa',
      jobDate: new Date().toISOString(),
      // «Ugyldig jobbstatus» hvis den utelates. Lovlige verdier står i
      // StatusEnum: Pending, InProgress, RequiredInfo, Cancelled, Done.
      // BARE 'InProgress' godtas ved oppretting — 'Done' og 'Pending' avvises
      // med INVALID_JOB_STATUS. Ferdigstilling skjer etterpå med
      // PUT /v1/jobs/{jobNumber}/status.
      status: 'InProgress',
      origin: 'PROFF',
    })
    if (ny.ok) {
      sjekk(true, `opprettet jobb ${ny.verdi.jobNumber}`)
    } else if (ny.kode === 'PROPERTY_NOT_FOUND') {
      // KJENT ÅPEN, ikke en regresjon. Se docs/BOLIGMAPPA.md: eiendommen finnes
      // i kontoens egne jobber, men jobbtjenesten finner den ikke ved oppretting.
      // Spurt Boligmappa 2026-09-11; ikke noe vi kan rette selv.
      console.log(`  (kjent åpen: ${ny.feil} — venter på svar fra Boligmappa)`)
    } else {
      sjekk(false, `opprettet jobb — ${ny.feil}`)
    }
  } else {
    console.log('  (hopper over oppretting — kjør med --opprett)')
  }

  console.log(feilet === 0 ? '\nAlt grønt.' : `\n${feilet} feilet.`)
  process.exit(feilet === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
