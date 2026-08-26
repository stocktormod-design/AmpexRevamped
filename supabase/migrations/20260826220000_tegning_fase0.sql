-- Tegning multiview fase 0 (docs/TEGNING_MULTIVIEW_PLAN.md).
--
-- MERK: tasks trengte INGENTING her — liva-DB-en hadde allerede beskrivelse,
-- frist_at, drawing_id, pin_x, pin_y, synlighet (fil-løs migrasjon; klienten
-- speiler dem først nå, WatermelonDB v32). task_mottakere finnes også allerede.
--
-- 1) fire_devices: KUN brannkomponenter bærer registerdata (tag `sløyfe.adresse`,
--    serienummer, modell) — andre symboler er rene tegneelementer i drawing_loops.
--    Detektorlista genereres fra denne tabellen.
create table public.fire_devices (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  project_id uuid not null references public.projects (id),
  drawing_id uuid references public.drawings (id),
  room_id uuid references public.rooms (id),
  loop_id uuid references public.drawing_loops (id),
  x double precision not null,
  y double precision not null,
  kind text not null default 'royk'
    check (kind in ('royk', 'varme', 'multi', 'melder', 'klokke', 'sirene', 'sentral', 'annet')),
  tag text not null default '',
  serial text,
  model text,
  placed_at timestamptz,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger fire_devices_touch before update on public.fire_devices
  for each row execute function public.touch_updated_at();

create index fire_devices_company_updated_idx on public.fire_devices (company_id, updated_at);
create index fire_devices_project_idx on public.fire_devices (project_id) where deleted_at is null;
create index fire_devices_drawing_idx on public.fire_devices (drawing_id) where deleted_at is null;

alter table public.fire_devices enable row level security;

create policy fire_devices_company_select on public.fire_devices
  for select using (company_id = public.current_company_id());
create policy fire_devices_company_insert on public.fire_devices
  for insert with check (company_id = public.current_company_id());
create policy fire_devices_company_update on public.fire_devices
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
-- Ingen delete-policy: soft delete via deleted_at (regel #5)

-- push_order 35: etter drawings (20), rooms (25) og drawing_loops (30).
insert into public.sync_tables (table_name, push_order, no_update)
values ('fire_devices', 35, '{}')
on conflict (table_name) do nothing;

-- 2) drawing_markup: fra én blob-rad per tegning til RADER (én per publiserings-
--    økt). kind skiller innholdstyper fremover; created_by fantes allerede.
--    Gamle blob-rader forblir gyldige ('stroke') — leseveien tåler begge.
alter table public.drawing_markup
  add column if not exists kind text not null default 'stroke';

-- 3) drawings.source: 'lokal' (vi utsteder revisjoner) | 'ekstern' (publisert
--    fra Dalux e.l., grunntegning skrivebeskyttet). As-built er alltid et lokalt
--    lag oppå grunntegningen uansett kilde (roadmap-prinsippet).
alter table public.drawings
  add column if not exists source text not null default 'lokal'
    check (source in ('lokal', 'ekstern'));
