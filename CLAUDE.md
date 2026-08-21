# CLAUDE.md — AmpexRevamp

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
npm run verify:prisfil-plan selvtest av prisfilplanen kontoret skriver (kostpris, påslag, upsert)
npm run verify:kontor-tilgang selvtest av kontorets rollematrise (hvem ser hva)
npm run verify:ik-skjelett  selvtest av internkontroll-skjelettet (hva som må være skriftlig, frister)
npm run verify:ik-hendelser selvtest av historikken (revisjon + audit slått sammen uten dobbelttelling)

cd desktop && npm run dev     Ampex Kontor i nettleseren (port 5174)
cd desktop && npm run build   typecheck + produksjonsbygg av kontorappen
```

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
- `docs/NEW_APP_PLAN.md` — komplett domene-, stack- og datamodell-plan
- `docs/STATUS.md` — hvor vi står nå og hva som er neste steg (LES DENNE FØRST)
- `docs/ROADMAP_2026-08.md` — full roadmap, AI-hull, tegningsspec, LiDAR-kalibrering
- `docs/GROSSIST_INTEGRASJON.md` — prisfiler, prissammenligning, autobestilling
- `docs/DESKTOP_OG_IMPORT.md` — Ampex Kontor (`desktop/`), SpeedyCraft-import og merge
- `docs/REGNSKAPSINTEGRASJON.md` — Fiken, Tripletex, PowerOffice Go

## Regler
1. Minimal diff — løs oppgaven, ikke refaktorer bredt
2. Offline-først — skjermer leser/skriver KUN lokal SQLite (WatermelonDB); aldri Supabase direkte fra UI. Synk er usynlig (ingen synk-knapp). **Gjelder montørappen.** `desktop/` skriver rett mot Supabase: kontor-PC-en mister ikke dekning i en kjeller, og skal ikke lagre en grossistkatalog lokalt bare for å synke den opp igjen
3. Lys tema, iOS-minimal stil (hvit bakgrunn, HIG-verdier — se lib/theme.ts når den finnes)
4. Roller styrer navigasjon — sjekk alltid `profiles.role`
5. Soft delete på alt — aldri `DELETE`, bruk `deleted_at`
6. Audit log på destruktive handlinger
7. Commit/push kun når bruker ber om det
8. Én font: Geist. Importer `Text`/`TextInput` fra `components/text`, ALDRI fra react-native — vekt→fontfil oversettes der, og uten den ignoreres `fontWeight` i stillhet
9. Grunnflaten er BRUN. Kremet papir er unntaket, og gjelder kun INNE I et dokument (utfylling/redigering av skjema, tilbudsdokumentet, tegningen). Papirskjermer bruker `paperType as t`, `colors.paper*` og `usePapirStatuslinje()`; alt annet bruker standardtokenene. Knapper er kremet (`cta`) eller kobber (`brand` + `brandLabel`) — aldri mørke
10. Batteri/termikk — ingen polling-løkker (synk trigges av forgrunn/nettverksretur), animasjoner kun transform/opacity på UI-tråden (Reanimated), Realtime-abonnement kun i forgrunn, tunge jobber (splat-bake) viser progress og respekterer `thermalState`
