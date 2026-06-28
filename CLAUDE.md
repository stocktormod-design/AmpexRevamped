# CLAUDE.md — AmpexRevamp

## Prosjekt i én setning
Ampex er en cross-platform elektriker-app (iOS, Android, web) bygget med Expo + Supabase. Offline-først via PowerSync.

## Stack
| Lag | Teknologi |
|-----|-----------|
| Mobil / web | Expo SDK 56, Expo Router, React Native |
| Styling | NativeWind v4 (Tailwind CSS v3) |
| Backend | Supabase (Postgres, Auth, RLS per firma) |
| Storage | Cloudflare R2 |
| Offline | PowerSync (SQLite på enhet → Supabase) |
| GPS | Teltonika webhook |

## Mappestruktur
```
app/
  _layout.tsx          Root layout, auth-routing
  (auth)/              Innlogging, ikke-autentiserte ruter
  (app)/               Autentiserte ruter (tab-navigasjon)
lib/
  supabase.ts          Supabase-klient
components/            Gjenbrukbare UI-komponenter
types/                 TypeScript-typer
```

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
Se `docs/NEW_APP_PLAN.md` for komplett domene-, stack- og datamodell-plan.

## Regler
1. Minimal diff — løs oppgaven, ikke refaktorer bredt
2. Offline-først — queries via PowerSync/SQLite, ikke direkte Supabase
3. Mørk bakgrunn som standard (`bg-slate-950`)
4. Roller styrer navigasjon — sjekk alltid `profiles.role`
5. Soft delete på alt — aldri `DELETE`, bruk `deleted_at`
6. Audit log på destruktive handlinger
7. Commit/push kun når bruker ber om det
