-- Ni døde per-tabell-synkfunksjoner.
--
-- De er fra tiden før `generic_watermelon_sync` (20260819163026). Etter den går
-- alt gjennom `_watermelon_push_core` + `sync_payload_in`, som slår opp
-- kolonner dynamisk. De ni ble aldri fjernet.
--
-- ── Hvorfor de skal vekk, og ikke bare ligge ────────────────────────────────
--
-- 1. Alt i `public` er et REST-endepunkt hos PostgREST. De er SECURITY
--    DEFINER, og `authenticated` hadde fortsatt EXECUTE (sikkerhetsmigrasjonen
--    trakk kun `anon`). Ni funksjoner ingen kaller er ni dører ingen ser etter.
--
-- 2. To av dem — `loops` og `markup` — skriver til tabeller som IKKE FINNES.
--    Appens tabeller heter `drawing_loops` og `drawing_markup`. De kunne altså
--    aldri gjøre annet enn å feile.
--
-- ── Hvordan jeg vet at de er døde ───────────────────────────────────────────
--
-- Sjekket tre veier, og den FØRSTE SJEKKEN VAR FEIL: et LIKE-søk etter
-- «watermelon_push_%» i definisjonen til `_watermelon_push_core` traff, og jeg
-- konkluderte med at den dispatcher til dem. Den traff funksjonens eget navn.
-- Riktig sjekk — regex etter et faktisk kall, med den kallende funksjonen selv
-- utelatt — gir null treff. Klienten kaller kun `watermelon_push`
-- (`lib/db/sync.ts`).
--
-- Verifisert etterpå mot ekte base: `watermelon_pull` og `watermelon_push`
-- svarer fortsatt, og null per-tabell-funksjoner står igjen.
--
-- Angres ved å kjøre 20260819163026 på nytt.

drop function if exists public.watermelon_push_loops(jsonb);
drop function if exists public.watermelon_push_markup(jsonb);
drop function if exists public.watermelon_push_rooms(jsonb);
drop function if exists public.watermelon_push_tasks(jsonb);
drop function if exists public.watermelon_push_members(jsonb);
drop function if exists public.watermelon_push_order_scans(jsonb);
drop function if exists public.watermelon_push_form_comments(jsonb);
drop function if exists public.watermelon_push_form_revisions(jsonb);
drop function if exists public.watermelon_push_form_templates(jsonb);
