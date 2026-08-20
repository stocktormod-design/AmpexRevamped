/**
 * ── Reparasjon av gamle rad-id-er (skjema v30) ──────────────────────────────
 *
 * WatermelonDB genererer 16-tegns base62-id-er som standard. Postgres-tabellene
 * våre har `uuid` som primærnøkkel, så `setGenerator` i lib/db/index.ts ble lagt
 * inn (commit eef17dd) for å lage ekte UUID lokalt. Rader som ble laget FØR den
 * commiten har fortsatt base62-id.
 *
 * Det ville vært til å leve med hvis de bare feilet selv. Men `watermelon_push`
 * kjører alt i ÉN transaksjon: én slik rad avviser hele pushen, for alle
 * tabeller, hver gang, for alltid. Feilen er `invalid input syntax for type
 * uuid`, og fordi synken er usynlig (regel 2) sier den ingenting til brukeren.
 * På testdatabasen var det 8 rader. De hadde blokkert alt.
 *
 * Å HOPPE OVER radene er feil løsning: WatermelonDB markerer en hoppet rad som
 * synket likevel, og da er den tapt for godt. Derfor skrives id-ene om — med
 * alle referanser — så radene faktisk kommer fram.
 *
 * Hvorfor det er trygt å skrive om en id: en base62-id kan per definisjon aldri
 * ha vært på serveren (serveren ville avvist den). Raden er altså `_status =
 * 'created'` og finnes bare her. Ingen andre har sett den gamle id-en.
 *
 * Kjøres som et migrasjonssteg, ikke ved oppstart: migrasjoner går i
 * `adapter.setUp()` FØR databasen serverer et eneste spørsmål. Skrev vi om
 * id-ene senere, ville modeller som allerede lå i WatermelonDBs cache pekt på
 * rader som ikke fantes lenger.
 *
 * IKKE dekket: id-er som ligger inni JSON i `local_storage` (f.eks. hvilke
 * ordre som sist var åpnet). De blir stående og peker på en id som ikke finnes.
 * Det er med vilje — de er oppslag i en cache, så en nøkkel som ikke treffer
 * gir bare «aldri åpnet», og en rekursiv streng-erstatning i SQL for å rette
 * en sorteringsrekkefølge er mer kode enn problemet er verdt.
 */

/** En tabell og de kolonnene i den som peker på en LOKAL rad. */
export type Tabell = { navn: string; referanser: string[] }

/**
 * Kolonner som heter `*_id`, men ikke peker på en rad hos oss. De skal aldri
 * skrives om. I praksis er de trygge uansett — kartet inneholder bare id-er som
 * faktisk finnes som primærnøkkel her, og en Fiken-kunde-id eller en
 * Supabase-uid vil aldri kollidere med en tilfeldig base62-streng. Lista står
 * fordi SKILLET er verdt å skrive ned, ikke fordi omskrivingen ville skadet.
 *
 *   user_id, godkjenner_id, assigned_to  → Supabase auth-uid
 *   external_id, invoice_external_id     → regnskapssystemets id
 *   efobase_id                           → EFObasens id
 *   symbol_id                            → id fra lib/symbols.ts
 *   field_id                             → feltnøkkel i et skjema
 */
export const IKKE_LOKAL_REFERANSE = [
  'user_id',
  'godkjenner_id',
  'external_id',
  'invoice_external_id',
  'efobase_id',
  'symbol_id',
  'field_id',
] as const

/** LIKE-mønsteret for uuid-formen 8-4-4-4-12. `_` er ettegns-jokeren i LIKE. */
export const UUID_MONSTER = '________-____-____-____-____________'

/**
 * UUID v4 i ren SQLite. `random() & 3` i stedet for `abs(random()) % 4`: abs()
 * gir NULL på den minste 64-bits-verdien, og en NULL-id ville vært verre enn
 * problemet vi løser.
 */
const NY_UUID =
  "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || " +
  "substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))"

const KART = '_id_reparasjon'

/**
 * Tabellene slik de så ut ved v30. FRYST med vilje: et migrasjonssteg må
 * beskrive skjemaet det kjørte mot. Leste vi lista fra `schema` ville en tabell
 * lagt til i v31 dukket opp her, og en installasjon som går 29 → 31 ville
 * forsøkt å oppdatere en tabell som ikke fantes ennå.
 */
