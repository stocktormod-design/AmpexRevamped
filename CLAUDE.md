# CLAUDE.md — AmpexRevamp

> **Start her:** les `docs/NAA.md` først. Den er nå-bildet (tilstand, hva som haster,
> åpne tråder) og oppdateres hyppig. `docs/STATUS.md` er fra august og tar feil om flere
> ting — se `docs/GJENNOMGANG_2026-09-08.md`.

## Prosjekt i én setning
Ampex er en cross-platform elektriker-app (iOS, Android, web) bygget med Expo + Supabase. Offline-først via WatermelonDB (valgt over PowerSync 2026-07-03: null løpende kostnad — kun Supabase + R2 tillatt som utgifter).

## Stack
| Lag | Teknologi |
|-----|-----------|
| Mobil / web | Expo SDK 56, Expo Router, React Native |
| Styling | NativeWind v4 (Tailwind CSS v3) |
| Backend | Supabase (Postgres, Auth, RLS per firma) |
| Storage | Cloudflare R2 |
| Offline | WatermelonDB (SQLite på enhet) + pull/push-synk mot Supabase RPC |
| GPS | Teltonika webhook |

## Mappestruktur
```
app/
  _layout.tsx          Root layout, auth-routing
  (auth)/              Innlogging, ikke-autentiserte ruter
  (app)/               Autentiserte ruter (tab-navigasjon)
lib/
  supabase.ts          Supabase-klient
  pricefile/           EFO/NELFO 4.0-parser (grossistenes vare-/prisfiler)
components/            Gjenbrukbare UI-komponenter
types/                 TypeScript-typer
tools/                 Node-skript (utenfor tsconfig — ingen @types/node i appen)
worker/                GPU-bake-worker (Python, kjører på PC-pool)
desktop/               Ampex Kontor — Tauri v2 + React + TS (eget npm-prosjekt)
  src/ruter/           Én mappe per rute
  src/lib/             I/O mot Supabase (regningen ligger i rotas lib/)
  src-tauri/           Rust-skallet. IKKE kompilert ennå — rustup mangler
```

`desktop/` er utenfor rotas `tsconfig.json` og har sitt eget. Delt logikk
importeres derfra med `@delt/…` → `lib/`. **Delt UI finnes ikke og skal ikke
finnes** — se `desktop/README.md`.

## Kommandoer
```
npm run typecheck         tsc --noEmit
npm run verify:pricefile  selvtest av EFO/NELFO-parseren mot fixture
npm run verify:invoicing  selvtest av fakturagrunnlaget (øre, MVA, gruppering)
npm run verify:forms      selvtest av skjemaformatet (v1-lesevei, betinget visning)
npm run verify:quoting    selvtest av tilbudsregningen (rabatt, DB, gyldighet)
npm run verify:timesheet  selvtest av ukelista (ukestart, arv av fakturerbarhet)
npm run verify:kalender   selvtest av ukeplanen (dagbøtting, sommertid)
npm run verify:varesok    selvtest av varesøk og varekort (el-nummer, EAN, flerord)
npm run verify:approvals  selvtest av faglig godkjenning (snapshot, avslag)
npm run verify:arkiv      selvtest av arkivpakken (SHA-256, determinisme, frister)
npm run verify:id-repair  selvtest av id-reparasjonen (kjører SQL-en mot ekte SQLite)
npm run verify:form-import selvtest av skjemaimporten (opprydding av modellsvar)
npm run verify:e2e        røyktest av HELE kjeden mot den LEVENDE databasen
npm run verify:prisfil-plan selvtest av prisfilplanen kontoret skriver (kostpris, påslag, upsert)
npm run verify:kontor-tilgang selvtest av kontorets rollematrise (hvem ser hva)
npm run verify:ik-skjelett  selvtest av internkontroll-skjelettet (hva som må være skriftlig, frister)
npm run verify:ik-hendelser selvtest av historikken (revisjon + audit slått sammen uten dobbelttelling)

cd desktop && npm run dev     Ampex Kontor i nettleseren (port 5174)
cd desktop && npm run build   typecheck + produksjonsbygg av kontorappen
```

`verify:e2e` skiller seg fra de andre: den logger inn som testbrukeren og kjører
én ordre gjennom kunde → ordre → timer → materiell → skjema → signatur →
godkjenning → faktura → arkiv → sletting, gjennom de samme to RPC-ene som appen
(`watermelon_push`/`watermelon_pull`). Den svarer på det de rene selvtestene
ikke kan: at koden faktisk skriver riktig til basen og leser det samme tilbake.
Steg 0 holder appens unionstyper opp mot databasens enums og CHECK-er, så en
statusverdi appen staver annerledes enn basen blir funnet av en test i stedet
for av en montør i en kjeller. Alt den lager ryddes bort (soft delete) til slutt.

