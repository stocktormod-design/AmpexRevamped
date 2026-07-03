-- ERP-integrasjon v2: Vault-støtte, forbedret retry-logikk, strammere constraints.
-- Krav: Supabase Vault (pgsodium) må være aktivert i prosjektet.
--       Sjekk med: select * from pg_extension where extname = 'pgsodium';

-- ── Utvid sync_job_status-enum ────────────────────────────────────────────
-- Legger til 'queued' (erstatter 'pending' for nye jobber),
-- 'processing' (erstatter 'running'), og 'retry_wait'.
-- Gamle verdier beholdes for bakoverkompatibilitet.

alter type public.sync_job_status add value if not exists 'queued';
alter type public.sync_job_status add value if not exists 'processing';
alter type public.sync_job_status add value if not exists 'retry_wait';

-- ── company_integrations: nye kolonner ────────────────────────────────────

alter table public.company_integrations
  add column if not exists auth_secret_ref uuid,
  add column if not exists last_sync_at     timestamptz,
  add column if not exists last_sync_status text
    check (last_sync_status in ('completed', 'failed', 'partial')),
  add column if not exists last_sync_error  text;

-- ── erp_sync_jobs: legg til retry-scheduling og omdøp error_message ──────

-- Omdøp error_message → last_error for konsistens med nytt navneskjema.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_sync_jobs'
      and column_name = 'error_message'
  ) then
    alter table public.erp_sync_jobs rename column error_message to last_error;
  end if;
end $$;

alter table public.erp_sync_jobs
  add column if not exists next_retry_at timestamptz;

-- ── erp_external_id_links: fiks unique constraints ────────────────────────

-- Gammel constraint manglet company_id-scope; dropp og erstatt.
alter table public.erp_external_id_links
  drop constraint if exists erp_external_id_links_provider_entity_type_local_id_key;

-- Unik per (company, provider, entitetstype, lokal ID) for upsert av koblinger.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'erp_ext_links_company_provider_entity_local_uq'
  ) then
    alter table public.erp_external_id_links
      add constraint erp_ext_links_company_provider_entity_local_uq
        unique (company_id, provider, entity_type, local_id);
  end if;
end $$;

-- Unik per (company, provider, entitetstype, ekstern ID) for reverse lookup.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'erp_ext_links_company_provider_entity_external_uq'
  ) then
    alter table public.erp_external_id_links
      add constraint erp_ext_links_company_provider_entity_external_uq
        unique (company_id, provider, entity_type, provider_id);
  end if;
end $$;

-- Indekser som bruker nye enum-verdier ligger i egen migrasjon (PostgreSQL 55P04:
-- «unsafe use of new value» i samme transaksjon som ADD VALUE).

-- ── Vault-hjelpefunksjoner ────────────────────────────────────────────────
-- Disse kalles kun via service role (admin-klient). Authenticated og anon
-- har ikke EXECUTE-rettighet.

-- Opprett eller oppdater Vault-hemmelighet for ERP-integrasjon.
-- Returnerer vault secret-ID som lagres i company_integrations.auth_secret_ref.
create or replace function public.vault_upsert_integration_secret(
  p_company_id  uuid,
  p_provider    text,
  p_secret_json text   -- JSON-streng med credentials
) returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_name text;
  v_id   uuid;
begin
  v_name := 'erp_' || p_company_id::text || '_' || p_provider;

  -- Gjenbruk eksisterende oppføring hvis den finnes (oppdater secrets in-place).
  select id into v_id from vault.secrets where name = v_name limit 1;

  if found then
    perform vault.update_secret(v_id, p_secret_json);
    return v_id;
  else
    return vault.create_secret(p_secret_json, v_name, 'ERP-integrasjonscredentials');
  end if;
end;
$$;

-- Les dekryptert hemmelighet (brukes kun av adaptere via service role).
create or replace function public.vault_get_integration_secret(p_id uuid)
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

-- Kun service_role skal kalle disse funksjonene.
revoke execute
  on function public.vault_upsert_integration_secret(uuid, text, text)
  from public, authenticated, anon;
grant execute
  on function public.vault_upsert_integration_secret(uuid, text, text)
  to service_role;

revoke execute
  on function public.vault_get_integration_secret(uuid)
  from public, authenticated, anon;
grant execute
  on function public.vault_get_integration_secret(uuid)
  to service_role;
