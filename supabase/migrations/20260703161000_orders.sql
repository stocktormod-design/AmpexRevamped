-- Ordre — navet i appen. Følger synk-konvensjonen fra foundation-migrasjonen.

create type public.order_status as enum
  ('mottatt', 'planlagt', 'pagaar', 'fakturaklar', 'fakturert');

create table public.orders (
  id uuid primary key,  -- klient-generert (WatermelonDB)
  company_id uuid not null references public.companies (id),
  order_number int,     -- settes av trigger per firma
  title text not null,
  description text,
  customer_name text,
  customer_phone text,
  address text,
  status public.order_status not null default 'mottatt',
  assigned_to uuid references public.profiles (id),
  scheduled_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, order_number)
);

create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- Løpenummer per firma. Advisory lock hindrer duplikat ved samtidige insert
-- (offline-kø kan pushe flere ordre i samme sekund).
create or replace function public.assign_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null then
    perform pg_advisory_xact_lock(hashtext('order_number:' || new.company_id::text));
    select coalesce(max(order_number), 0) + 1
      into new.order_number
      from public.orders
     where company_id = new.company_id;
  end if;
  return new;
end $$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.assign_order_number();

-- Pull-spørringen er "alt i mitt firma endret etter X" — dekkes av denne:
create index orders_company_updated_idx on public.orders (company_id, updated_at);
create index orders_company_status_idx on public.orders (company_id, status)
  where deleted_at is null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.orders enable row level security;

create policy orders_company_select on public.orders
  for select using (company_id = public.current_company_id());

create policy orders_company_insert on public.orders
  for insert with check (company_id = public.current_company_id());

create policy orders_company_update on public.orders
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Ingen delete-policy: soft delete via deleted_at (regel #5)
