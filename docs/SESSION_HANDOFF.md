# Session Handoff

## Status
Expo-prosjekt er satt opp og i aktiv utvikling. Supabase-prosjekt er opprettet, `.env.local` er satt. Flere SQL-migrasjoner er kjørt (foundation, orders, security hygiene, watermelon sync RPC). WatermelonDB er lokal offline-lagring med usynlig pull/push mot Supabase RPC. Hoveddomener i app: auth, tabs, prosjekter, ordre, lager, skjema.

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

### Docs
- `docs/DESIGN.md` — bindende UI-regler
- `docs/NEW_APP_PLAN.md` / `docs/NEW_APP_DATAMODEL.md` (hvis til stede)
- `CLAUDE.md` — agentregler

## Neste steg (prioritert)
1. Verifiser at alle WatermelonDB-tabeller (drawing-loop, drawing-markup, form-*, order-scan, tasks, …) har matching kolonner + RLS i Supabase — skriv migrasjon der noe mangler
2. RLS for nyeste tabeller (skjema, skann, tasks) hvis ikke dekket av security-hygiene-migrasjonen
3. Verifiser R2 / signerte URL-er for tegninger (`lib/drawings-storage.ts`)
4. Kjør/migrasjoner mot staging/prod etter behov
5. Senere domener (ikke startet): timeføring, HR, HMS, bygg-arkiv, kommunikasjon, fakturering

## Viktige beslutninger
- Offline-først: UI leser/skriver **kun** WatermelonDB; synk er usynlig
- Soft delete overalt (`deleted_at`) — aldri hard `DELETE`
- Immutable dokumenter — ny versjon, aldri overwrite
- RLS per `company_id`
- LiDAR / 3D as-built: iOS Pro only; retning er teksturert mesh + merking (k-rør), ikke kun RoomPlan
- Bil-som-lager; Teltonika QR-onboarding (planlagt/delvis)
- Ingen Capacitor — Expo Modules

## Prosjektlokasjon
`/Users/tormodholand/Documents/AmpexRevamp` (lokal) · GitHub: `stocktormod-design/AmpexRevamped`
