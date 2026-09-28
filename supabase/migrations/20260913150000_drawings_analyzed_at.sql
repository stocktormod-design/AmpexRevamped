-- Analysen ved første opplasting (2026-09-13): komponenter fra symbolforklaringen og rom
-- fra strekene kjøres én gang, på telefonen som laster opp. Stempelet hindrer dobbeltarbeid.
alter table public.drawings add column if not exists analyzed_at timestamptz;
