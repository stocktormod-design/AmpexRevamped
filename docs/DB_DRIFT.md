# Databasen og repoet er ikke i synk

Oppdaget 2026-08-19 ved å inspisere prosjektet `vymgogzcicbaizjlaurr`
(`ampex-revamped`, eu-west-1) direkte.

## Funnet

| | Antall |
|---|---|
| Migrasjonsfiler i `supabase/migrations/` | 7 |
| Migrasjoner faktisk kjørt i databasen | 25 |

**Atten migrasjoner finnes kun i databasen.** De ble kjørt med
`supabase db push` eller via MCP uten at filene ble sjekket inn, og
definisjonene er ikke i git.

Migrasjoner som finnes i databasen, men ikke i repoet:

```
20260703180027  order_documents_table_and_sync
20260703203421  order_materials_table_and_sync
20260703211139  lager_products_locations_movements
20260704075446  projects_and_drawings
20260704080210  project_members
20260704080331  sync_core_wrapper_cleanup
20260704084957  drawings_storage_bucket
20260704093327  drop_supabase_storage_drawings_policies
20260704095536  project_rooms
20260704105724  drawing_markup
20260704113117  tasks_and_scan_responsible
20260704114216  rooms_shape_geometry
20260704132937  form_engine
20260704133019  form_engine_pull
20260704135852  drawing_loops
20260704135940  drawing_loops_pull
20260704143449  order_scans
20260704143538  order_scans_pull
20260811174825  ai_company_keys
20260814223516  scan_jobs
20260814223613  scan_jobs_grants
```

## Motsatt vei: to migrasjonsfiler er ALDRI kjørt

```
20260815120000_gpu_bake_worker_pool.sql   → worker_nodes, worker_enrollments finnes ikke
20260817200000_ampex_public_pool.sql      → pool_settings finnes ikke
```

Databasen har i stedet `scan_workers` og `scan_jobs` fra `20260814223516`.
Poolen med `is_public`, nådetid og versjonssperre — som `STATUS.md` beskriver
som «bygget» — **finnes ikke i noen database.** Den finnes bare som en
usjekket SQL-fil.

`STATUS.md` sa allerede at migrasjonen «ikke er kjørt». Det som er nytt er at
den heller ikke *kan* kjøres uendret: `scan_jobs` finnes allerede med et annet
skjema, og `worker_nodes` overlapper med `scan_workers`.

## Rettelse: «bare orders synker» er feil

Memoryen `sync-scope-gap` og `STATUS.md` sier at kun `orders` synker. Det var
sant 3. juli. Databasen synker i dag **17 tabeller**:

```
_watermelon_pull_core:  orders, order_documents, order_materials, products,
                        locations, stock_movements, projects, drawings
watermelon_pull:        rooms, drawing_markup, tasks, project_members,
                        form_templates, form_template_revisions, form_comments,
                        drawing_loops, order_scans
```

Push er `_watermelon_push_core` pluss ni per-tabell-funksjoner
(`watermelon_push_tasks`, `watermelon_push_rooms`, …).

## Gjort 2026-08-19

### 1. Ordresystemets tabeller (`order_system_tables_and_columns`) — KJØRT

Nye tabeller: `customers`, `activities`, `time_entries`, `order_members`.
Nye kolonner: pris/MVA på `products` og `order_materials`, `customer_id` og
faktura-felt på `orders`, `ai_field_origin` på `order_documents`, `reg_nr` og
`tracker_imei` på `locations`.

`time_entries` er den viktigste: timene lå kun i SQLite på én telefon, og
forsvant med telefonen.

### 2. Generisk synk (`generic_watermelon_sync`) — KJØRT

`sync_tables` er nå registeret. 21 tabeller. Kolonnene leses fra katalogen, så
en ny kolonne krysser nettverket fra dagen den finnes.

De gamle funksjonene står urørt og ubrukt som tilbakevei:
`_watermelon_pull_core`, `_watermelon_push_core`, `watermelon_push_tasks`,
`_rooms`, `_members`, `_markup`, `_loops`, `_order_scans`, `_form_templates`,
`_form_revisions`, `_form_comments`.

