-- AMPEX initial schema
-- Multi-tenant project, drawing, pin, and warehouse management

create extension if not exists "pgcrypto";

create type public.app_role as enum ('owner', 'admin', 'worker');
create type public.project_status as enum ('planning', 'active', 'completed');
create type public.pin_type as enum ('detector', 'cable', 'mcp', 'other');
create type public.pin_status as enum ('not_mounted', 'base_mounted', 'fully_mounted');

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_number text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  role public.app_role not null default 'worker',
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  description text,
  status public.project_status not null default 'planning',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists public.drawings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  file_path text not null,
  revision text,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.pins (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  x_position double precision not null check (x_position >= 0 and x_position <= 100),
  y_position double precision not null check (y_position >= 0 and y_position <= 100),
  tag_number text not null,
  type public.pin_type not null default 'other',
  address text,
  status public.pin_status not null default 'not_mounted',
  photo_path text,
  comment text,
  created_by uuid not null references public.profiles (id),
  updated_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  location text,
  created_at timestamptz not null default now()
);

create table if not exists public.warehouse_items (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  barcode text,
  name text not null,
  category text,
  quantity integer not null default 0,
  unit text not null default 'stk',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.item_scans (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_items (id) on delete cascade,
  scanned_by uuid not null references public.profiles (id),
  quantity_change integer not null,
  project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_company_id on public.profiles (company_id);
create index if not exists idx_projects_company_id on public.projects (company_id);
create index if not exists idx_project_assignments_project_id on public.project_assignments (project_id);
create index if not exists idx_project_assignments_user_id on public.project_assignments (user_id);
create index if not exists idx_drawings_project_id on public.drawings (project_id);
create index if not exists idx_pins_drawing_id on public.pins (drawing_id);
create index if not exists idx_warehouses_company_id on public.warehouses (company_id);
create index if not exists idx_warehouse_items_warehouse_id on public.warehouse_items (warehouse_id);
create index if not exists idx_item_scans_item_id on public.item_scans (item_id);
create index if not exists idx_item_scans_project_id on public.item_scans (project_id);

create or replace function public.get_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.is_company_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_admin()
        or exists (
          select 1
          from public.project_assignments pa
          where pa.project_id = p.id
            and pa.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pins_set_updated_at on public.pins;
create trigger trg_pins_set_updated_at
before update on public.pins
for each row
execute function public.set_updated_at();

drop trigger if exists trg_warehouse_items_set_updated_at on public.warehouse_items;
create trigger trg_warehouse_items_set_updated_at
before update on public.warehouse_items
for each row
execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_assignments enable row level security;
alter table public.drawings enable row level security;
alter table public.pins enable row level security;
alter table public.warehouses enable row level security;
alter table public.warehouse_items enable row level security;
alter table public.item_scans enable row level security;

create policy "companies_select_same_company"
on public.companies
for select
using (id = public.get_user_company_id());

create policy "companies_insert_owner_only"
on public.companies
for insert
with check (auth.uid() is not null);

create policy "companies_update_admin_only"
on public.companies
for update
using (id = public.get_user_company_id() and public.is_company_admin())
with check (id = public.get_user_company_id() and public.is_company_admin());

create policy "profiles_select_same_company"
on public.profiles
for select
using (company_id = public.get_user_company_id());

create policy "profiles_insert_self"
on public.profiles
for insert
with check (
  id = auth.uid()
  and (
    company_id = public.get_user_company_id()
    or public.get_user_company_id() is null
  )
);

create policy "profiles_update_admin_or_self"
on public.profiles
for update
using (
  (
    company_id = public.get_user_company_id()
    and (public.is_company_admin() or id = auth.uid())
  )
  or (
    id = auth.uid()
    and company_id is null
  )
)
with check (
  (
    company_id = public.get_user_company_id()
    and (public.is_company_admin() or id = auth.uid())
  )
  or (
    id = auth.uid()
    and public.get_user_company_id() is null
  )
);

create policy "projects_select_by_role"
on public.projects
for select
using (public.can_access_project(id));

create policy "projects_insert_admin_only"
on public.projects
for insert
with check (
  company_id = public.get_user_company_id()
  and public.is_company_admin()
);

create policy "projects_update_admin_only"
on public.projects
for update
using (
  company_id = public.get_user_company_id()
  and public.is_company_admin()
)
with check (
  company_id = public.get_user_company_id()
  and public.is_company_admin()
);

create policy "project_assignments_select_same_company"
on public.project_assignments
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.can_access_project(p.id)
  )
);

create policy "project_assignments_write_admin_only"
on public.project_assignments
for all
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_admin()
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_admin()
  )
);