export const TABELLER_V30: Tabell[] = [
  { navn: 'activities', referanser: [] },
  { navn: 'assistant_notes', referanser: [] },
  { navn: 'customers', referanser: [] },
  { navn: 'drawing_loops', referanser: ['drawing_id'] },
  { navn: 'drawing_markup', referanser: ['drawing_id'] },
  { navn: 'drawings', referanser: ['project_id'] },
  { navn: 'form_comments', referanser: ['template_id'] },
  { navn: 'form_template_revisions', referanser: ['template_id'] },
  { navn: 'form_templates', referanser: [] },
  { navn: 'locations', referanser: [] },
  { navn: 'mesh_markers', referanser: ['room_id', 'order_scan_id'] },
  { navn: 'nfc_tags', referanser: ['target_id'] },
  { navn: 'order_approvals', referanser: ['order_id'] },
  { navn: 'order_archives', referanser: ['order_id', 'customer_id'] },
  { navn: 'order_documents', referanser: ['order_id', 'template_id'] },
  { navn: 'order_extras', referanser: ['order_id'] },
  { navn: 'order_materials', referanser: ['order_id', 'product_id'] },
  { navn: 'order_members', referanser: ['order_id'] },
  { navn: 'order_scans', referanser: ['order_id'] },
  { navn: 'order_signatures', referanser: ['order_id', 'extra_id'] },
  { navn: 'orders', referanser: ['customer_id', 'quote_id'] },
  { navn: 'product_prices', referanser: ['product_id'] },
  { navn: 'products', referanser: [] },
  { navn: 'project_members', referanser: ['project_id'] },
  { navn: 'projects', referanser: [] },
  { navn: 'quote_lines', referanser: ['quote_id', 'product_id', 'activity_id'] },
  { navn: 'quotes', referanser: ['customer_id', 'order_id', 'project_id'] },
  { navn: 'reminders', referanser: ['order_id'] },
  { navn: 'rooms', referanser: ['project_id', 'drawing_id'] },
  { navn: 'stock_movements', referanser: ['product_id', 'location_id', 'order_id'] },
  { navn: 'tasks', referanser: ['project_id', 'room_id'] },
  { navn: 'time_entries', referanser: ['order_id', 'activity_id'] },
]

/**
 * SQL-en som gjør jobben. Rekkefølgen er ikke tilfeldig:
 *
 *  1. Slett lokalt slettede rader med gammel id. De sto `_status='deleted'` og
 *     ventet på å bli slettet på serveren — men de kom aldri dit, så det finnes
 *     ingenting å slette. Å skrive om id-en ville bare sendt en sletting av en
 *     rad som ikke finnes.
 *  2. Bygg HELE kartet før noe oppdateres. Kartet er globalt, ikke per tabell:
 *     id-ene er tilfeldige og unike på tvers, så en referanse trenger ikke vite
 *     hvilken tabell den peker på for å bli slått opp riktig.
 *  3. Skriv om primærnøklene, så referansene. Referansekolonnene leser fortsatt
 *     de gamle verdiene — de er egne kolonner, oppdateringen av `id` rører dem
 *     ikke.
 *
 * Rader som er nevnt inni en arkivpakke (`order_archives.innhold`) holdes
 * utenfor. Pakken er hashet, og hashen er hele poenget med arkivet: skriver vi
 * om en id inni den, stemmer ikke SHA-256 lenger, og et dokument som skal
 * bevise noe i sju år beviser ingenting. Skriver vi om id-en UTENFOR pakken,
 * peker pakken på en rad som ikke finnes. Begge deler er verre enn å la raden
 * ligge, så den ligger — og lib/db/sync.ts sier fra om at synken står.
 */
export function byggReparasjonsSql(tabeller: Tabell[]): string {
  const s: string[] = []
  const arkiv = tabeller.some(t => t.navn === 'order_archives')
  // Peker en arkivpakke på id-en, la den være. Se forklaringen over.
  const fredet = (t: string) =>
    arkiv ? ` and not exists (select 1 from "order_archives" a where a.innhold like '%' || "${t}".id || '%')` : ''

  s.push(`create table if not exists ${KART} (gammel text primary key, ny text not null);`)
  s.push(`delete from ${KART};`)

  for (const t of tabeller) {
    s.push(`delete from "${t.navn}" where _status = 'deleted' and id not like '${UUID_MONSTER}';`)
  }
  for (const t of tabeller) {
    s.push(
      `insert or ignore into ${KART} (gammel, ny) select id, ${NY_UUID} from "${t.navn}" ` +
        `where id not like '${UUID_MONSTER}'${fredet(t.navn)};`,
    )
  }
  for (const t of tabeller) {
    s.push(
      `update "${t.navn}" set id = (select ny from ${KART} where gammel = "${t.navn}".id) ` +
        `where id in (select gammel from ${KART});`,
    )
    for (const kol of t.referanser) {
      s.push(
        `update "${t.navn}" set "${kol}" = (select ny from ${KART} where gammel = "${t.navn}"."${kol}") ` +
          `where "${kol}" in (select gammel from ${KART});`,
      )
    }
  }
  s.push(`drop table ${KART};`)
  return s.join('\n')
}
