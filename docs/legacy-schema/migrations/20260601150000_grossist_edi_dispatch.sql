-- EDI / EHF pakksedler fra grossister (Ahlsell m.fl.)

do $$
begin
  create type public.incoming_dispatch_status as enum ('received', 'processed', 'failed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.incoming_dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete set null,
  grossist_navn text not null,
  pakkseddel_nummer text not null,
  prosjekt_referanse text,
  order_id uuid references public.orders (id) on delete set null,
  status public.incoming_dispatch_status not null default 'received',
  raw_payload jsonb not null default '{}'::jsonb,
  error_message text,
  line_count integer not null default 0 check (line_count >= 0),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint incoming_dispatches_grossist_pakkseddel_unique
    unique (grossist_navn, pakkseddel_nummer)
);

comment on table public.incoming_dispatches is
  'Audit-logg for mottatte EHF/EDI pakksedler (Despatch Advice) fra grossist.';

create index if not exists idx_incoming_dispatches_company_id
  on public.incoming_dispatches (company_id);

create index if not exists idx_incoming_dispatches_order_id
  on public.incoming_dispatches (order_id);

create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  supplier text not null,
  elnummer text not null,
  artikkel_navn text not null,
  netto_innkopspris numeric(14, 4) not null check (netto_innkopspris >= 0),
  product_id uuid references public.products (id) on delete set null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_products_company_supplier_elnummer_unique
    unique (company_id, supplier, elnummer)
);

comment on table public.supplier_products is
  'Grossistens varelinjer per firma (elnummer + siste innkjøpspris fra EDI).';

create index if not exists idx_supplier_products_company_supplier
  on public.supplier_products (company_id, supplier);

create index if not exists idx_supplier_products_elnummer
  on public.supplier_products (elnummer);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  supplier_product_id uuid references public.supplier_products (id) on delete set null,
  incoming_dispatch_id uuid references public.incoming_dispatches (id) on delete set null,
  elnummer text not null,
  artikkel_navn text not null,
  antall numeric(14, 4) not null check (antall > 0),
  netto_innkopspris numeric(14, 4) not null check (netto_innkopspris >= 0),
  sale_price numeric(14, 4) not null check (sale_price >= 0),
  added_by_edi boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_items_order_elnummer_unique unique (order_id, elnummer)
);

comment on table public.order_items is
  'Ordrelinjer (varer) med pris; EDI-linjer har added_by_edi = true.';

create index if not exists idx_order_items_order_id on public.order_items (order_id);
create index if not exists idx_order_items_company_id on public.order_items (company_id);

drop trigger if exists trg_supplier_products_set_updated_at on public.supplier_products;
create trigger trg_supplier_products_set_updated_at
before update on public.supplier_products
for each row
execute function public.set_updated_at();

drop trigger if exists trg_order_items_set_updated_at on public.order_items;
create trigger trg_order_items_set_updated_at
before update on public.order_items
for each row
execute function public.set_updated_at();

alter table public.incoming_dispatches enable row level security;
alter table public.supplier_products enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "incoming_dispatches_select_same_company" on public.incoming_dispatches;
create policy "incoming_dispatches_select_same_company"
on public.incoming_dispatches
for select
to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "supplier_products_select_same_company" on public.supplier_products;
create policy "supplier_products_select_same_company"
on public.supplier_products
for select
to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "order_items_select_same_company" on public.order_items;
create policy "order_items_select_same_company"
on public.order_items
for select
to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "order_items_write_same_company" on public.order_items;
create policy "order_items_write_same_company"
on public.order_items
for all
to authenticated
using (company_id = public.get_user_company_id() and public.is_company_admin())
with check (company_id = public.get_user_company_id() and public.is_company_admin());

grant select on public.incoming_dispatches to authenticated;
grant select on public.supplier_products to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;