Selvtestene er kjørbare skript med harde påstander, ikke en testrunner. Ny ren
logikk som håndterer penger, dokumentasjon eller lønn skal ha én.

## Ruting
- Ikke innlogget → `/(auth)/login`
- Innlogget → `/(app)` (tabs: Hjem, Prosjekter, Ordre, Lager, Meg)
- Auth-state håndteres i `app/_layout.tsx` via `supabase.auth.onAuthStateChange`

## Roller
`owner` `admin` `bas` `installator` `montør` `lærling` `regnskapsforer`

Roller hentes fra `profiles.role` i Supabase. RLS per `company_id` på alle tabeller.

Firmaer opprettes av Ampex (`ampex_admins` + `supabase/functions/ampex-admin`),
ansatte inviteres av eier/admin fra Firma-flata
(`supabase/functions/inviter-ansatt`). **`company_id` kan ikke settes fra en
klient** — `profiles_vern` avviser det — så begge veier går gjennom
`service_role` i en Edge Function, og klienten oppgir aldri hvilket firma.

## Miljøvariabler
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

## Plan
- `docs/STATUS.md` — hvor vi står nå og hva som er neste steg (LES DENNE FØRST)
- `docs/ROADMAP_2026-08.md` — full roadmap, AI-hull, tegningsspec, LiDAR-kalibrering
- `docs/GROSSIST_INTEGRASJON.md` — prisfiler, prissammenligning, autobestilling
- `docs/DESKTOP_OG_IMPORT.md` — Ampex Kontor (`desktop/`), SpeedyCraft-import og merge
- `docs/REGNSKAPSINTEGRASJON.md` — Fiken, Tripletex, PowerOffice Go
- `docs/SKANN_BESLUTNINGER.md` — skann-pipelinen: forkastede veier, målinger, Mac-harnessen
- `AGENTS.md` — inngangsdokument for andre AI-verktøy (kart over docs, arbeidsregler)
- `docs/PERSONVERN.md`, `VILKAR.md`, `DATABEHANDLERAVTALE.md` — personvern og avtaleverk (utkast)
- `docs/AI_KONTEKST.md` — trelagsdeling av AI-konteksten, LOK, NEK 400, RLS mot verktøykall

## Regler
1. Minimal diff — løs oppgaven, ikke refaktorer bredt
2. Offline-først — skjermer leser/skriver KUN lokal SQLite (WatermelonDB); aldri Supabase direkte fra UI. Synk er usynlig (ingen synk-knapp). **Gjelder montørappen.** `desktop/` skriver rett mot Supabase: kontor-PC-en mister ikke dekning i en kjeller, og skal ikke lagre en grossistkatalog lokalt bare for å synke den opp igjen
3. Lys tema, iOS-minimal stil (hvit bakgrunn, HIG-verdier — se lib/theme.ts når den finnes)
4. Roller styrer navigasjon — sjekk alltid `profiles.role`
5. Soft delete på alt — aldri `DELETE`, bruk `deleted_at`
6. Audit log på destruktive handlinger
7. Commit/push kun når bruker ber om det
8. Én font: Geist. Importer `Text`/`TextInput` fra `components/text`, ALDRI fra react-native — vekt→fontfil oversettes der, og uten den ignoreres `fontWeight` i stillhet
9. Grunnflaten er HVIT (byttet 2026-09-06, erstatter «papir og messing» — se docs/DESIGN.md «Hvitt og sort»): `canvas` = `bg` = #FFFFFF. Platen skiller seg fra grunnen med HÅRLINJE + nøytral skygge, ikke med farge. Én grå (`fill` #F2F2F4, `groupedBg` #F5F5F7) grupperer. Blekket er sort (#1D1D1F). Den ENE fylte handlingen per skjerm er SORT med hvit tekst (`cta`/`brand`) — sort på hvitt leser som beslutning, farget leser som kampanje. Messing er BORTE fra UI-et; `brand` peker på sort. Farge finnes kun som semantikk (status, vær). Valgt filterchip = sort pille. Instrumentflater (`tool*`) er nøytralt sort, dokumentflater (`paper*`) nøytralt lysegrå. Glass kun på krom (navbar, dock-pille, stemme-orb). Aldri ikonflis + chevron per listerad — radene ledes av egne data
10. Batteri/termikk — ingen polling-løkker (synk trigges av forgrunn/nettverksretur), animasjoner kun transform/opacity på UI-tråden (Reanimated), Realtime-abonnement kun i forgrunn, tunge jobber (splat-bake) viser progress og respekterer `thermalState`
