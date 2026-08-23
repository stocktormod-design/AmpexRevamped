/**
 * Selvtest for kontorets rollematrise.
 *
 *   npm run verify:kontor-tilgang
 *
 * Matrisen er ikke sikkerhetsmodellen — RLS og databasesperrene er det. Men en
 * feil her viser dekningsbidraget til feil person, og det er en samtale ingen
 * daglig leder vil ha på grunn av en skjerm.
 */
import { kan, rettigheter, rollenavn, somRolle, type Rolle } from '../lib/kontor-tilgang'

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

const ROLLER: Rolle[] = ['owner', 'admin', 'bas', 'installator', 'montor', 'laerling', 'regnskapsforer']

// ── Feltet slipper ikke inn ────────────────────────────────────────────────

sjekk('montør kommer ikke inn på kontoret', kan('montor', 'kontor'), false)
sjekk('lærling kommer ikke inn på kontoret', kan('laerling', 'kontor'), false)
sjekk('montør har ingen rettigheter i det hele tatt', rettigheter('montor'), [])

// ── Ukjent rolle er «nei», ikke «kanskje» ──────────────────────────────────

sjekk('ukjent rolle gir ingen tilgang', kan('sjefen', 'kontor'), false)
sjekk('null gir ingen tilgang', kan(null, 'kontor'), false)
sjekk('tom streng gir ingen tilgang', kan('', 'ordre.les'), false)
sjekk('somRolle avviser det den ikke kjenner', somRolle('vaktmester'), null)
sjekk('somRolle godtar en ekte rolle', somRolle('installator'), 'installator')

// ── Pengene ────────────────────────────────────────────────────────────────

// Dekningsbidraget sier hva firmaet tjener på jobben. Det er eierens og
// regnskapets tall, ikke noe som skal ligge åpent på en delt kontorskjerm.
sjekk('bas ser ikke dekningsbidrag', kan('bas', 'db.les'), false)
sjekk('installatør ser ikke dekningsbidrag', kan('installator', 'db.les'), false)
sjekk('regnskapsfører ser dekningsbidrag', kan('regnskapsforer', 'db.les'), true)
sjekk('eier ser dekningsbidrag', kan('owner', 'db.les'), true)

sjekk('bare eier, admin og regnskap kan markere fakturert', ROLLER.filter(r => kan(r, 'faktura.marker')), ['owner', 'admin', 'regnskapsforer'])
sjekk('installatøren fakturerer ikke', kan('installator', 'faktura.marker'), false)
sjekk('men han ser summen han godkjenner', kan('installator', 'faktura.les'), true)
sjekk('basen ser ingen priser ut mot kunde', kan('bas', 'faktura.les'), false)

// ── Varekartoteket ─────────────────────────────────────────────────────────

sjekk('bare eier og admin importerer prisfil', ROLLER.filter(r => kan(r, 'priser.importer')), ['owner', 'admin'])
sjekk('regnskapsfører leser varer, men skriver ikke', [kan('regnskapsforer', 'varer.les'), kan('regnskapsforer', 'priser.importer')], [true, false])

// ── Ordrelista ─────────────────────────────────────────────────────────────

sjekk('basen ser bare ordrene sine', [kan('bas', 'ordre.les'), kan('bas', 'ordre.alle')], [true, false])
sjekk('installatøren ser hele firmaet', kan('installator', 'ordre.alle'), true)
sjekk('regnskapsfører retter ikke montørens føringer', kan('regnskapsforer', 'ordre.endre'), false)

// Å OPPRETTE en ordre er å bestemme at nytt arbeid skal inn i porteføljen — en
// annen avgjørelse enn å rette en times feilskriving, og en regnskapsfører som
// retter tall skal ikke dermed kunne legge nye jobber inn i systemet.
sjekk('installatøren oppretter ordrer', kan('installator', 'ordre.skriv'), true)
sjekk('regnskapsføreren gjør ikke', kan('regnskapsforer', 'ordre.skriv'), false)
sjekk('basen retter, men oppretter ikke', [kan('bas', 'ordre.endre'), kan('bas', 'ordre.skriv')], [true, false])
sjekk('bare eier, admin og installatør oppretter ordrer', ROLLER.filter(r => kan(r, 'ordre.skriv')), ['owner', 'admin', 'installator'])
sjekk('ingen oppretter ordrer uten å se dem', ROLLER.every(r => !kan(r, 'ordre.skriv') || kan(r, 'ordre.les')), true)

// ── Timelista er lønnsgrunnlag ─────────────────────────────────────────────

// Timene basen trenger står på ordrene hans. En samlet oversikt over hva
// kollegaene har ført er noe annet enn å lede en jobb.
sjekk('basen ser ikke hele firmaets timeliste', kan('bas', 'timer.les'), false)
sjekk('men ordrene sine ser han', kan('bas', 'ordre.les'), true)
sjekk('regnskap, installatør, eier og admin ser timelista', ROLLER.filter(r => kan(r, 'timer.les')), ['owner', 'admin', 'installator', 'regnskapsforer'])

