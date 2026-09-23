-- Felles varekatalog for hele Ampex (Tormod 2026-09-23: «prisfila VARENE
-- global i ampex, ikke prisene»). Se docs/GROSSIST_INTEGRASJON.md, «Grensa».
--
-- VAREN er lik for alle som kjøper den: el-nummer, navn, fabrikat, type, EAN,
-- NRF, enhet, pakning, bilde/FDV/HMS. Den ligger her ÉN gang, uten company_id,
-- og uten en eneste priskolonne. Prisen er firmaets egen og ligger i
-- product_prices (per firma, per grossist).
--
-- Kilden er grossistens STANDARD V4-fil, aldri en kundes P4 — samme regel som
-- telefonens katalogfil i R2 (tools/bygg-katalog.ts). Fylles av
-- tools/katalog-til-supabase.ts, som logger inn som Ampex-administrator.
--
-- Ikke i sync_tables: telefonen søker i katalogfila på disk (lib/katalog.ts).
-- Denne tabellen er for kontoret, som skriver rett mot Supabase (regel 2).

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.katalog_varer (
  elnummer      text primary key,
  navn          text not null,
  fabrikat      text,
  type          text,
  rabattgruppe  text,
  ean           text,
  nrf           text,
  enhet         text not null default 'stk',
  salgspakning  integer,
  lagerfort     boolean,
  -- Soft delete for en katalogvare: grossisten merker den utgått, vi sletter den aldri.
  utgaar        boolean not null default false,
  erstattes_av  text,
  bilde         text,
  fdv           text,
  hms           text,
  efobase       text,
  kategori      text,
  grossist      text not null,
  kilde_sha     text,
  search_text   text generated always as (
    lower(elnummer || ' ' || navn || ' ' || coalesce(fabrikat, '') || ' ' || coalesce(type, '') || ' ' || coalesce(ean, ''))
  ) stored,
  updated_at    timestamptz not null default now()
);

create index if not exists katalog_varer_sok on public.katalog_varer using gin (search_text extensions.gin_trgm_ops);
create index if not exists katalog_varer_ean on public.katalog_varer (ean) where ean is not null;

alter table public.katalog_varer enable row level security;

-- Alle innloggede kan lese: katalogen er ikke firmadata.
drop policy if exists katalog_varer_les on public.katalog_varer;
create policy katalog_varer_les on public.katalog_varer
  for select to authenticated using (true);

-- Bare Ampex skriver, og bare insert/update — aldri delete (regel 5).
drop policy if exists katalog_varer_ny on public.katalog_varer;
create policy katalog_varer_ny on public.katalog_varer
  for insert to authenticated with check (public.voice_er_ampex_admin());
drop policy if exists katalog_varer_endre on public.katalog_varer;
create policy katalog_varer_endre on public.katalog_varer
  for update to authenticated using (public.voice_er_ampex_admin()) with check (public.voice_er_ampex_admin());

grant select on public.katalog_varer to authenticated;
grant insert, update on public.katalog_varer to authenticated;
