-- Teorispørsmål (2026-09-27): øving på Ohms lov, vern, jording … som ikke hører
-- til en logg. Se lib/laeretid/teori.ts.
alter table public.laeretid_sporsmaal alter column logg_id drop not null;
alter table public.laeretid_sporsmaal add column if not exists tema text;
alter table public.laeretid_sporsmaal drop constraint if exists laeretid_sporsmaal_logg_eller_tema;
alter table public.laeretid_sporsmaal add constraint laeretid_sporsmaal_logg_eller_tema
  check (logg_id is not null or tema is not null);
