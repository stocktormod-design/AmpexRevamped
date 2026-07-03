-- Min/maks forbruksvarer (auto-påfyll ved ordreforbruk).

create table if not exists public.inventory_thresholds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  elnummer text not null,
  product_name text not null,
  current_stock integer not null default 0,
  min_threshold integer not null default 20,
  order_up_to integer not null default 40,
  is_auto_order boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_thresholds_company_elnummer_unique unique (company_id, elnummer),
  constraint inventory_thresholds_min_lte_max check (min_threshold <= order_up_to),
  constraint inventory_thresholds_min_positive check (min_threshold >= 0),
  constraint inventory_thresholds_max_positive check (order_up_to > 0)
);

comment on table public.inventory_thresholds is
  'Forbruksvarer per firma: min (trigger) og order_up_to (mål) for auto-bestilling.';

create index if not exists idx_inventory_thresholds_company_id
  on public.inventory_thresholds (company_id);

create index if not exists idx_inventory_thresholds_elnummer
  on public.inventory_thresholds (elnummer);

create table if not exists public.auto_orders_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  elnummer text not null,
  quantity integer not null check (quantity > 0),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint auto_orders_log_status_check
    check (status in ('pending', 'sent', 'cancelled'))
);

comment on table public.auto_orders_log is
  'Logg over auto-genererte påfyllingsbestillinger til grossist.';

create index if not exists idx_auto_orders_log_company_id
  on public.auto_orders_log (company_id);

create index if not exists idx_auto_orders_log_created_at
  on public.auto_orders_log (created_at desc);

drop trigger if exists trg_inventory_thresholds_set_updated_at on public.inventory_thresholds;
create trigger trg_inventory_thresholds_set_updated_at
before update on public.inventory_thresholds
for each row
execute function public.set_updated_at();

alter table public.inventory_thresholds enable row level security;
alter table public.auto_orders_log enable row level security;

drop policy if exists "inventory_thresholds_select_same_company" on public.inventory_thresholds;
create policy "inventory_thresholds_select_same_company"
on public.inventory_thresholds
for select
to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "inventory_thresholds_write_admin" on public.inventory_thresholds;
create policy "inventory_thresholds_write_admin"
on public.inventory_thresholds
for all
to authenticated
using (company_id = public.get_user_company_id() and public.is_company_admin())
with check (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "auto_orders_log_select_same_company" on public.auto_orders_log;
create policy "auto_orders_log_select_same_company"
on public.auto_orders_log
for select
to authenticated
using (company_id = public.get_user_company_id());

grant select on public.inventory_thresholds to authenticated;
grant select, insert, update, delete on public.inventory_thresholds to authenticated;
grant select on public.auto_orders_log to authenticated;
