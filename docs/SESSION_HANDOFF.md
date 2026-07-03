# Session Handoff

## Status
Expo-prosjekt satt opp og commitet. Venter på nytt Supabase-prosjekt.

## Hva som er gjort
- Expo SDK 56 + Expo Router + TypeScript
- NativeWind v4 (Tailwind v3)
- Supabase JS SDK installert
- Auth-routing (ikke innlogget → login, innlogget → tabs)
- Tab-shell: Hjem, Prosjekter, Ordre, Lager, Meg
- Innloggingsside (mørk design)
- `lib/supabase.ts` klar, venter på env-variabler
- Plan dokumentert i `docs/NEW_APP_PLAN.md`
- Datamodell i `docs/NEW_APP_DATAMODEL.md`

## Neste steg
1. Bruker oppretter nytt Supabase-prosjekt (eu-central-1)
2. Lim inn URL + anon key i `.env.local`
3. Skrive alle 14 SQL-migrasjoner
4. Sette opp RLS per tabell
5. Sette opp Storage buckets
6. Koble PowerSync

## Migrasjoner som skal skrives
```
001_companies.sql
002_profiles.sql          + trigger auto-opprett ved signup
003_company_categories.sql
004_customers.sql
005_projects.sql
006_drawings.sql
007_orders.sql
008_warehouses.sql
009_timeforing.sql
010_hr.sql
011_hms.sql
012_bygg_arkiv.sql
013_kommunikasjon.sql
014_fakturering.sql
```

## Viktige beslutninger tatt
- **Stack:** Expo + Supabase + NativeWind + PowerSync (offline-først) + Cloudflare R2
- **Ingen Capacitor** — Expo Modules for native plugins
- **Offline-først** — PowerSync synker SQLite på enhet mot Supabase
- **LiDAR:** iOS Pro only (iPhone 12 Pro+), rom-for-rom, ikke hele hus
- **Bil-som-lager** — hver bil er et lager, assignes mellom montører
- **Teltonika QR-onboarding** — plugg inn → skann QR → ferdig koblet
- **Timeforslag** — aldri automatisk, alltid godkjenn/avslå ved slutten av dagen
- **Soft delete** på alt — aldri DELETE, bruk deleted_at
- **Immutable dokumenter** — ny versjon alltid, aldri overskriv
- **RLS per company_id** — firma A ser aldri firma B sine data

## Prosjektlokasjon
`/Users/tormodholand/Documents/AmpexRevamp`
