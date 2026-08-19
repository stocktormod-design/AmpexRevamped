-- Tilleggsarbeid. Håndverkertjenesteloven §9 krever at forbrukeren kontaktes før
-- tillegg utføres; blir det bestridt i ettertid er det HVEM som sa ja, NÅR og
-- HVORDAN som avgjør. Derfor er godkjenningen egne kolonner, ikke fritekst.
--
-- Merk siste linje: å koble tabellen på synken er ÉN rad i sync_tables. Det er
-- hele gevinsten ved det registerdrevne oppsettet fra 20260819121000.
create table public.order_extras (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  order_id uuid not null references public.orders (id),
  title text not null default '',
  description text,
  -- fastpris → egen fakturalinje. medgatt → dekkes av timer og materiell som
  -- allerede føres på ordren; raden er da ren dokumentasjon.
  pricing text not null default 'medgatt' check (pricing in ('fastpris', 'medgatt')),
  price numeric(12, 2),
  vat_type text,
  status text not null default 'foreslatt' check (status in ('foreslatt', 'godkjent', 'avvist')),
  approved_by text,
  approved_at timestamptz,
  approval_method text check (approval_method in ('muntlig', 'sms', 'epost', 'signert')),
  invoiced_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger order_extras_touch before update on public.order_extras
  for each row execute function public.touch_updated_at();

create index order_extras_company_updated_idx on public.order_extras (company_id, updated_at);
create index order_extras_order_idx on public.order_extras (order_id) where deleted_at is null;

alter table public.order_extras enable row level security;

create policy order_extras_company_select on public.order_extras
  for select using (company_id = public.current_company_id());
create policy order_extras_company_insert on public.order_extras
  for insert with check (company_id = public.current_company_id());
create policy order_extras_company_update on public.order_extras
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
-- Ingen delete-policy: soft delete via deleted_at (regel #5)

insert into public.sync_tables (table_name, push_order, no_update)
values ('order_extras', 30, '{}')
on conflict (table_name) do nothing;
