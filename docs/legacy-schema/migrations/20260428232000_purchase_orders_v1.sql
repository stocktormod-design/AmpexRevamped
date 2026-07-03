-- Varebestilling v1 for Regnskap-siden.
-- Start med lokal produktkatalog (warehouse_items), og hold åpning for ekstern leverandør-API senere.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'purchase_order_status'
  ) then
    create type public.purchase_order_status as enum ('draft', 'sent', 'confirmed', 'received', 'cancelled');
  end if;
end $$;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  supplier_name text not null,
  status public.purchase_order_status not null default 'draft',
  notes text,
  created_by uuid not null references public.profiles (id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  warehouse_item_id uuid references public.warehouse_items (id) on delete set null,
  item_name text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit text not null default 'stk',
  supplier_sku text,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_orders_company_id
  on public.purchase_orders (company_id);

create index if not exists idx_purchase_orders_status
  on public.purchase_orders (status);

create index if not exists idx_purchase_order_lines_order_id
  on public.purchase_order_lines (purchase_order_id);

drop trigger if exists trg_purchase_orders_set_updated_at on public.purchase_orders;
create trigger trg_purchase_orders_set_updated_at
before update on public.purchase_orders
for each row
execute function public.set_updated_at();

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

drop policy if exists "purchase_orders_select_same_company" on public.purchase_orders;
create policy "purchase_orders_select_same_company"
on public.purchase_orders
for select
using (company_id = public.get_user_company_id());

drop policy if exists "purchase_orders_write_admin" on public.purchase_orders;
create policy "purchase_orders_write_admin"
on public.purchase_orders
for all
using (company_id = public.get_user_company_id() and public.is_company_admin())
with check (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "purchase_order_lines_select_same_company" on public.purchase_order_lines;
create policy "purchase_order_lines_select_same_company"
on public.purchase_order_lines
for select
using (
  exists (
    select 1
    from public.purchase_orders po
    where po.id = purchase_order_id
      and po.company_id = public.get_user_company_id()
  )
);

drop policy if exists "purchase_order_lines_write_admin" on public.purchase_order_lines;
create policy "purchase_order_lines_write_admin"
on public.purchase_order_lines
for all
using (
  public.is_company_admin()
  and exists (
    select 1
    from public.purchase_orders po
    where po.id = purchase_order_id
      and po.company_id = public.get_user_company_id()
  )
)
with check (
  public.is_company_admin()
  and exists (
    select 1
    from public.purchase_orders po
    where po.id = purchase_order_id
      and po.company_id = public.get_user_company_id()
  )
);

grant select on public.purchase_orders to authenticated;
grant select on public.purchase_order_lines to authenticated;

