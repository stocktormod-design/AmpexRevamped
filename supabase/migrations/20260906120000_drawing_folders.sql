-- Mapper for tegninger (2026-09-06): bygg → fag → tegninger. Nestet via parent_id.
-- Tormod: «hvis du har forskjellige bygg så burde du kunne lage mapper for dem,
-- så inne der burde du kunne lage mapper, som f.eks elkraft ikt adgang osv.»
create table public.drawing_folders (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  project_id uuid not null references public.projects (id),
  parent_id uuid references public.drawing_folders (id),
  name text not null default '',
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger drawing_folders_touch before update on public.drawing_folders
  for each row execute function public.touch_updated_at();
create index drawing_folders_company_updated_idx on public.drawing_folders (company_id, updated_at);
create index drawing_folders_project_idx on public.drawing_folders (project_id) where deleted_at is null;
create index drawing_folders_parent_idx on public.drawing_folders (parent_id) where deleted_at is null;
alter table public.drawing_folders enable row level security;
create policy drawing_folders_company_select on public.drawing_folders
  for select using (company_id = public.current_company_id());
create policy drawing_folders_company_insert on public.drawing_folders
  for insert with check (company_id = public.current_company_id());
create policy drawing_folders_company_update on public.drawing_folders
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
-- push_order 15: FØR drawings (20), som peker hit.
insert into public.sync_tables (table_name, push_order, no_update)
values ('drawing_folders', 15, '{}')
on conflict (table_name) do nothing;
alter table public.drawings add column if not exists folder_id uuid references public.drawing_folders (id);
create index if not exists drawings_folder_idx on public.drawings (folder_id) where deleted_at is null;
