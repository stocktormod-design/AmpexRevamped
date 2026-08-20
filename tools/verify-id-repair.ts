/**
 * Selvtest av id-reparasjonen (lib/db/id-repair.ts) — kjør: npm run verify:id-repair
 *
 * Denne kjører den EKTE SQL-en mot en ekte SQLite, ikke mot en beskrivelse av
 * den. Det er hele poenget: feilen vi retter opp fantes fordi ingen hadde kjørt
 * noe. En test som bare sammenligner strenger ville hatt samme problem.
 */
import { byggReparasjonsSql, TABELLER_V30, UUID_MONSTER } from '../lib/db/id-repair'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => any }

let feil = 0
function sjekk(navn: string, ok: boolean, detalj?: unknown) {
  if (ok) return
  feil++
  console.error(`  ✗ ${navn}${detalj === undefined ? '' : `\n      ${JSON.stringify(detalj)}`}`)
}
const erUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s)

/** Tabellene slik WatermelonDBs SQLite-adapter faktisk lager dem: id + _status + _changed. */
function bygg(db: any) {
  for (const t of TABELLER_V30) {
    const ekstra = t.navn === 'order_archives' ? ['innhold'] : t.navn === 'orders' ? ['external_id', 'title'] : []
    const kolonner = ['id text primary key', '_status text', '_changed text']
      .concat([...t.referanser, ...ekstra].map(k => `"${k}" text`))
    db.exec(`create table "${t.navn}" (${kolonner.join(', ')});`)
  }
}

const GAMMEL_ORDRE = 'yF2ddjHEXJOu1WdK'
const GAMMEL_TEGNING = 'a7Qz01LmNoPqRsTu'
const SLETTET = 'zzTTuuVVwwXXyyZZ'
const FREDET = 'ArkivBeskyttet01'
const EKTE_UUID = '3f2a1b4c-5d6e-4f80-9a1b-2c3d4e5f6071'

const db = new DatabaseSync(':memory:')
bygg(db)

// Én gammel ordre med alt som henger i den.
db.exec(`insert into orders (id, _status, title) values ('${GAMMEL_ORDRE}', 'created', 'Sikringsskap Torshov');`)
db.exec(`insert into order_materials (id, _status, order_id) values ('m1000000000000001', 'created', '${GAMMEL_ORDRE}');`)
db.exec(`insert into time_entries (id, _status, order_id) values ('${EKTE_UUID}', 'created', '${GAMMEL_ORDRE}');`)
db.exec(`insert into order_documents (id, _status, order_id, template_id) values ('d1000000000000001', 'created', '${GAMMEL_ORDRE}', 'samsvarserklaering');`)
// En tegning med markering — to ledd fra hverandre, begge gamle.
db.exec(`insert into drawings (id, _status) values ('${GAMMEL_TEGNING}', 'created');`)
db.exec(`insert into drawing_markup (id, _status, drawing_id) values ('k1000000000000001', 'created', '${GAMMEL_TEGNING}');`)
// Lokalt slettet, aldri synket: skal bare bort.
db.exec(`insert into order_scans (id, _status, order_id) values ('${SLETTET}', 'deleted', '${GAMMEL_ORDRE}');`)
// Regnskapets id tilfeldigvis lik en gammel rad-id — skal IKKE røres.
db.exec(`insert into customers (id, _status) values ('c1000000000000001', 'created');`)
db.exec(`update orders set external_id = '${GAMMEL_TEGNING}' where id = '${GAMMEL_ORDRE}';`)
// Fredet av arkivet: pakken er hashet, id-en kan ikke skrives om.
db.exec(`insert into orders (id, _status, title) values ('${FREDET}', 'created', 'Frosset');`)
db.exec(`insert into order_archives (id, _status, order_id, innhold) values ('${EKTE_UUID.replace('3f2a', '4f2a')}', 'created', '${FREDET}', '{"ordre":{"id":"${FREDET}"}}');`)

const sql = byggReparasjonsSql(TABELLER_V30)
db.exec(sql)

const ordre = db.prepare('select id, title, external_id from orders order by title').all()
const nyOrdreId = ordre.find((o: any) => o.title === 'Sikringsskap Torshov')?.id

console.log('id-reparasjon')
sjekk('gammel ordre-id er skrevet om til uuid', erUuid(nyOrdreId ?? ''), nyOrdreId)
sjekk(
  'materiellet følger med ordren',
  db.prepare('select order_id from order_materials').get()?.order_id === nyOrdreId,
)
sjekk(
  'timeføringen følger med — også når raden selv alt hadde uuid',
  db.prepare('select order_id from time_entries').get()?.order_id === nyOrdreId,
)
sjekk('raden som alt var uuid beholder id-en sin', db.prepare(`select id from time_entries`).get()?.id === EKTE_UUID)
sjekk(
  'malnøkkelen er ikke en rad-id og skal stå urørt',
  db.prepare('select template_id from order_documents').get()?.template_id === 'samsvarserklaering',
)

const markup = db.prepare('select id, drawing_id from drawing_markup').get()
const tegning = db.prepare(`select id from drawings`).get()?.id
sjekk('tegningen er skrevet om', erUuid(tegning ?? ''), tegning)
sjekk('markeringen peker fortsatt på tegningen', markup?.drawing_id === tegning)
sjekk('markeringens egen id er skrevet om', erUuid(markup?.id ?? ''), markup?.id)

sjekk(
  'lokalt slettet rad med gammel id er borte — den kom aldri til serveren',
  db.prepare('select count(*) as n from order_scans').get()?.n === 0,
)
sjekk(
  'external_id er regnskapets id, ikke vår — den skal ikke skrives om',
  ordre.find((o: any) => o.title === 'Sikringsskap Torshov')?.external_id === GAMMEL_TEGNING,
)

const frosset = ordre.find((o: any) => o.title === 'Frosset')
sjekk('ordre nevnt i en arkivpakke beholder id-en — hashen må stemme', frosset?.id === FREDET)
sjekk(
  'arkivpakken er ikke rørt',
  db.prepare('select innhold from order_archives').get()?.innhold === `{"ordre":{"id":"${FREDET}"}}`,
)

// Ingen gjenværende gamle id-er utenom den fredede.
const rester: string[] = []
for (const t of TABELLER_V30) {
  for (const r of db.prepare(`select id from "${t.navn}" where id not like '${UUID_MONSTER}'`).all()) {
    rester.push(`${t.navn}:${r.id}`)
  }
}
sjekk('ingen gamle id-er igjen bortsett fra den arkivet freder', rester.join(',') === `orders:${FREDET}`, rester)

// Kjøres migrasjonen på nytt (ny installasjon over samme fil) skal ingenting endre seg.
const før = TABELLER_V30.map(t => JSON.stringify(db.prepare(`select * from "${t.navn}" order by id`).all()))
db.exec(sql)
const etter = TABELLER_V30.map(t => JSON.stringify(db.prepare(`select * from "${t.navn}" order by id`).all()))
sjekk('reparasjonen er idempotent', før.join('|') === etter.join('|'))

// Kartet skal ikke bli liggende igjen som en tabell WatermelonDB ikke kjenner.
sjekk(
  'hjelpetabellen er ryddet bort',
  db.prepare(`select count(*) as n from sqlite_master where name = '_id_reparasjon'`).get()?.n === 0,
)

if (feil) {
  console.error(`\n${feil} feil`)
  process.exit(1)
}
console.log(`  ✓ alle påstander holder (${TABELLER_V30.length} tabeller)`)
