-- Koblingen mellom en ordre og firmaets regnskapssystem.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvor tokenene bor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- I Vault, kryptert på disk — aldri i en vanlig kolonne. Nøyaktig samme
-- begrunnelse og navnemønster som `ai_company_keys` fra 20260811190000: en
-- nøkkel som kan leses av en RLS-scopet spørring er en nøkkel som lekker den
-- dagen en policy skrives feil.
--
-- Og her er innsatsen høyere enn for AI-nøkkelen. En `employeeToken` i
-- Tripletex gir tilgang til HELE regnskapet — bilag, lønn, kunder, historikk.
-- Den skal ikke kunne hentes ut av noen klient, uansett rolle.
--
-- Navn: `regnskap_<navn>_<company_id>`, der `<navn>` er én av
--   tripletex_consumer   consumerToken fra API 2.0-registreringen
--   tripletex_employee   firmaets eget ansatt-token
--   fiken_token          personlig API-token eller OAuth access token
--   fiken_slug           firmaslug, f.eks. «elektro-as1» (ikke hemmelig, men
--                        hører sammen med tokenet og lagres samme sted)
--
-- Det finnes ingen selvbetjent skjerm for å sette dem ennå. De settes fra
-- SQL-editoren, én gang per firma:
--
--   select public.set_company_regnskap_token(
--     '<company_id>', 'tripletex_employee', '<token>');
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvorfor ingen ny tabell for koblingen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `customers.external_id` og `orders.invoice_external_id` finnes fra før, og de
-- er de riktige stedene. En egen koblingstabell ville betydd to steder som
-- begge påstår å vite hvilken kunde i Tripletex som er vår — og når de spriker,
-- går fakturaen til feil part.
--
-- `source_system` sier HVILKET system ID-en gjelder i. Uten den ville en
-- overgang fra Fiken til Tripletex etterlatt IDer som peker på ingenting, og
-- det ville ikke synes før noen forsøkte å fakturere.
--
-- Tilbakerulling: se nederst.

create extension if not exists supabase_vault;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tokenene
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_company_regnskap_token(p_company_id uuid, p_navn text)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'regnskap_' || p_navn || '_' || p_company_id::text
  limit 1
$$;

-- Kun service_role — altså Edge Functionen. Aldri anon eller authenticated:
-- en klient som kan kalle denne kan sonde etter om et token finnes, og det er
-- allerede for mye.
revoke execute on function public.get_company_regnskap_token(uuid, text) from public, anon, authenticated;
grant execute on function public.get_company_regnskap_token(uuid, text) to service_role;

create or replace function public.set_company_regnskap_token(p_company_id uuid, p_navn text, p_verdi text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  _name text := 'regnskap_' || p_navn || '_' || p_company_id::text;
  _existing uuid;
begin
  if p_navn not in ('tripletex_consumer', 'tripletex_employee', 'fiken_token', 'fiken_slug') then
    raise exception 'Ukjent tokennavn: %', p_navn;
  end if;

  select id into _existing from vault.secrets where name = _name;
  if _existing is not null then
    perform vault.update_secret(_existing, p_verdi);
  else
    perform vault.create_secret(p_verdi, _name);
  end if;
end $$;

revoke execute on function public.set_company_regnskap_token(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_company_regnskap_token(uuid, text, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Hvilket system firmaet bruker
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Kolonnen fantes med default 'ingen', men uten skranke — «tripleteks» ville
-- blitt lagret uten innsigelse og først oppdaget når fakturaen ikke kom fram.

alter table public.company_settings
  drop constraint if exists company_settings_regnskapssystem_sjekk;

alter table public.company_settings
  add constraint company_settings_regnskapssystem_sjekk
  check (regnskapssystem in ('ingen', 'fiken', 'tripletex'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Når utkastet sist gikk ut
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `invoice_external_id` sier AT ordren er sendt over; denne sier NÅR. Uten den
-- kan kontoret ikke skille «sendt i går, venter på at noen fakturerer» fra
-- «sendt for tre uker siden og glemt», og det er den forskjellen som avgjør om
-- man skal purre på seg selv.

alter table public.orders
  add column if not exists regnskap_sendt_at timestamptz;

comment on column public.orders.regnskap_sendt_at is
  'Når fakturautkastet sist ble pushet til regnskapssystemet. Selve ID-en står i invoice_external_id.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Tilbakerulling
-- ═══════════════════════════════════════════════════════════════════════════
--
--   alter table public.orders drop column regnskap_sendt_at;
--   alter table public.company_settings drop constraint company_settings_regnskapssystem_sjekk;
--   drop function public.set_company_regnskap_token(uuid, text, text);
--   drop function public.get_company_regnskap_token(uuid, text);
--   -- Vault-hemmelighetene blir liggende; slett dem eksplisitt om nødvendig.