Rulle tilbake = `create or replace` de to inngangspunktene til å kalle
`_core`-funksjonene igjen. Definisjonene ligger i
`supabase/baseline/schema_2026-08-19.sql`.

### 3. Én ekte feil funnet av testen (`generic_sync_push_update_first`) — KJØRT

Første versjon brukte `insert … on conflict do update`. Postgres evaluerer
INSERT-delen **før** konflikten oppdages, så en oppdatering der klienten sendte
et delsett av kolonnene brøt NOT NULL på en kolonne som ikke var med — selv om
raden allerede fantes med verdien i behold.

Push gjør nå UPDATE først og INSERT bare hvis ingen rad ble truffet.

Verifisert med en full runde mot `time_entries` i en transaksjon som ble rullet
tilbake:

```
INSERT  hours=7.50  date=2026-08-17 20:53:20+00  company_id satt server-side
        created_by satt server-side  note og internal_note lagret
UPDATE  kun hours sendt → hours=9.00, internal_note og order_id overlevde
PULL    date tilbake som 1787000000000 ms — eksakt rundtur
DELETE  soft (deleted_at satt), raden står igjen
```

### 4. Skjemaet er sikret (`supabase/baseline/schema_2026-08-19.sql`)

2873 linjer, 28 funksjoner. **`supabase db pull` kunne ikke brukes** —
migrasjonshistorikkene er for divergerte, og CLI-en foreslo å markere 28 kjørte
migrasjoner som «reverted» og påstå at `gpu_bake_worker_pool` er *applied*.
Det siste er direkte usant, og ville gjort historikken verre enn ingen historikk.

`supabase db dump` gjør jobben uten å røre historikken. Baselinen er nå den
gjenopprettbare kilden til hva databasen faktisk inneholder.

### Sidefunn: fire e-postmaler mangler i repoet

`supabase/config.toml` peker på `supabase/templates/invite.html`,
`recovery.html`, `confirmation.html` og `magic_link.html`. Ingen av dem finnes.
**Det blokkerer alle `supabase`-CLI-kommandoer**, inkludert `db reset` og
`db push`. Samme drift, annen mappe.

## Fortsatt lokalt, uten servertabell

`nfc_tags`, `reminders`, `assistant_notes`.

`reminders` og `assistant_notes` er **bruker**skopet, ikke firmaskopet, og
trenger en annen RLS-form enn de andre — derfor ikke tatt med her.

`mesh_markers` fikk servertabell + sync_tables-rad 2026-08-26
(`20260826210000_mesh_markers.sql` — anvendt på liva-DB-en OG sjekket inn, i
motsetning til de fil-løse migrasjonene denne fila handler om). Skann-GLB-ene
speiles samtidig til R2 under `room-scans/`-prefiks (`lib/scan-storage.ts`;
`r2-sign` v7 godtar prefikset, kilden er nå sjekket inn under
`supabase/functions/r2-sign/`).

## Hvorfor driften oppsto

Den håndskrevne synken er årsaken. Å legge til én tabell krevde å redigere tre
steder i en 11 KB funksjon, og å legge til én kolonne krevde å huske å redigere
den samme kolonnelista tre ganger. Det er ikke en disiplinsvikt, det er et
design som straffer riktig oppførsel.

Registeret fjerner den straffen.

## Neste steg

1. **Skriv de fire e-postmalene**, eller fjern referansene fra `config.toml`.
   CLI-en er ubrukelig til det er gjort.
2. **Avgjør hva som skjer med poolen.** `20260815120000_gpu_bake_worker_pool.sql`
   og `20260817200000_ampex_public_pool.sql` kan ikke kjøres slik de står —
   `scan_jobs` finnes med et annet skjema, og `worker_nodes` overlapper med
   `scan_workers`. Enten skrives de om mot det som faktisk finnes, eller så
   droppes `scan_workers`/`scan_jobs` og de kjøres rent.
3. **Kjør en ekte synk fra telefonen** og se at kunder, timer og priser krysser.
   Alt over er verifisert i SQL, ingenting er verifisert fra appen.
