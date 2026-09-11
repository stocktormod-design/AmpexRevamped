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
```

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

## Miljøvariabler
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

## Plan
- `docs/STATUS.md` — hvor vi står nå og hva som er neste steg (LES DENNE FØRST)
- `docs/ROADMAP_2026-08.md` — full roadmap, AI-hull, tegningsspec, LiDAR-kalibrering
- `docs/GROSSIST_INTEGRASJON.md` — prisfiler, prissammenligning, autobestilling
- `docs/DESKTOP_OG_IMPORT.md` — Ampex Desktop, SpeedyCraft-import og merge
- `docs/REGNSKAPSINTEGRASJON.md` — Fiken, Tripletex, PowerOffice Go
- `docs/SKANN_BESLUTNINGER.md` — skann-pipelinen: forkastede veier, målinger, Mac-harnessen
- `AGENTS.md` — inngangsdokument for andre AI-verktøy (kart over docs, arbeidsregler)

## Regler
1. Minimal diff — løs oppgaven, ikke refaktorer bredt
2. Offline-først — skjermer leser/skriver KUN lokal SQLite (WatermelonDB); aldri Supabase direkte fra UI. Synk er usynlig (ingen synk-knapp)
3. Lys tema, iOS-minimal stil (hvit bakgrunn, HIG-verdier — se lib/theme.ts når den finnes)
4. Roller styrer navigasjon — sjekk alltid `profiles.role`
5. Soft delete på alt — aldri `DELETE`, bruk `deleted_at`
6. Audit log på destruktive handlinger
7. Commit/push kun når bruker ber om det
8. Én font: Geist. Importer `Text`/`TextInput` fra `components/text`, ALDRI fra react-native — vekt→fontfil oversettes der, og uten den ignoreres `fontWeight` i stillhet
9. Grunnflaten er PAPIR (lås 2026-08-29, se docs/DESIGN.md «Papir og messing»): `canvas` varmt papir, plater/kort på `bg` (hvitere ark) med VARM skygge (`shadows.card`). Kremet dokument-ark (`paper*`) gjelder kun INNE I et dokument; mørke instrument-flater (`tool*`) kun for skann/AR o.l. Glass kun på krom (navbar, dock-pille, stemme-orb). Messing (`brand`) brukes gjerrig — primærknapp + én aksent per skjermområde; primærknappen er det mørkeste varme på skjermen (messing med `#1C1712`-tekst), aldri blek på blek. Aldri ikonflis + chevron per listerad — radene ledes av egne data
10. Batteri/termikk — ingen polling-løkker (synk trigges av forgrunn/nettverksretur), animasjoner kun transform/opacity på UI-tråden (Reanimated), Realtime-abonnement kun i forgrunn, tunge jobber (splat-bake) viser progress og respekterer `thermalState`
