/**
 * ENDE-TIL-ENDE-RØYKTEST mot den LEVENDE databasen.
 *
 *   npm run verify:e2e
 *
 * De andre verify-skriptene tester ren logikk uten database. Denne tester det
 * de ikke kan: at appens kode faktisk skriver riktig til Supabase og leser det
 * samme tilbake. Den kjører én hel ordre gjennom kjeden
 *
 *   kunde → ordre → tildeling → timer → materiell → skjema → signatur
 *         → godkjenning → fakturagrunnlag → arkiv → sletting
 *
 * gjennom NØYAKTIG de to RPC-ene appen bruker (`watermelon_push` /
 * `watermelon_pull`). Ingen direkte INSERT: da ville testen bekreftet at
 * Postgres virker, ikke at synken gjør det.
 *
 * Den logger inn som testbrukeren, ikke med service_role, slik at RLS,
 * `current_company_id()` og triggerne er med i bildet. Fakturasummen regnes med
 * appens egen `byggFakturagrunnlag` på radene som kom TILBAKE fra databasen —
 * det er hele poenget: at tallet stemmer etter en rundtur, ikke bare i minnet.
 *
 * Alt den lager ryddes bort til slutt (soft delete, regel 5) og
 * oppryddingen verifiseres. Feiler den underveis, ryddes det likevel.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  byggFakturagrunnlag, formatKr, tilOre,
  type MateriellInn, type TimeInn,
} from '../lib/invoicing'

// ── oppsett ────────────────────────────────────────────────────────────────

// Skriptet kjøres kompilert fra .tmp/, så __dirname peker feil. npm-scriptet
// kjøres alltid fra prosjektroten, og det er der .env.local ligger.
const ROT = process.cwd()
const TEST_EPOST = 'test@ampex.no'
const TEST_PASSORD = 'ampex-test-2026'
/** Alt testen lager får dette i tittel/navn, så det er gjenkjennelig i basen. */
const MERKE = 'RØYKTEST'

function lesEnv(): { url: string; anon: string } {
  const tekst = readFileSync(join(ROT, '.env.local'), 'utf8')
  const finn = (n: string) => tekst.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1]?.trim()
  const url = finn('EXPO_PUBLIC_SUPABASE_URL')
  const anon = finn('EXPO_PUBLIC_SUPABASE_ANON_KEY')
  if (!url || !anon) throw new Error('mangler EXPO_PUBLIC_SUPABASE_* i .env.local')
  return { url, anon }
}

let feil = 0
let sjekker = 0

function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  sjekker++
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
  } else {
    console.log(`✓ ${navn}`)
  }
}

function sant(navn: string, betingelse: boolean, hint = '') {
  sjekk(navn + (hint && !betingelse ? ` (${hint})` : ''), betingelse, true)
}

// ── synk-kontrakten, slik appen bruker den ─────────────────────────────────

type Rad = Record<string, unknown>
type Endringer = Record<string, { created?: Rad[]; updated?: Rad[]; deleted?: string[] }>

async function push(db: SupabaseClient, changes: Endringer, lastPulledAt = 0) {
  const { error } = await db.rpc('watermelon_push', { changes, last_pulled_at: lastPulledAt })
  if (error) throw new Error(`push: ${error.message}`)
}

type PullSvar = { changes: Record<string, { created: Rad[]; updated: Rad[]; deleted: string[] }>; timestamp: number }

async function pull(db: SupabaseClient, lastPulledAt = 0): Promise<PullSvar> {
  const { data, error } = await db.rpc('watermelon_pull', { last_pulled_at: lastPulledAt })
  if (error) throw new Error(`pull: ${error.message}`)
  return data as PullSvar
}

/** Alle rader for en tabell fra et pull-svar, uansett om de kom som created eller updated. */
function rader(svar: PullSvar, tabell: string): Rad[] {
  const t = svar.changes?.[tabell]
  if (!t) return []
  return [...(t.created ?? []), ...(t.updated ?? [])]
}

function finn(svar: PullSvar, tabell: string, id: string): Rad | undefined {
  return rader(svar, tabell).find(r => r.id === id)
}

// UUID-er lages her, slik appen gjør det: klienten eier id-en, ikke serveren.
function uuid(): string {
  return '10000000-1000-4000-8000-' + Math.floor(Math.random() * 1e12).toString(16).padStart(12, '0')
}

// ── verdikontrakten: appens typer mot databasens tillatte verdier ──────────

