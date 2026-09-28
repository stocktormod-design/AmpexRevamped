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

/**
 * Hele filveien: plant → metadata → bytes → kobling til jobben.
 *
 * Rekkefølgen er ikke valgfri. `POST /jobs/{nr}/files` tar fil-ID-er, og det
 * eneste stedet en fil får ID er `POST /plants/{bmNr}/files` — som igjen
 * krever at eiendommen har et plant.
 */
async function filveien(k: BoligmappaKlient, bmNr: string, jobbNummer: number) {
  const plant = await k.sikrePlant(bmNr)
  sjekk(plant.ok, plant.ok ? `plant på ${bmNr}${plant.verdi ? ` (${plant.verdi.plantId})` : ' (fantes fra før)'}` : `plant — ${plant.feil}`)
  if (!plant.ok) return

  const meta = await k.filMetadata(bmNr, {
    fileName: 'ampex-selvtest.pdf',
    title: 'Ampex selvtest',
    description: 'Opprettet av npm run verify:boligmappa -- --fil',
    isVisibleInBoligmappa: true,
    chapterTags: [{ id: 4 }], // Samsvarserklæringer og garantibevis
    professionType: { id: 1 }, // Elektriker
    documentType: { id: 0 }, // Udefinert — PÅKREVD, uten den kommer INVALID_REQUEST
  })
  sjekk(meta.ok, meta.ok ? `filmetadata registrert, id ${meta.verdi.id}` : `filmetadata — ${meta.feil}`)
  if (!meta.ok) return
  sjekk(!!meta.verdi.uploadLink, 'fikk uploadLink tilbake')
  if (!meta.verdi.uploadLink) return

  const opp = await k.lastOppInnhold(meta.verdi.uploadLink, Buffer.from('%PDF-1.4\n% Ampex selvtest\n'))
  sjekk(opp.ok, opp.ok ? 'innholdet lastet opp på lenken' : `opplasting — ${opp.feil}`)

  const koblet = await k.koblFiler(jobbNummer, [meta.verdi.id])
  sjekk(koblet.ok, koblet.ok ? `fil ${meta.verdi.id} koblet til jobb ${jobbNummer}` : `kobling — ${koblet.feil}`)

  // Lista henger etter opplastingen med et par sekunder — rett etter PUT er fila
  // ikke med, noen sekunder senere er den det (målt 2026-09-15). Derfor et par
  // forsøk før vi kaller det feil.
  let funnet = false
  for (let forsok = 0; forsok < 4 && !funnet; forsok++) {
    if (forsok) await new Promise(r => setTimeout(r, 2000))
    const filer = await k.plantFiler(bmNr)
    funnet = filer.ok && filer.verdi.some(f => f.id === meta.verdi.id)
  }
  sjekk(funnet, 'fila ligger på eiendommen etterpå')
}

async function main() {
  const k = new BoligmappaKlient({
    tokenUrl: kreves('BOLIGMAPPA_TOKEN_URL'),
    jobsBase: kreves('BOLIGMAPPA_JOBS_BASE'),
    proffBase: kreves('BOLIGMAPPA_API_BASE'),
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

  // ── Eiendom i STAGING, ikke i produksjon ────────────────────────────────
  // Nummeret som står på kontoens egne jobber (OON4288) er produksjonsdata og
  // finnes ikke i staging-basen. Gyldige numre må slås opp her, gjennom gate →
  // adresse → eiendom. Det var dette som lå bak PROPERTY_NOT_FOUND.
  const gater = await k.gater('Oslo gate')
  sjekk(gater.ok, `søkte opp gate${gater.ok ? ` — ${gater.verdi.length} treff` : ' — ' + gater.feil}`)
  if (!gater.ok) process.exit(1)
  const gate = gater.verdi[0]

  const adr = await k.adresser(gate.id)
  sjekk(adr.ok && adr.verdi.length > 0, `adresser i ${gate.streetName}${adr.ok ? ` — ${adr.verdi.length}` : ' — ' + adr.feil}`)
  if (!adr.ok || adr.verdi.length === 0) process.exit(1)

  const eiendommer = await k.eiendommer(adr.verdi[0].id)
  sjekk(eiendommer.ok && eiendommer.verdi.length > 0, `eiendommer på adressen${eiendommer.ok ? ` — ${eiendommer.verdi.length}` : ' — ' + eiendommer.feil}`)
  if (!eiendommer.ok || eiendommer.verdi.length === 0) process.exit(1)
  console.log(`  (søket gir ${eiendommer.verdi.map(e => e.boligmappaNumber).join(', ')} på ${adr.verdi[0].id})`)

  // MERK: numrene søket returnerer for denne adressen (FPH46xx) kan ikke brukes
  // til noe — `POST /plants` svarer 500 på alle fire, og jobboppretting svarer
  // PROPERTY_NOT_FOUND. Søkeindeksen og eiendoms-/jobbasen er ikke enige i
  // staging. Meldt 2026-09-15; Shaibal bekreftet «issues with the data in
  // staging» og oppga 20 numre som VIRKER (IPI-90, se docs/BOLIGMAPPA.md).
  //
  // Vi bruker det første av dem. Overstyres med BOLIGMAPPA_TEST_EIENDOM.
  //
  // Å bare LESE et nummer skiller ikke gyldig fra ugyldig: `GET
  // /plants/{nr}/files` svarer PLANT_NOT_FOUND for begge deler. Det er
  // `POST /plants` som avslører forskjellen, og det er den denne testen gjør.
  const bmNr = process.env.BOLIGMAPPA_TEST_EIENDOM ?? 'ACQ3920'
  sjekk(!!bmNr, `bruker eiendom ${bmNr} til skrivetestene`)

  if (process.argv.includes('--opprett')) {
    const ny = await k.opprettJobb({
      boligmappaNumber: bmNr,
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
    sjekk(ny.ok, ny.ok ? `opprettet jobb ${ny.verdi.jobNumber}` : `opprettet jobb — ${ny.feil}`)

    if (ny.ok && process.argv.includes('--fil')) await filveien(k, bmNr, ny.verdi.jobNumber)
  } else {
    console.log('  (hopper over oppretting — kjør med --opprett, og --fil for hele filveien)')
  }

  console.log(feilet === 0 ? '\nAlt grønt.' : `\n${feilet} feilet.`)
  process.exit(feilet === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
