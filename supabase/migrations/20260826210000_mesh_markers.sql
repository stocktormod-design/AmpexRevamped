-- 3D-punkter på skann-GLB-er (mesh_markers) har hittil KUN levd lokalt på
-- enheten — mistet telefon = mistet dokumentasjon. Tabellen speiler WatermelonDB-
-- skjemaet (lib/db/schema.ts, mesh_markers) og kobles på den generiske synken
-- med én rad i sync_tables (mønsteret fra 20260819121000).
--
-- Punktene er bundet til en KONKRET skann-revisjon via scan_path (tekstnøkkel),
-- ikke bare rommet/ordren — rescan gir ny path og punktene følger den gamle.
create table public.mesh_markers (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  room_id uuid references public.rooms (id),
  order_scan_id uuid references public.order_scans (id),
  scan_path text not null,
  x double precision not null,
  y double precision not null,
  z double precision not null,
  symbol_id text not null,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger mesh_markers_touch before update on public.mesh_markers
  for each row execute function public.touch_updated_at();

create index mesh_markers_company_updated_idx on public.mesh_markers (company_id, updated_at);
create index mesh_markers_scan_path_idx on public.mesh_markers (scan_path) where deleted_at is null;

alter table public.mesh_markers enable row level security;

create policy mesh_markers_company_select on public.mesh_markers
  for select using (company_id = public.current_company_id());
create policy mesh_markers_company_insert on public.mesh_markers
  for insert with check (company_id = public.current_company_id());
create policy mesh_markers_company_update on public.mesh_markers
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
-- Ingen delete-policy: soft delete via deleted_at (regel #5)

-- push_order 35: etter rooms (25) og order_scans (30) som punktene refererer.
insert into public.sync_tables (table_name, push_order, no_update)
values ('mesh_markers', 35, '{}')
on conflict (table_name) do nothing;