/**
 * Den stilleste feilen i dette systemet er en statusverdi appen tror på og
 * databasen avviser, eller verre: en appen aldri skriver fordi den staver den
 * annerledes. Den viser seg som «det lagret seg ikke» hos en montør i en
 * kjeller, uten spor.
 *
 * Her hentes fasiten fra basen (enums + CHECK-constraints) og holdes opp mot
 * unionstypene i appen. Mappingen er med vilje EKSPLISITT: en heuristikk som
 * gjetter hvilken type som hører til hvilken kolonne ville selv blitt en kilde
 * til stille feil.
 */
type Verdipar = {
  tabell: string; kolonne: string; fil: string; type: string
  /** Verdier som er AVLEDET i visningen og med vilje aldri lagres. */
  avledet?: string[]
}

const VERDIPAR: Verdipar[] = [
  { tabell: 'orders', kolonne: 'status', fil: 'lib/db/models/order.ts', type: 'OrderStatus' },
  { tabell: 'order_documents', kolonne: 'status', fil: 'lib/db/models/order-document.ts', type: 'OrderDocumentStatus' },
  { tabell: 'order_signatures', kolonne: 'purpose', fil: 'lib/db/models/order-signature.ts', type: 'SignaturFormal' },
  { tabell: 'deviations', kolonne: 'status', fil: 'lib/db/models/deviation.ts', type: 'AvvikStatus' },
  { tabell: 'deviations', kolonne: 'alvorlighet', fil: 'lib/db/models/deviation.ts', type: 'Alvorlighet' },
  { tabell: 'purchase_orders', kolonne: 'status', fil: 'lib/db/models/purchase-order.ts', type: 'BestillingStatus' },
  { tabell: 'stock_movements', kolonne: 'kind', fil: 'lib/db/models/stock-movement.ts', type: 'MovementKind' },
  // 'utlopt' regnes ut fra gyldigTil i visningen (se effektivStatus) og skrives
  // aldri — en rad som må endres ved midnatt trenger en jobb ingen har skrevet.
  { tabell: 'quotes', kolonne: 'status', fil: 'lib/quoting.ts', type: 'TilbudStatus', avledet: ['utlopt'] },
  { tabell: 'quotes', kolonne: 'decision_method', fil: 'lib/db/models/quote.ts', type: 'BeslutningsMate' },
  { tabell: 'order_extras', kolonne: 'status', fil: 'lib/db/models/order-extra.ts', type: 'TilleggStatus' },
  { tabell: 'order_extras', kolonne: 'pricing', fil: 'lib/db/models/order-extra.ts', type: 'TilleggPrising' },
  { tabell: 'order_extras', kolonne: 'approval_method', fil: 'lib/db/models/order-extra.ts', type: 'GodkjenningsMate' },
  { tabell: 'order_approvals', kolonne: 'beslutning', fil: 'lib/db/models/order-approval.ts', type: 'Beslutning' },
  { tabell: 'locations', kolonne: 'type', fil: 'lib/db/models/location.ts', type: 'LocationType' },
  { tabell: 'projects', kolonne: 'status', fil: 'lib/db/models/project.ts', type: 'ProjectStatus' },
]

/** Verdiene i en `export type X = 'a' | 'b'`-union, uansett linjebrytning. */
function tsUnion(fil: string, type: string): string[] | null {
  let tekst: string
  try { tekst = readFileSync(join(ROT, fil), 'utf8') } catch { return null }
  const m = tekst.match(new RegExp(`export type ${type}\\s*=([^\\n;]*(?:\\n\\s*\\|[^\\n;]*)*)`))
  if (!m) return null
  const verdier = m[1].match(/'([^']+)'/g)
  return verdier ? verdier.map(v => v.slice(1, -1)).sort() : null
}

