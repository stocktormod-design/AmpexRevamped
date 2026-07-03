-- Orders MVP: customers, orders, risk/documentation, hours/materials, installer inbox

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
  ) then
    create type public.app_role as enum ('owner', 'admin', 'installator', 'montor', 'apprentice');
  elsif not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'installator'
  ) then
    alter type public.app_role add value 'installator';
  end if;
end $$;

do $$
begin
  create type public.order_type as enum ('bolig', 'maritim', 'kompleks');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_status as enum (
    'active',
    'finished',
    'archived',
    'awaiting_installer',
    'approved',
    'rejected'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.installer_inbox_status as enum ('pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.order_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  maps_query text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  customer_id uuid not null references public.order_customers (id) on delete restrict,
  title text not null,
  description text,
  type public.order_type not null,
  status public.order_status not null default 'active',
  created_by uuid not null references public.profiles (id),
  assigned_installer_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_risk_assessments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  template_type public.order_type not null,
  payload jsonb not null default '{}'::jsonb,
  is_completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id)
);

create table if not exists public.order_documentation (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  section_key text not null,
  template_type public.order_type not null,
  payload jsonb not null default '{}'::jsonb,
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, section_key)
);

create table if not exists public.order_hours (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  work_date date not null,
  minutes integer not null check (minutes > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_materials (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  warehouse_item_id uuid references public.warehouse_items (id) on delete set null,
  name text not null,
  unit text not null default 'stk',
  quantity numeric(12, 2) not null check (quantity > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.installer_inbox_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  installer_user_id uuid not null references public.profiles (id) on delete cascade,
  status public.installer_inbox_status not null default 'pending',
  submitted_by uuid not null references public.profiles (id),
  submitted_at timestamptz not null default now(),
  decision_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_installer_inbox_pending_unique
  on public.installer_inbox_items (order_id, installer_user_id)
  where status = 'pending';

create index if not exists idx_order_customers_company_id on public.order_customers (company_id);
create index if not exists idx_orders_company_id on public.orders (company_id);
create index if not exists idx_orders_customer_id on public.orders (customer_id);
create index if not exists idx_orders_assigned_installer_id on public.orders (assigned_installer_id);
create index if not exists idx_order_risk_assessments_order_id on public.order_risk_assessments (order_id);
create index if not exists idx_order_documentation_order_id on public.order_documentation (order_id);
create index if not exists idx_order_hours_order_id on public.order_hours (order_id);
create index if not exists idx_order_materials_order_id on public.order_materials (order_id);
create index if not exists idx_installer_inbox_installer_id on public.installer_inbox_items (installer_user_id);

create or replace function public.is_installator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.company_id = public.get_user_company_id()
      and p.role::text = 'installator'
  );
$$;

create or replace function public.is_order_risk_completed(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.order_risk_assessments r
    where r.order_id = target_order_id
      and r.is_completed = true
  );
$$;

drop trigger if exists trg_order_customers_set_updated_at on public.order_customers;
create trigger trg_order_customers_set_updated_at
before update on public.order_customers
for each row
execute function public.set_updated_at();

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

drop trigger if exists trg_order_risk_assessments_set_updated_at on public.order_risk_assessments;
create trigger trg_order_risk_assessments_set_updated_at
before update on public.order_risk_assessments
for each row
execute function public.set_updated_at();

drop trigger if exists trg_order_documentation_set_updated_at on public.order_documentation;
create trigger trg_order_documentation_set_updated_at
before update on public.order_documentation
for each row
execute function public.set_updated_at();

drop trigger if exists trg_order_hours_set_updated_at on public.order_hours;
create trigger trg_order_hours_set_updated_at
before update on public.order_hours
for each row
execute function public.set_updated_at();

drop trigger if exists trg_order_materials_set_updated_at on public.order_materials;
create trigger trg_order_materials_set_updated_at
before update on public.order_materials
for each row
execute function public.set_updated_at();

drop trigger if exists trg_installer_inbox_items_set_updated_at on public.installer_inbox_items;
create trigger trg_installer_inbox_items_set_updated_at
before update on public.installer_inbox_items
for each row
execute function public.set_updated_at();

alter table public.order_customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_risk_assessments enable row level security;
alter table public.order_documentation enable row level security;
alter table public.order_hours enable row level security;
alter table public.order_materials enable row level security;
alter table public.installer_inbox_items enable row level security;

drop policy if exists "order_customers_select" on public.order_customers;
create policy "order_customers_select"
on public.order_customers for select
using (company_id = public.get_user_company_id());

drop policy if exists "order_customers_insert" on public.order_customers;
create policy "order_customers_insert"
on public.order_customers for insert
with check (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "order_customers_update" on public.order_customers;
create policy "order_customers_update"
on public.order_customers for update
using (company_id = public.get_user_company_id() and public.is_company_admin())
with check (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "orders_select" on public.orders;
create policy "orders_select"
on public.orders for select
using (company_id = public.get_user_company_id());

drop policy if exists "orders_insert" on public.orders;
create policy "orders_insert"
on public.orders for insert
with check (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_update_admin"
on public.orders for update
using (company_id = public.get_user_company_id() and public.is_company_admin())
with check (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "orders_update_installator_assigned" on public.orders;
create policy "orders_update_installator_assigned"
on public.orders for update
using (
  company_id = public.get_user_company_id()
  and assigned_installer_id = auth.uid()
  and public.is_installator()
)
with check (
  company_id = public.get_user_company_id()
  and assigned_installer_id = auth.uid()
  and public.is_installator()
);

drop policy if exists "order_risk_select" on public.order_risk_assessments;
create policy "order_risk_select"
on public.order_risk_assessments for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "order_risk_write_admin" on public.order_risk_assessments;
create policy "order_risk_write_admin"
on public.order_risk_assessments for all
using (
  public.is_company_admin()
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
)
with check (
  public.is_company_admin()
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "order_docs_select" on public.order_documentation;
create policy "order_docs_select"
on public.order_documentation for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "order_docs_write_admin_with_risk" on public.order_documentation;
create policy "order_docs_write_admin_with_risk"
on public.order_documentation for all
using (
  public.is_company_admin()
  and public.is_order_risk_completed(order_id)
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
)
with check (
  public.is_company_admin()
  and public.is_order_risk_completed(order_id)
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "order_hours_select" on public.order_hours;
create policy "order_hours_select"
on public.order_hours for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "order_hours_write_admin_with_risk" on public.order_hours;
create policy "order_hours_write_admin_with_risk"
on public.order_hours for all
using (
  public.is_company_admin()
  and public.is_order_risk_completed(order_id)
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
)
with check (
  public.is_company_admin()
  and public.is_order_risk_completed(order_id)
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "order_materials_select" on public.order_materials;
create policy "order_materials_select"
on public.order_materials for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "order_materials_write_admin_with_risk" on public.order_materials;
create policy "order_materials_write_admin_with_risk"
on public.order_materials for all
using (
  public.is_company_admin()
  and public.is_order_risk_completed(order_id)
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
)
with check (
  public.is_company_admin()
  and public.is_order_risk_completed(order_id)
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "installer_inbox_select" on public.installer_inbox_items;
create policy "installer_inbox_select"
on public.installer_inbox_items for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
  and (public.is_company_admin() or installer_user_id = auth.uid())
);

drop policy if exists "installer_inbox_insert_admin" on public.installer_inbox_items;
create policy "installer_inbox_insert_admin"
on public.installer_inbox_items for insert
with check (
  public.is_company_admin()
  and exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
);

drop policy if exists "installer_inbox_update_admin_or_assigned" on public.installer_inbox_items;
create policy "installer_inbox_update_admin_or_assigned"
on public.installer_inbox_items for update
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
  and (
    public.is_company_admin()
    or (installer_user_id = auth.uid() and public.is_installator())
  )
)
with check (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.company_id = public.get_user_company_id()
  )
  and (
    public.is_company_admin()
    or (installer_user_id = auth.uid() and public.is_installator())
  )
);
