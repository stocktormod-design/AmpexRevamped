-- Komponenter funnet i tegningens symbolforklaring (2026-09-13, lib/symbol-detekt.ts).
-- 'tegning' = symbolet står alt på tegningen; appen tegner ingen glyf oppå, bare trykkflate.
-- NB: sync_pull_columns sender nye kolonner til appen uansett — appens skjema (v38) må ut samtidig.
alter table public.fire_devices add column if not exists source text;