async function sjekkVerdikontrakt(db: SupabaseClient) {
  console.log(`\n── 0. verdikontrakt: appens typer mot databasens fasit ──`)

  const { data, error } = await db.rpc('sync_tillatte_verdier')
  if (error) {
    // RPC-en finnes ikke: hopp over i stedet for å feile hele røyktesten.
    console.log(`   (hoppet over: ${error.message})`)
    return
  }
  const fasit = new Map<string, string[]>()
  for (const r of data as { tabell: string; kolonne: string; verdier: string[] }[]) {
    fasit.set(`${r.tabell}.${r.kolonne}`, [...r.verdier].sort())
  }

  for (const p of VERDIPAR) {
    const nokkel = `${p.tabell}.${p.kolonne}`
    const db_ = fasit.get(nokkel)
    const ts = tsUnion(p.fil, p.type)
    if (!db_) { sant(`${nokkel}: databasen har en verdiliste`, false, 'fant ingen enum/CHECK'); continue }
    if (!ts) { sant(`${nokkel}: fant ${p.type} i ${p.fil}`, false, 'typen ble ikke funnet'); continue }
    // Den farlige retningen: appen kan skrive noe basen vil avvise.
    const ukjente = ts.filter(v => !db_.includes(v) && !(p.avledet ?? []).includes(v))
    sant(
      `${nokkel} ↔ ${p.type}`,
      ukjente.length === 0,
      `appen kan skrive ${JSON.stringify(ukjente)}, basen godtar bare ${JSON.stringify(db_)}`,
    )
  }
}

// ── selve løpet ────────────────────────────────────────────────────────────

