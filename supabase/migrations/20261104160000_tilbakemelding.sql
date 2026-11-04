-- Tilbakemeldinger fra appen (2026-11-04). Alle innloggede kan sende sin egen;
-- bare Ampex-admins (ampex_admins) leser og setter status — fra kontorappens Ampex-flate.
create table if not exists public.tilbakemelding (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid,
  type text not null check (type in ('feil', 'forslag', 'ros')),
  vurdering smallint check (vurdering between 1 and 5),
  tekst text not null check (char_length(tekst) between 1 and 8000),
  rute text,
  ruter jsonb,
  app_versjon text,
  bygg text,
  plattform text,
  os text,
  modell text,
  ram_mb int,
  ledig_disk_mb int,
  ekstra jsonb,
  status text not null default 'ny' check (status in ('ny', 'sett', 'fikset', 'avvist')),
  constraint tilbakemelding_storrelse check (coalesce(pg_column_size(ruter), 0) < 20000 and coalesce(pg_column_size(ekstra), 0) < 20000)
);
create index if not exists tilbakemelding_created_idx on public.tilbakemelding (created_at desc);
alter table public.tilbakemelding enable row level security;
drop policy if exists tilbakemelding_insert_self on public.tilbakemelding;
create policy tilbakemelding_insert_self on public.tilbakemelding
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists tilbakemelding_admin_select on public.tilbakemelding;
create policy tilbakemelding_admin_select on public.tilbakemelding
  for select to authenticated using (exists (select 1 from public.ampex_admins a where a.user_id = auth.uid()));
drop policy if exists tilbakemelding_admin_update on public.tilbakemelding;
create policy tilbakemelding_admin_update on public.tilbakemelding
  for update to authenticated using (exists (select 1 from public.ampex_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.ampex_admins a where a.user_id = auth.uid()));
revoke delete on public.tilbakemelding from anon, authenticated;
grant select, insert, update on public.tilbakemelding to authenticated;

create or replace function public.tilbakemeldinger_admin(grense int default 300)
returns table (
  id uuid, created_at timestamptz, type text, vurdering smallint, tekst text, rute text, ruter jsonb,
  app_versjon text, bygg text, plattform text, os text, modell text, ram_mb int, ledig_disk_mb int,
  ekstra jsonb, status text, navn text, epost text, firma text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.created_at, t.type, t.vurdering, t.tekst, t.rute, t.ruter,
         t.app_versjon, t.bygg, t.plattform, t.os, t.modell, t.ram_mb, t.ledig_disk_mb,
         t.ekstra, t.status, p.full_name, u.email::text, c.name
  from public.tilbakemelding t
  join auth.users u on u.id = t.user_id
  left join public.profiles p on p.id = t.user_id
  left join public.companies c on c.id = t.company_id
  where exists (select 1 from public.ampex_admins a where a.user_id = auth.uid())
  order by t.created_at desc
  limit grense
$$;
revoke all on function public.tilbakemeldinger_admin(int) from public, anon;
grant execute on function public.tilbakemeldinger_admin(int) to authenticated;
