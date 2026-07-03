-- Per-firma integrasjonsinnstillinger (Ahlsell kundeavtale / GLN for EDI-routing).

create table if not exists public.company_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  ahlsell_customer_number text,
  ahlsell_gln text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.company_settings is
  'Integrasjonsfelt per firma (1:1 med companies). Brukes bl.a. til å route grossist-EDI til riktig tenant.';

comment on column public.company_settings.ahlsell_customer_number is
  'Ahlsell kundenummer fra avtalen — matcher Buyer/Kunde i pakkseddel.';

comment on column public.company_settings.ahlsell_gln is
  'GLN (13-siffer) for kjøper i EDI — matcher EndpointID / PartyIdentification.';

create unique index if not exists idx_company_settings_ahlsell_customer_number
  on public.company_settings (ahlsell_customer_number)
  where ahlsell_customer_number is not null and ahlsell_customer_number <> '';

create unique index if not exists idx_company_settings_ahlsell_gln
  on public.company_settings (ahlsell_gln)
  where ahlsell_gln is not null and ahlsell_gln <> '';

drop trigger if exists trg_company_settings_set_updated_at on public.company_settings;
create trigger trg_company_settings_set_updated_at
before update on public.company_settings
for each row
execute function public.set_updated_at();

alter table public.company_settings enable row level security;

drop policy if exists "company_settings_select_same_company" on public.company_settings;
create policy "company_settings_select_same_company"
on public.company_settings
for select
to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "company_settings_write_admin" on public.company_settings;
create policy "company_settings_write_admin"
on public.company_settings
for all
to authenticated
using (company_id = public.get_user_company_id() and public.is_company_admin())
with check (company_id = public.get_user_company_id() and public.is_company_admin());

grant select on public.company_settings to authenticated;
grant select, insert, update, delete on public.company_settings to authenticated;