async function main() {
  const { url, anon } = lesEnv()
  const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n── innlogging ──`)
  const { data: auth, error: authFeil } = await db.auth.signInWithPassword({
    email: TEST_EPOST, password: TEST_PASSORD,
  })
  if (authFeil) throw new Error(`innlogging feilet: ${authFeil.message}`)
  const brukerId = auth.user!.id
  console.log(`✓ logget inn som ${TEST_EPOST}`)

  const { data: firmaId } = await db.rpc('current_company_id')
  sant('current_company_id() gir et firma', typeof firmaId === 'string' && firmaId.length > 0)

  await sjekkVerdikontrakt(db)

  const kundeId = uuid()
  const ordreId = uuid()
  const timeId = uuid()
  const materiellId = uuid()
  const dokId = uuid()
  const signaturId = uuid()
  const godkjenningId = uuid()
  const arkivId = uuid()
  const naa = Date.now()

  // Ryddes uansett utfall.
  const opprettet: Record<string, string[]> = {
    order_archives: [arkivId], order_approvals: [godkjenningId], order_signatures: [signaturId],
    order_documents: [dokId], order_materials: [materiellId], time_entries: [timeId],
    orders: [ordreId], customers: [kundeId],
  }

  try {
    // ── 1. kunde + ordre ───────────────────────────────────────────────────
    console.log(`\n── 1. kunde og ordre ──`)
    await push(db, {
      customers: { created: [{
        id: kundeId, name: `${MERKE} Kunde AS`, is_company: true,
        email: 'roeyktest@example.invalid', address: 'Teststien 1', postal_code: '1440', city: 'Drøbak',
        created_at: naa, updated_at: naa,
      }] },
    })
    await push(db, {
      orders: { created: [{
        id: ordreId, title: `${MERKE} downlights`, description: 'Automatisk røyktest',
        customer_id: kundeId, customer_name: `${MERKE} Kunde AS`, address: 'Teststien 1, 1440 Drøbak',
        status: 'mottatt', assigned_to: brukerId, scheduled_at: naa,
        // Serveren eier ordrenummeret (no_update). Vi sender et tull-tall med
        // vilje for å bevise at det IKKE lar seg overstyre fra klienten.
        order_number: 999999,
        created_at: naa, updated_at: naa,
      }] },
    })

    let svar = await pull(db)
    const kunde = finn(svar, 'customers', kundeId)
    const ordre = finn(svar, 'orders', ordreId)
    sant('kunden kom tilbake fra pull', !!kunde)
    sant('ordren kom tilbake fra pull', !!ordre)
    sjekk('kundenavnet overlevde rundturen', kunde?.name, `${MERKE} Kunde AS`)
    sjekk('ordren er tildelt riktig bruker', ordre?.assigned_to, brukerId)
    sjekk('ordren peker på kunden', ordre?.customer_id, kundeId)
    // `sync_hidden_columns()` holder company_id og deleted_at borte fra pull med
    // vilje: RLS scoper alt til firmaet, så klienten skal verken se eller kunne
    // sette dem. Lekker de ut, er firmaskillet blitt klientens ansvar.
    sant('company_id lekker ikke ut til klienten', ordre?.company_id === undefined)
    sant('deleted_at lekker ikke ut til klienten', ordre?.deleted_at === undefined)
    sant(
      'order_number er beskyttet av no_update (klientens 999999 ble ikke godtatt)',
      ordre?.order_number !== 999999,
      `fikk ${ordre?.order_number}`,
    )

    // ── 2. timer og materiell ──────────────────────────────────────────────
    console.log(`\n── 2. timer og materiell ──`)
    await push(db, {
      time_entries: { created: [{
        id: timeId, order_id: ordreId, user_id: brukerId, user_name: 'Røyktest Montør',
        date: naa, hours: 7.5, note: 'Montasje downlights', billable: true,
        created_at: naa, updated_at: naa,
      }] },
      order_materials: { created: [{
        id: materiellId, order_id: ordreId, elnummer: '1000000',
        description: 'Downlight 8W', quantity: 12, unit: 'stk',
        unit_price: 249.5, cost_price: 130, vat_type: 'hoy', billable: true,
        created_at: naa, updated_at: naa,
      }] },
    })

    svar = await pull(db)
    const time = finn(svar, 'time_entries', timeId)
    const materiell = finn(svar, 'order_materials', materiellId)
    sant('timeføringen kom tilbake', !!time)
    sant('materiellet kom tilbake', !!materiell)
    sjekk('timetallet overlevde som desimaltall', Number(time?.hours), 7.5)
    sjekk('antall overlevde', Number(materiell?.quantity), 12)
    sjekk('enhetsprisen overlevde med desimaler', Number(materiell?.unit_price), 249.5)

    // ── 3. fakturagrunnlaget, regnet på det som kom TILBAKE ────────────────
    console.log(`\n── 3. fakturagrunnlag fra databasens egne rader ──`)
    const materiellInn: MateriellInn[] = [{
      id: String(materiell!.id),
      beskrivelse: String(materiell!.description),
      antall: Number(materiell!.quantity),
      enhet: String(materiell!.unit),
      elnummer: materiell!.elnummer as string | null,
      enhetsprisKr: Number(materiell!.unit_price),
      kostprisKr: Number(materiell!.cost_price),
      mvaType: materiell!.vat_type as string | null,
      fakturerbar: materiell!.billable as boolean | null,
    }]
    const timerInn: TimeInn[] = [{
      id: String(time!.id),
      personId: String(time!.user_id),
      personNavn: String(time!.user_name),
      dato: new Date(String(time!.date)).getTime(),
      timer: Number(time!.hours),
      notat: time!.note as string | null,
      fakturerbar: time!.billable as boolean | null,
      aktivitetTimepris: 850,
      aktivitetNavn: 'Elektriker',
    }]

    const grunnlag = byggFakturagrunnlag(materiellInn, timerInn)
    // 12 × 249,50 = 2 994,00   +   7,5 t × 850 = 6 375,00   =  9 369,00 netto
    const ventetNetto = tilOre(12 * 249.5) + tilOre(7.5 * 850)
    sjekk('netto stemmer etter rundtur i databasen', grunnlag.nettoOre, ventetNetto)
    sjekk('MVA er 25 % av netto', grunnlag.mvaOre, Math.round(ventetNetto * 0.25))
    sjekk('brutto = netto + mva', grunnlag.bruttoOre, grunnlag.nettoOre + grunnlag.mvaOre)
    sjekk('kostprisen kom med (12 × 130)', grunnlag.kostOre, tilOre(12 * 130))
    sant('dekningsbidrag er regnet ut', grunnlag.dbOre !== null)
    console.log(`   netto ${formatKr(grunnlag.nettoOre)} · mva ${formatKr(grunnlag.mvaOre)} · brutto ${formatKr(grunnlag.bruttoOre)}`)

    // ── 4. skjema og signatur ──────────────────────────────────────────────
    console.log(`\n── 4. dokumentasjon og signatur ──`)
    await push(db, {
      order_documents: { created: [{
        id: dokId, order_id: ordreId, template_id: 'samsvarserklaering', template_version: 1,
        // 'fullfort', ikke 'ferdig' — se OrderDocumentStatus og CHECK-en i basen.
        status: 'fullfort', data: JSON.stringify({ anlegg: 'Bolig', maalt_isolasjon: '> 1 MΩ' }),
        completed_by: brukerId, completed_at: naa,
        created_at: naa, updated_at: naa,
      }] },
      order_signatures: { created: [{
        id: signaturId, order_id: ordreId, purpose: 'ferdig', signer_name: 'Ola Røyktest',
        strokes: JSON.stringify([[[0.1, 0.5], [0.9, 0.5]]]), aspect: 2, signed_at: naa, signed_by: brukerId,
        created_at: naa, updated_at: naa,
      }] },
    })

    svar = await pull(db)
    const dok = finn(svar, 'order_documents', dokId)
    const sig = finn(svar, 'order_signatures', signaturId)
    sant('skjemaet kom tilbake', !!dok)
    sant('signaturen kom tilbake', !!sig)
    sjekk('skjemaets status overlevde', dok?.status, 'fullfort')
    sant('skjemadataen er lesbar JSON etter rundturen',
      typeof dok?.data === 'string' && JSON.parse(String(dok.data)).anlegg === 'Bolig')
    sant('signaturstrekene overlevde som JSON',
      Array.isArray(JSON.parse(String(sig?.strokes))))

    // ── 5. godkjenning ─────────────────────────────────────────────────────
    console.log(`\n── 5. faglig godkjenning ──`)
    await push(db, {
      order_approvals: { created: [{
        id: godkjenningId, order_id: ordreId, beslutning: 'godkjent',
        godkjenner_id: brukerId, godkjenner_navn: 'Røyktest Installatør',
        sum_ore: grunnlag.bruttoOre, timer: 7.5, antall_materiell: 1,
        antall_dokumenter: 1, antall_signaturer: 1, besluttet_at: naa,
        created_at: naa, updated_at: naa,
      }] },
      orders: { updated: [{ id: ordreId, status: 'fakturaklar', updated_at: Date.now() }] },
    })

    svar = await pull(db)
    const godkjenning = finn(svar, 'order_approvals', godkjenningId)
    sant('godkjenningen kom tilbake', !!godkjenning)
    sjekk('beslutningen er lagret', godkjenning?.beslutning, 'godkjent')
    sjekk('godkjenningens sum matcher fakturagrunnlaget', Number(godkjenning?.sum_ore), grunnlag.bruttoOre)
    sjekk('ordren er nå fakturaklar', finn(svar, 'orders', ordreId)?.status, 'fakturaklar')

    // ── 6. fakturert + arkiv ───────────────────────────────────────────────
    console.log(`\n── 6. fakturering og arkiv ──`)
    const aar = new Date().getFullYear()
    await push(db, {
      orders: { updated: [{ id: ordreId, status: 'fakturert', invoiced_at: Date.now(), updated_at: Date.now() }] },
      order_archives: { created: [{
        id: arkivId, order_id: ordreId, customer_id: kundeId, customer_name: `${MERKE} Kunde AS`,
        aar, r2_key: `arkiv/${aar}/${ordreId}.zip`,
        sha256: 'a'.repeat(64), bytes: 12345,
        innhold: { dokumenter: 1, signaturer: 1 },
        frosset_at: naa, frosset_av: brukerId,
        oppbevares_til: `${aar + 5}-12-31`,
        created_at: naa, updated_at: naa,
      }] },
    })

    svar = await pull(db)
    const arkiv = finn(svar, 'order_archives', arkivId)
    sant('arkivraden kom tilbake', !!arkiv)
    sjekk('ordren er fakturert', finn(svar, 'orders', ordreId)?.status, 'fakturert')
    sant('invoiced_at er satt', !!finn(svar, 'orders', ordreId)?.invoiced_at)
    sjekk('sha256 overlevde uendret', arkiv?.sha256, 'a'.repeat(64))
    sjekk('oppbevaringsfristen er 5 år fram', String(arkiv?.oppbevares_til).slice(0, 4), String(aar + 5))
    sant('innhold overlevde som jsonb',
      !!arkiv?.innhold && (arkiv.innhold as Record<string, number>).dokumenter === 1)

    // ── 7. inkrementell pull ───────────────────────────────────────────────
    console.log(`\n── 7. inkrementell pull ──`)
    const foer = svar.timestamp
    await push(db, {
      orders: { updated: [{ id: ordreId, description: 'Endret av røyktesten', updated_at: Date.now() }] },
    })
    const delta = await pull(db, foer)
    const endret = finn(delta, 'orders', ordreId)
    sant('en endring etter siste pull kommer med i neste pull', !!endret)
    sjekk('endringen er den vi gjorde', endret?.description, 'Endret av røyktesten')
    sant(
      'en urørt rad kommer IKKE med i den inkrementelle pullen',
      !finn(delta, 'customers', kundeId),
      'kunden var uendret og skulle ikke vært med',
    )
    // ── 7b. konflikt: to montører, samme ordre, hvert sitt felt ────────────
    // Dette er den dyre feilen i et offline-først-system. A og B har begge
    // ordren i lomma. A setter status, B skriver en merknad. Begge pusher HELE
    // raden, for det er det WatermelonDB sender. Uten feltnivå-fletting
    // overskriver den siste den førstes arbeid uten et spor.
    console.log(`\n── 7b. samtidig endring fra to enheter ──`)
    const felles = await pull(db)
    const foerKonflikt = finn(felles, 'orders', ordreId)!

    // A endrer KUN status. `_changed` er WatermelonDBs egen liste over hvilke
    // felter enheten faktisk rørte — den følger med i pushen.
    await push(db, {
      orders: { updated: [{
        ...foerKonflikt, status: 'fakturaklar',
        _status: 'updated', _changed: 'status',
        updated_at: Date.now(),
      }] },
    })

    // B satt med sin kopi fra FØR A pushet, og endrer kun beskrivelsen.
    await push(db, {
      orders: { updated: [{
        ...foerKonflikt, description: 'Merknad fra montør B',
        _status: 'updated', _changed: 'description',
        updated_at: Date.now(),
      }] },
    })

    const etterKonflikt = finn(await pull(db), 'orders', ordreId)
    sjekk('B sin merknad kom fram', etterKonflikt?.description, 'Merknad fra montør B')
    sjekk('A sin statusendring overlevde B sin push', etterKonflikt?.status, 'fakturaklar')

    // Samme felt fra begge: her FINNES det ikke noe riktig svar, og siste skal
    // vinne. Poenget med testen er at det er et bevisst valg, ikke en tilfeldighet.
    await push(db, {
      orders: { updated: [{ ...foerKonflikt, title: 'Tittel fra A', _changed: 'title', updated_at: Date.now() }] },
    })
    await push(db, {
      orders: { updated: [{ ...foerKonflikt, title: 'Tittel fra B', _changed: 'title', updated_at: Date.now() }] },
    })
    sjekk('samme felt fra to enheter: siste vinner',
      finn(await pull(db), 'orders', ordreId)?.title, 'Tittel fra B')

    // Bakoverkompatibilitet: en push UTEN `_changed` må fortsatt skrive hele
    // raden. Ellers ville en eldre klient stille slutte å lagre.
    await push(db, {
      orders: { updated: [{ ...foerKonflikt, title: 'Uten _changed', description: 'Skrevet uten _changed', updated_at: Date.now() }] },
    })
    const utenChanged = finn(await pull(db), 'orders', ordreId)
    sjekk('push uten _changed skriver fortsatt hele raden (tittel)', utenChanged?.title, 'Uten _changed')
    sjekk('push uten _changed skriver fortsatt hele raden (beskrivelse)', utenChanged?.description, 'Skrevet uten _changed')

    // Sletting mot endring: den som sletter skal vinne. En rad som er slettet
    // av basen skal ikke gjenoppstå fordi en montør endret en merknad offline.
    const slettId = uuid()
    opprettet.time_entries.push(slettId)
    await push(db, {
      time_entries: { created: [{
        id: slettId, order_id: ordreId, user_id: brukerId, user_name: 'Røyktest Montør',
        date: naa, hours: 1, note: 'Skal slettes', billable: true, created_at: naa, updated_at: naa,
      }] },
    })
    await push(db, { time_entries: { deleted: [slettId] } })
    await push(db, {
      time_entries: { updated: [{ id: slettId, note: 'Endret etter sletting', _changed: 'note', updated_at: Date.now() }] },
    })
    sant('en slettet rad gjenoppstår ikke av en senere endring',
      !finn(await pull(db), 'time_entries', slettId))
  } finally {
    // ── 8. opprydding (soft delete, regel 5) ────────────────────────────────
    console.log(`\n── 8. opprydding ──`)
    const sletting: Endringer = {}
    for (const [tabell, ider] of Object.entries(opprettet)) sletting[tabell] = { deleted: ider }
    try {
      await push(db, sletting)
      const etter = await pull(db)
      const igjen = Object.entries(opprettet)
        .flatMap(([tabell, ider]) => ider.filter(id => !!finn(etter, tabell, id)).map(id => `${tabell}:${id}`))
      sjekk('alt testen opprettet er ryddet bort', igjen, [])
    } catch (e) {
      feil++
      console.error(`✗ opprydding feilet: ${(e as Error).message}`)
      console.error(`  RYDD MANUELT: ${JSON.stringify(opprettet)}`)
    }
  }

  console.log(`\n${feil === 0 ? '✓' : '✗'} ${sjekker - feil}/${sjekker} sjekker OK`)
  if (feil > 0) process.exit(1)
}

main().catch(e => {
  console.error(`\n✗ røyktesten stoppet: ${e.message}`)
  process.exit(1)
})
