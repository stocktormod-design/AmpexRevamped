-- Ordresystemet fullføres server-side.
--
-- Databasen synket allerede 17 tabeller. Men `time_entries` og `order_members`
-- fantes ikke i Postgres i det hele tatt — timene lå kun i SQLite på én telefon,
-- og forsvant med telefonen. Kunder og aktiviteter er nye (skjema v22).
--
-- Kolonnene som legges til på eksisterende tabeller er de fakturagrunnlaget
-- trenger: pris, MVA og kunde-ID.

-- ── Kunder ───────────────────────────────────────────────────────────────────
-- Både Fiken og Tripletex krever en kunde med ID for å motta en faktura.
create table public.customers (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  name text not null default '',
  org_nr text,
  is_company boolean not null default false,
  email text,
  phone text,
  address text,
  postal_code text,
  city text,
  note text,
  -- Er kunden hentet fra regnskapet, eier regnskapet navnet. Vi speiler.
  source_system text,
  external_id text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── Aktiviteter ──────────────────────────────────────────────────────────────
-- Timer uten aktivitet har ingen pris. Begge regnskapssystemene modellerer
-- timer som aktivitet × person × dato.
create table public.activities (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  name text not null default '',
  hourly_rate numeric(12, 2),
  billable boolean not null default true,
  vat_type text,
  archived boolean not null default false,
  source_system text,
  external_id text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── Timer ────────────────────────────────────────────────────────────────────
create table public.time_entries (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  order_id uuid not null references public.orders (id),
  user_id uuid not null references public.profiles (id),
  user_name text not null default '',   -- snapshot, så navn vises offline
  date timestamptz not null default now(),
  hours numeric(8, 2) not null default 0,
  note text,            -- SYNLIG på faktura
  internal_note text,   -- aldri på faktura
  activity_id uuid references public.activities (id),
  billable boolean,     -- null = arv fra aktiviteten
  invoiced_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── Deltakere på ordre ───────────────────────────────────────────────────────
-- Styrer hvem som kan føre timer på ordren.
create table public.order_members (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  order_id uuid not null references public.orders (id),
  user_id uuid not null references public.profiles (id),
  user_name text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── Nye kolonner på eksisterende tabeller ────────────────────────────────────
alter table public.orders
  add column if not exists customer_id uuid references public.customers (id),
  add column if not exists source_system text,
  add column if not exists external_id text,
  add column if not exists invoice_external_id text,
  add column if not exists invoiced_at timestamptz;

-- Fiken krever unitPrice + vatType + incomeAccount for å opprette en vare.
-- cost_price er nettoprisen fra grossistens prisfil; differansen ER
-- dekningsbidraget, og er hele poenget med prisimporten.
alter table public.products
  add column if not exists unit_price numeric(12, 2),
  add column if not exists cost_price numeric(12, 2),
  add column if not exists vat_type text,
  add column if not exists income_account text,
  add column if not exists supplier text,
  add column if not exists price_updated_at timestamptz,
  add column if not exists source_system text,
  add column if not exists external_id text;

-- Pris-snapshot: varen kan prises om i morgen, men en utført ordre skal ikke
-- endre beløp av seg selv.
alter table public.order_materials
  add column if not exists product_id uuid references public.products (id),
  add column if not exists unit_price numeric(12, 2),
  add column if not exists cost_price numeric(12, 2),
  add column if not exists vat_type text,
  add column if not exists billable boolean,
  add column if not exists invoiced_at timestamptz;

-- Fantes lokalt, men ikke på serveren — sporing av hva AI-en fylte ut gikk tapt
-- ved hver synk.
alter table public.order_documents
  add column if not exists ai_field_origin text;

alter table public.locations
  add column if not exists reg_nr text,
  add column if not exists tracker_imei text;

-- ── Triggere, indekser, RLS ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['customers', 'activities', 'time_entries', 'order_members'] loop
    execute format(
      'create trigger %1$I_touch before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
    -- Pull-spørringen er alltid «alt i mitt firma endret etter X».
    execute format(
      'create index %1$I_company_updated_idx on public.%1$I (company_id, updated_at)', t);
    execute format('alter table public.%1$I enable row level security', t);
    execute format(
      'create policy %1$I_company_select on public.%1$I
       for select using (company_id = public.current_company_id())', t);
    execute format(
      'create policy %1$I_company_insert on public.%1$I
       for insert with check (company_id = public.current_company_id())', t);
    execute format(
      'create policy %1$I_company_update on public.%1$I
       for update using (company_id = public.current_company_id())
       with check (company_id = public.current_company_id())', t);
    -- Ingen delete-policy: soft delete via deleted_at (regel #5)
  end loop;
end $$;

create index time_entries_order_idx on public.time_entries (order_id) where deleted_at is null;
create index time_entries_user_date_idx on public.time_entries (user_id, date) where deleted_at is null;
create index order_members_order_idx on public.order_members (order_id) where deleted_at is null;
create index customers_company_name_idx on public.customers (company_id, name) where deleted_at is null;
create index orders_customer_idx on public.orders (customer_id) where deleted_at is null;

-- El-nummer er join-nøkkelen på tvers av grossister — men bare innenfor ett firma.
create unique index if not exists products_company_elnummer_idx
  on public.products (company_id, elnummer)
  where elnummer is not null and deleted_at is null;