// Å FØRE timer for andre er noe annet enn å se dem. Det er lønnsgrunnlag
// skrevet på vegne av en annen, og regnskapsføreren har det ikke: hun ser
// timelista fakturaen bygger på, men å endre den er å endre hva en montør får
// betalt.
sjekk('regnskapsfører ser timene, men fører dem ikke', [kan('regnskapsforer', 'timer.les'), kan('regnskapsforer', 'timer.skriv')], [true, false])
sjekk('installatøren retter det som ble ført feil', kan('installator', 'timer.skriv'), true)
sjekk('bare eier, admin og installatør fører timer', ROLLER.filter(r => kan(r, 'timer.skriv')), ['owner', 'admin', 'installator'])
sjekk('ingen fører timer uten å se dem', ROLLER.every(r => !kan(r, 'timer.skriv') || kan(r, 'timer.les')), true)

// ── Tilbud og kunder ───────────────────────────────────────────────────────

sjekk('basen ser ikke tilbud — det er priser ut mot kunde', kan('bas', 'tilbud.les'), false)
sjekk('men kunderegisteret trenger han', kan('bas', 'kunder.les'), true)
sjekk('alle med kontortilgang ser kundene', ROLLER.filter(r => kan(r, 'kontor')).every(r => kan(r, 'kunder.les')), true)

// Kunderegisteret er det fakturaen adresseres til, så regnskapsføreren skriver
// i det. Basen gjør ikke: han trenger telefonnummeret på vei til jobben.
sjekk('regnskapsføreren fører kunderegisteret', kan('regnskapsforer', 'kunder.skriv'), true)
sjekk('basen leser kundene, men oppretter dem ikke', [kan('bas', 'kunder.les'), kan('bas', 'kunder.skriv')], [true, false])
sjekk('ingen oppretter kunder uten å se dem', ROLLER.every(r => !kan(r, 'kunder.skriv') || kan(r, 'kunder.les')), true)

// ── Prosjekter ─────────────────────────────────────────────────────────────

// Prosjektene ble til i appen, sammen med tegningen. Et rammeavtaleprosjekt
// starter derimot på kontoret, uker før noen tar med en telefon dit.
sjekk('installatøren oppretter prosjekter', kan('installator', 'prosjekt.skriv'), true)
sjekk('regnskapsføreren gjør ikke — faget er ikke hennes', kan('regnskapsforer', 'prosjekt.skriv'), false)
sjekk('bare eier, admin og installatør oppretter dem', ROLLER.filter(r => kan(r, 'prosjekt.skriv')), ['owner', 'admin', 'installator'])
sjekk('ingen oppretter prosjekter uten å se dem', ROLLER.every(r => !kan(r, 'prosjekt.skriv') || kan(r, 'prosjekt.les')), true)

// ── Internkontrollen ───────────────────────────────────────────────────────

// Faglig ansvarlig eier IK-systemet. Det er hans navn på samsvarserklæringen.
sjekk('installatøren kan skrive internkontrollen', kan('installator', 'ik.skriv'), true)
sjekk('bare eier, admin og installatør kan det', ROLLER.filter(r => kan(r, 'ik.skriv')), ['owner', 'admin', 'installator'])
sjekk('regnskapsfører leser, men skriver ikke', [kan('regnskapsforer', 'ik.les'), kan('regnskapsforer', 'ik.skriv')], [true, false])

// En rutine ingen får lese er en rutine ingen kan følge.
sjekk('basen leser internkontrollen', kan('bas', 'ik.les'), true)
sjekk('alle med kontortilgang leser den', ROLLER.filter(r => kan(r, 'kontor')).every(r => kan(r, 'ik.les')), true)
sjekk('og alle leser skjemamalene', ROLLER.filter(r => kan(r, 'kontor')).every(r => kan(r, 'skjema.les')), true)

// Historikken har to lag. Revisjonene med endringsnotat er en del av
// dokumentet og leses av alle som leser rutinen — også basen. Auditsporet
// (hvem endret hvilket felt) er tilsyn, og det er `logg.les` som styrer.
sjekk('basen leser rutinen, men ikke auditsporet', [kan('bas', 'ik.les'), kan('bas', 'logg.les')], [true, false])
sjekk('auditsporet er for eier, admin, installatør og regnskap', ROLLER.filter(r => kan(r, 'logg.les')), ['owner', 'admin', 'installator', 'regnskapsforer'])
sjekk('den som skriver internkontrollen ser også sporet sitt', ROLLER.filter(r => kan(r, 'ik.skriv')).every(r => kan(r, 'logg.les')), true)

// ── Firmaoppsettet ─────────────────────────────────────────────────────────

sjekk('firmaoppsettet er for eier, admin og regnskap', ROLLER.filter(r => kan(r, 'firma.les')), ['owner', 'admin', 'regnskapsforer'])
sjekk('installatøren styrer faget, ikke firmaet', kan('installator', 'firma.les'), false)

