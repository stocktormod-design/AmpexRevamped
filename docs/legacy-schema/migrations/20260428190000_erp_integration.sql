-- ERP-integrasjonsfundament: oppsett per firma, eksterne ID-koblinger, og synkjobb-log.
-- Idempotent: alle DDL-operasjoner bruker IF NOT EXISTS / DO $$ EXCEPTION-blokker.

-- ── Enums ──────────────────────────────────────────────────────────────────

do $$
begin
  create type public.erp_provider as enum ('fiken', 'tripletex');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.integration_status as enum ('active', 'inactive', 'error');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.sync_job_status as enum ('pending', 'running', 'completed', 'failed');
exception
  when duplicate_object then null;
end $$;

-- Hvilken lokal entitetstype som kobles til en ekstern ERP-ID.
do $$
begin
  create type public.erp_entity_type as enum ('order', 'customer', 'order_line');
exception
  when duplicate_object then null;
end $$;

-- ── Tabeller ───────────────────────────────────────────────────────────────

-- Integrasjonsoppsett per firma og ERP-leverandør.
-- auth_meta inneholder krypterte/opake tokendata (API-nøkler, org-slug, etc.).
create table if not exists public.company_integrations (
  id          uuid                     primary key default gen_random_uuid(),
  company_id  uuid                     not null references public.companies (id) on delete cascade,
  provider    public.erp_provider      not null,
  status      public.integration_status not null default 'inactive',
  auth_meta   jsonb                    not null default '{}'::jsonb,
  created_by  uuid                     not null references public.profiles (id),
  created_at  timestamptz              not null default now(),
  updated_at  timestamptz              not null default now(),
  unique (company_id, provider)
);

-- Kobling mellom lokale entitets-UUIDs og ERP-leverandørens egne IDer.
-- local_id er generisk (ingen FK) fordi den kan peke på ordre, kunder eller linjer.
create table if not exists public.erp_external_id_links (
  id           uuid                    primary key default gen_random_uuid(),
  company_id   uuid                    not null references public.companies (id) on delete cascade,
  provider     public.erp_provider     not null,
  entity_type  public.erp_entity_type  not null,
  local_id     uuid                    not null,
  provider_id  text                    not null,
  synced_at    timestamptz             not null default now(),
  unique (provider, entity_type, local_id)
);

-- En synkjobb representerer ett forsøk på å sende et fakturagrunnlag til ERP.
create table if not exists public.erp_sync_jobs (
  id              uuid                    primary key default gen_random_uuid(),
  company_id      uuid                    not null references public.companies (id) on delete cascade,
  integration_id  uuid                    not null references public.company_integrations (id) on delete cascade,
  provider        public.erp_provider     not null,
  order_id        uuid                    references public.orders (id) on delete set null,
  status          public.sync_job_status  not null default 'pending',
  error_message   text,
  retry_count     integer                 not null default 0 check (retry_count >= 0),
  max_retries     integer                 not null default 3 check (max_retries >= 0),
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz             not null default now(),
  updated_at      timestamptz             not null default now()
);

-- ── Indekser ───────────────────────────────────────────────────────────────

create index if not exists idx_company_integrations_company_id
  on public.company_integrations (company_id);

create index if not exists idx_erp_external_id_links_company_provider
  on public.erp_external_id_links (company_id, provider);

create index if not exists idx_erp_external_id_links_local_id
  on public.erp_external_id_links (local_id);

create index if not exists idx_erp_sync_jobs_company_id
  on public.erp_sync_jobs (company_id);

create index if not exists idx_erp_sync_jobs_order_id
  on public.erp_sync_jobs (order_id);

-- Partiell indeks: kun aktive jobber trenger rask oppslag på status.
create index if not exists idx_erp_sync_jobs_active_status
  on public.erp_sync_jobs (status)
  where status in ('pending', 'running');

-- ── Triggers ───────────────────────────────────────────────────────────────

drop trigger if exists trg_company_integrations_set_updated_at on public.company_integrations;
create trigger trg_company_integrations_set_updated_at
  before update on public.company_integrations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_erp_sync_jobs_set_updated_at on public.erp_sync_jobs;
create trigger trg_erp_sync_jobs_set_updated_at
  before update on public.erp_sync_jobs
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.company_integrations    enable row level security;
alter table public.erp_external_id_links   enable row level security;
alter table public.erp_sync_jobs           enable row level security;

-- company_integrations: kun admin/owner
drop policy if exists "company_integrations_select" on public.company_integrations;
create policy "company_integrations_select"
  on public.company_integrations for select
  using (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "company_integrations_insert" on public.company_integrations;
create policy "company_integrations_insert"
  on public.company_integrations for insert
  with check (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "company_integrations_update" on public.company_integrations;
create policy "company_integrations_update"
  on public.company_integrations for update
  using  (company_id = public.get_user_company_id() and public.is_company_admin())
  with check (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "company_integrations_delete" on public.company_integrations;
create policy "company_integrations_delete"
  on public.company_integrations for delete
  using (company_id = public.get_user_company_id() and public.is_company_admin());

-- erp_external_id_links: admin only; skrives utelukkende via service role / server action
drop policy if exists "erp_external_id_links_select" on public.erp_external_id_links;
create policy "erp_external_id_links_select"
  on public.erp_external_id_links for select
  using (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "erp_external_id_links_write" on public.erp_external_id_links;
create policy "erp_external_id_links_write"
  on public.erp_external_id_links for all
  using  (company_id = public.get_user_company_id() and public.is_company_admin())
  with check (company_id = public.get_user_company_id() and public.is_company_admin());

-- erp_sync_jobs: admin only; status-oppdateringer skjer via service role
drop policy if exists "erp_sync_jobs_select" on public.erp_sync_jobs;
create policy "erp_sync_jobs_select"
  on public.erp_sync_jobs for select
  using (company_id = public.get_user_company_id() and public.is_company_admin());

drop policy if exists "erp_sync_jobs_write" on public.erp_sync_jobs;
create policy "erp_sync_jobs_write"
  on public.erp_sync_jobs for all
  using  (company_id = public.get_user_company_id() and public.is_company_admin())
  with check (company_id = public.get_user_company_id() and public.is_company_admin());

-- ── Grants ─────────────────────────────────────────────────────────────────

grant select on public.company_integrations  to authenticated;
grant select on public.erp_external_id_links to authenticated;
grant select on public.erp_sync_jobs         to authenticated;
