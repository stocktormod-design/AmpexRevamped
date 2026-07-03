-- Firmaprofil for PDF «Utarbeidet av», global unik 5-bokstavers ordrekode,
-- og arkivreferanse (PREFIX-YYYY-MM-XXXXXXX) ved arkivering.

alter table public.companies
  add column if not exists order_code_prefix text,
  add column if not exists firma_street text,
  add column if not exists firma_postnr text,
  add column if not exists firma_poststed text,
  add column if not exists firma_contact_name text,
  add column if not exists firma_phone text,
  add column if not exists firma_email text,
  add column if not exists elvirksomhet_id text;

comment on column public.companies.order_code_prefix is
  'Fem store bokstaver, globalt unikt på tvers av bedrifter (arkiv-/ordrenummer-prefix).';

alter table public.companies
  drop constraint if exists companies_order_code_prefix_format;

alter table public.companies
  add constraint companies_order_code_prefix_format
  check (order_code_prefix is null or order_code_prefix ~ '^[A-Z]{5}$');

create unique index if not exists companies_order_code_prefix_unique
  on public.companies (order_code_prefix)
  where order_code_prefix is not null;

alter table public.orders
  add column if not exists archive_reference text;

comment on column public.orders.archive_reference is
  'Fast arkivreferanse tildelt ved overgang til status archived (PREFIX-ÅÅÅÅ-MM-løpenummer).';

create unique index if not exists orders_archive_reference_unique
  on public.orders (archive_reference)
  where archive_reference is not null;

-- Per bedrift og kalendermåned (Europe/Oslo): atomisk løpenummer.
create table if not exists public.order_archive_counters (
  company_id uuid not null references public.companies (id) on delete cascade,
  ym text not null check (ym ~ '^\d{4}-\d{2}$'),
  last_serial integer not null default 0,
  primary key (company_id, ym)
);

alter table public.order_archive_counters enable row level security;

-- Ingen direkte brukertilgang; kun service_role / security definer.
drop policy if exists "order_archive_counters_deny_all" on public.order_archive_counters;
create policy "order_archive_counters_deny_all"
on public.order_archive_counters
for all
using (false)
with check (false);

create or replace function public.next_order_archive_reference(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_ym text;
  v_serial integer;
begin
  select nullif(upper(trim(c.order_code_prefix)), '') into v_prefix
  from public.companies c
  where c.id = p_company_id;

  if v_prefix is null or length(v_prefix) <> 5 then
    raise exception 'company_missing_order_code_prefix';
  end if;

  v_ym := to_char((timezone('Europe/Oslo', clock_timestamp()))::date, 'YYYY-MM');

  insert into public.order_archive_counters as c (company_id, ym, last_serial)
  values (p_company_id, v_ym, 1)
  on conflict (company_id, ym) do update
  set last_serial = public.order_archive_counters.last_serial + 1
  returning last_serial into v_serial;

  return v_prefix || '-' || v_ym || '-' || lpad(v_serial::text, 7, '0');
end;
$$;

revoke all on function public.next_order_archive_reference(uuid) from public;
grant execute on function public.next_order_archive_reference(uuid) to service_role;