// ── Sammenheng ─────────────────────────────────────────────────────────────

// En rolle som får se en detalj, men ikke lista den ligger i, er en skjerm som
// ikke kan nås. Slike hull oppstår når matrisen redigeres i farten.
for (const r of ROLLER) {
  const avhengig: [string, boolean][] = [
    ['ordre.alle uten ordre.les', kan(r, 'ordre.alle') && !kan(r, 'ordre.les')],
    ['ordre.endre uten ordre.les', kan(r, 'ordre.endre') && !kan(r, 'ordre.les')],
    ['faktura.marker uten faktura.les', kan(r, 'faktura.marker') && !kan(r, 'faktura.les')],
    ['db.les uten faktura.les', kan(r, 'db.les') && !kan(r, 'faktura.les')],
    ['priser.importer uten varer.les', kan(r, 'priser.importer') && !kan(r, 'varer.les')],
    ['tilbud.les uten kunder.les', kan(r, 'tilbud.les') && !kan(r, 'kunder.les')],
    ['ik.skriv uten ik.les', kan(r, 'ik.skriv') && !kan(r, 'ik.les')],
    ['skjema.skriv uten skjema.les', kan(r, 'skjema.skriv') && !kan(r, 'skjema.les')],
    // Å kunne skrive internkontrollen uten å kunne knytte et skjema til den
    // gir et system der halvparten av rutinene peker i løse lufta.
    ['ik.skriv uten skjema.skriv', kan(r, 'ik.skriv') && !kan(r, 'skjema.skriv')],
    ['bruker.inviter uten firma.les', kan(r, 'bruker.inviter') && !kan(r, 'firma.les')],
    ['en rettighet uten kontor', rettigheter(r).length > 0 && !kan(r, 'kontor')],
  ]
  for (const [hva, brutt] of avhengig) sjekk(`${r}: ${hva}`, brutt, false)
}

// ── Navn på skjermen ───────────────────────────────────────────────────────

sjekk('rollenavn er menneskelig', rollenavn('regnskapsforer'), 'Regnskapsfører')
sjekk('ukjent rolle får et ærlig navn', rollenavn('vaktmester'), 'Ukjent rolle')

// ── Skann og bakepool ──────────────────────────────────────────────────────

// Skannet er dokumentasjon av en jobb, saa den som leder jobben skal se koeen.
sjekk('installatør ser skannekøen', kan('installator', 'skann.les'), true)
sjekk('bas ser skannekøen', kan('bas', 'skann.les'), true)
sjekk('eier ser skannekøen', kan('owner', 'skann.les'), true)

// Regnskapsfoereren ser summen, ikke faget. Et 3D-skann er ikke fakturagrunnlag.
sjekk('regnskapsfører ser ikke skannekøen', kan('regnskapsforer', 'skann.les'), false)

// DEN VIKTIGSTE HER. Aa slaa paa Ampex-poolen er aa tillate at LiDAR av
// kundens bolig pakkes ut paa en maskin firmaet ikke eier. Det binder firmaet
// overfor kundene sine, og skal ikke ligge hos den som setter opp PC-en.
sjekk('kun eier og admin styrer poolen', kan('owner', 'pool.styr') && kan('admin', 'pool.styr'), true)
sjekk('installatør styrer ikke poolen', kan('installator', 'pool.styr'), false)
sjekk('bas styrer ikke poolen', kan('bas', 'pool.styr'), false)
sjekk('regnskapsfører styrer ikke poolen', kan('regnskapsforer', 'pool.styr'), false)

// Montoer og laerling jobber i appen, ikke paa kontorflaten.
sjekk('montør har fortsatt ingenting på kontoret', kan('montor', 'skann.les'), false)

// ── Hvem slipper folk inn i firmaet ────────────────────────────────
//
// Rollen bestemmer hvem som ser lønnsgrunnlaget. Den som setter rollen, setter
// altså det. Derfor er dette en kortere liste enn `firma.les`.

sjekk('kun eier og admin inviterer', ROLLER.filter(r => kan(r, 'bruker.inviter')), ['owner', 'admin'])

// Hun ser ansattlista — hun bestemmer bare ikke hvem som står i den.
sjekk('regnskapsfører ser ansatte', kan('regnskapsforer', 'firma.les'), true)
sjekk('regnskapsfører inviterer ikke', kan('regnskapsforer', 'bruker.inviter'), false)

// Installatøren er faglig ansvarlig, ikke arbeidsgiver. Han har ikke engang
// firmaflata, og skal ikke ha den bakveien inn heller.
sjekk('installatør inviterer ikke', kan('installator', 'bruker.inviter'), false)
sjekk('bas inviterer ikke', kan('bas', 'bruker.inviter'), false)

console.log(feil === 0 ? '\nAlle påstander holder.' : `\n${feil} påstander feilet.`)
process.exit(feil === 0 ? 0 : 1)
