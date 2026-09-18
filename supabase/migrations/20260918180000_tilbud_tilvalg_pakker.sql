-- Tilvalg, låst pris og pakker i tilbudet (2026-09-18).
-- Bakgrunnen står i docs/TILBUD_KONKURRENTER.md: Jobbers «optional line
-- items», Cordels «lås priser» og «pakker».

-- Tilvalg: kunden velger om linja skal med. is_selected betyr bare noe når
-- is_optional er sann; forhåndsvalgt = anbefalt (Jobber). Et fravalgt tilvalg
-- teller ikke i summen, men linja beholder prisen sin så kunden ser hva den
-- koster. Låst pris: «oppdater påslag» skal aldri kunne skrive over en pris
-- som er avtalt.
alter table public.quote_lines
  add column if not exists is_optional boolean not null default false,
  add column if not exists is_selected boolean not null default false,
  add column if not exists price_locked boolean not null default false;

-- Standard påslag på tilbudet, i prosent av kost. Brukes når en vare hentes
-- fra katalogen uten egen salgspris, og av «oppdater alle».
alter table public.quotes
  add column if not exists default_markup_percent numeric;

-- Pakker: «et sett av varer, timer og lignende som trengs for én mindre
-- oppgave» (Cordel). Kontorets register — ikke i sync_tables, appen trenger dem
-- ikke: kalkulasjonen lages på PC-en, telefonen viser resultatet.
create table public.quote_packages (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  name text not null default '',
  description text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger quote_packages_touch before update on public.quote_packages
  for each row execute function public.touch_updated_at();
create trigger quote_packages_audit after insert or update or delete on public.quote_packages
  for each row execute function public.audit_row();
create index quote_packages_company_idx on public.quote_packages (company_id) where deleted_at is null;
alter table public.quote_packages enable row level security;
create policy quote_packages_company_select on public.quote_packages
  for select using (company_id = public.current_company_id());
create policy quote_packages_company_insert on public.quote_packages
  for insert with check (company_id = public.current_company_id());
create policy quote_packages_company_update on public.quote_packages
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Linjene i en pakke. Mengden er PER PAKKE; når pakken settes inn ganges den
-- med antall pakker. Prisen er et snapshot slik pakken ble lagret — null betyr
-- «pris fra kost + tilbudets påslag når den settes inn».
create table public.quote_package_lines (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  package_id uuid not null references public.quote_packages (id),
  sort_order integer not null default 0,
  kind text not null default 'materiell',
  description text not null default '',
  elnummer text,
  product_id uuid references public.products (id),
  quantity numeric,
  unit text,
  unit_price numeric,
  cost_price numeric,
  vat_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger quote_package_lines_touch before update on public.quote_package_lines
  for each row execute function public.touch_updated_at();
create trigger quote_package_lines_audit after insert or update or delete on public.quote_package_lines
  for each row execute function public.audit_row();
create index quote_package_lines_package_idx on public.quote_package_lines (package_id) where deleted_at is null;
alter table public.quote_package_lines enable row level security;
create policy quote_package_lines_company_select on public.quote_package_lines
  for select using (company_id = public.current_company_id());
create policy quote_package_lines_company_insert on public.quote_package_lines
  for insert with check (company_id = public.current_company_id());
create policy quote_package_lines_company_update on public.quote_package_lines
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
