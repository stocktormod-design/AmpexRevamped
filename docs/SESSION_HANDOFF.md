# Session Handoff

## Status
Expo-prosjekt er satt opp og i aktiv utvikling. Supabase-prosjekt er opprettet, `.env.local` er satt. Flere SQL-migrasjoner er kjørt (foundation, orders, security hygiene, watermelon sync RPC). WatermelonDB er lokal offline-lagring med usynlig pull/push mot Supabase RPC. Hoveddomener i app: auth, tabs, prosjekter, ordre, lager, skjema, skann. Nyeste arbeid er Scan V2 (Scaniverse-arkitektur, wireframe-lås-fangst, Android-port).

## Stack
- Expo SDK 56 + Expo Router + TypeScript
- NativeWind v4 (Tailwind)
- Supabase (Postgres, Auth, RLS per `company_id`)
- Cloudflare R2 (filer; tegninger er R2-only)
- **WatermelonDB** (lokal SQLite) — valgt over PowerSync 2026-07-03 (null løpende kostnad utover Supabase + R2)

## Hva som er gjort

### Infrastruktur
- `lib/supabase.ts` + env
- Offline: `lib/db/index.ts`, `schema.ts`, `migrations.ts`, modeller i `lib/db/models/`
- Synk: `lib/db/sync.ts` — `watermelon_pull` / `watermelon_push`, trigges ved innlogging / forgrunn / nettverksretur (ikke timer)
- `lib/drawings-storage.ts` — tegninger på R2

### App-skall
- Auth-routing: ikke innlogget → `/(auth)/login`, innlogget → `/(app)` tabs
- Tabs: Hjem, Prosjekter, Ordre, Lager, Meg (+ handlekurv)

### Domener i `app/(app)/`
- **Prosjekter:** liste, detalj, medlemmer, rom (progress per fag), tegninger (opprett/vis/markup)
- **Ordre:** liste, detalj, ny, material, skjema, skann (`order-scan`)
- **Lager:** liste, detalj, bevegelse, ny lokasjon, uttak, handlekurv
- **Skjema:** maler/revisjoner/utfylling (`app/(app)/skjema/`, `lib/forms`, form-fields-editor)
- **Skann (LiDAR):** `app/(app)/skann.tsx`, `lib/splat.ts`, `lib/scan-revisions.ts`, native modul `modules/ampex-splat/` (Swift: TSDF-fusjon, pose-refine, xatlas-unwrap, teksturbake, GLB-viewer). `presentMeshScan` gir teksturert GLB + nerfstudio-datasett. Msplat-splat-motoren er fjernet — kun teksturert mesh. GLB-ene ligger **kun på enheten** i dag; R2-upload gjenstår.

### Docs
- `docs/DESIGN.md` — bindende UI-regler
- `docs/GPU_BAKE_PLAN.md` — plan for LiDAR-bake på GPU-pool (firma-pool + Ampex-pool)
- `CLAUDE.md` — agentregler
- (`docs/NEW_APP_PLAN.md` / `docs/NEW_APP_DATAMODEL.md` er referert fra `CLAUDE.md`, men finnes ikke i repoet)

## Neste steg (prioritert)
1. Verifiser at alle WatermelonDB-tabeller (drawing-loop, drawing-markup, form-*, order-scan, tasks, …) har matching kolonner + RLS i Supabase — skriv migrasjon der noe mangler
2. RLS for nyeste tabeller (skjema, skann, tasks) hvis ikke dekket av security-hygiene-migrasjonen
3. Verifiser R2 / signerte URL-er for tegninger (`lib/drawings-storage.ts`)
4. Kjør/migrasjoner mot staging/prod etter behov
5. GPU-bake fase 1 — R2-upload av `framesDir` + `scan_jobs`-tabell (se `docs/GPU_BAKE_PLAN.md`)
6. Senere domener (ikke startet): timeføring, HR, HMS, bygg-arkiv, kommunikasjon, fakturering

## Viktige beslutninger
- Offline-først: UI leser/skriver **kun** WatermelonDB; synk er usynlig
- Soft delete overalt (`deleted_at`) — aldri hard `DELETE`
- Immutable dokumenter — ny versjon, aldri overwrite
- RLS per `company_id`
- LiDAR / 3D as-built: skanning er iOS Pro only, **Android er view-only**; retning er teksturert mesh + merking (k-rør), ikke kun RoomPlan
- GLB-ene ligger kun på telefonen som skannet → ingen andre i firmaet ser skannet i dag. R2-upload (GPU-bake fase 1) løser dette uavhengig av bake
- LiDAR-bake flyttes til GPU-pool — on-device grådig bake gir grå felt og flekkvis tekstur når nye synsvinkler legges til. To pooler, samme worker-binær: firmaets egne PC-er (ingen kostnad for Ampex) + Ampex-drevet pool som overflow. Se `docs/GPU_BAKE_PLAN.md`
- Ampex-pool er en **tredje utgiftspost** og opphever «kun Supabase + R2»-klausulen i `CLAUDE.md` når fase 4 lander
- Skann-revisjoner er ikke-destruktive (`lib/scan-revisions.ts`) — en server-bake blir ny revisjon, aldri overskriving
- Bil-som-lager; Teltonika QR-onboarding (planlagt/delvis)
- Ingen Capacitor — Expo Modules

## Prosjektlokasjon
`/Users/tormodholand/Documents/AmpexRevamp` (lokal) · GitHub: `stocktormod-design/AmpexRevamped`