create policy "drawings_select_by_project_access"
on public.drawings
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.can_access_project(p.id)
  )
);

create policy "drawings_insert_admin_only"
on public.drawings
for insert
with check (
  public.is_company_admin()
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
  )
);

create policy "drawings_update_admin_only"
on public.drawings
for update
using (
  public.is_company_admin()
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
  )
)
with check (
  public.is_company_admin()
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
  )
);

create policy "pins_select_by_project_access"
on public.pins
for select
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
  )
);

create policy "pins_insert_by_project_access"
on public.pins
for insert
with check (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
  )
);

create policy "pins_update_by_creator_or_admin"
on public.pins
for update
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
  )
  and (
    created_by = auth.uid()
    or public.is_company_admin()
  )
)
with check (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
  )
  and (
    created_by = auth.uid()
    or public.is_company_admin()
  )
);

create policy "warehouses_select_same_company"
on public.warehouses
for select
using (company_id = public.get_user_company_id());

create policy "warehouses_write_admin_only"
on public.warehouses
for all
using (company_id = public.get_user_company_id() and public.is_company_admin())
with check (company_id = public.get_user_company_id() and public.is_company_admin());

create policy "warehouse_items_select_same_company"
on public.warehouse_items
for select
using (
  exists (
    select 1
    from public.warehouses w
    where w.id = warehouse_id
      and w.company_id = public.get_user_company_id()
  )
);

create policy "warehouse_items_write_admin_only"
on public.warehouse_items
for all
using (
  public.is_company_admin()
  and exists (
    select 1
    from public.warehouses w
    where w.id = warehouse_id
      and w.company_id = public.get_user_company_id()
  )
)
with check (
  public.is_company_admin()
  and exists (
    select 1
    from public.warehouses w
    where w.id = warehouse_id
      and w.company_id = public.get_user_company_id()
  )
);

create policy "item_scans_select_same_company"
on public.item_scans
for select
using (
  exists (
    select 1
    from public.warehouse_items wi
    join public.warehouses w on w.id = wi.warehouse_id
    where wi.id = item_id
      and w.company_id = public.get_user_company_id()
  )
);

create policy "item_scans_insert_worker_or_admin"
on public.item_scans
for insert
with check (
  scanned_by = auth.uid()
  and exists (
    select 1
    from public.warehouse_items wi
    join public.warehouses w on w.id = wi.warehouse_id
    where wi.id = item_id
      and w.company_id = public.get_user_company_id()
  )
  and (
    public.is_company_admin()
    or (
      project_id is not null
      and public.can_access_project(project_id)
    )
  )
);

insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('pin-photos', 'pin-photos', false)
on conflict (id) do nothing;

create policy "drawings_bucket_select_same_company"
on storage.objects
for select
using (
  bucket_id = 'drawings'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

create policy "drawings_bucket_insert_admin_only"
on storage.objects
for insert
with check (
  bucket_id = 'drawings'
  and public.is_company_admin()
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

create policy "drawings_bucket_update_admin_only"
on storage.objects
for update
using (
  bucket_id = 'drawings'
  and public.is_company_admin()
  and split_part(name, '/', 1) = public.get_user_company_id()::text
)
with check (
  bucket_id = 'drawings'
  and public.is_company_admin()
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

create policy "drawings_bucket_delete_admin_only"
on storage.objects
for delete
using (
  bucket_id = 'drawings'
  and public.is_company_admin()
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

create policy "pin_photos_bucket_select_same_company"
on storage.objects
for select
using (
  bucket_id = 'pin-photos'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

create policy "pin_photos_bucket_insert_by_project_access"
on storage.objects
for insert
with check (
  bucket_id = 'pin-photos'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

create policy "pin_photos_bucket_update_by_project_access"
on storage.objects
for update
using (
  bucket_id = 'pin-photos'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
)
with check (
  bucket_id = 'pin-photos'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

create policy "pin_photos_bucket_delete_admin_or_owner"
on storage.objects
for delete
using (
  bucket_id = 'pin-photos'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
  and public.is_company_admin()
);
