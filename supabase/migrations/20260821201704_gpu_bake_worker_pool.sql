-- MERK: kjørt mot basen 21. august 2026 som `gpu_bake_worker_pool`.
--
-- Før dette lå det et eldre utkast I BASEN som aldri fantes i repoet:
-- `scan_jobs` + `scan_claim_job(p_worker uuid)`. Den signaturen er grunnen til
-- at det måtte vekk — den tok en rå uuid og ingen hemmelighet, og var kallbar
-- av anon. Hvem som helst kunne plukket jobber ut av køen. Tabellen hadde 0
-- rader og ingen kode kalte funksjonene, så det som gikk tapt var et utkast.

drop function if exists public.scan_claim_job(uuid);
drop function if exists public.scan_complete(uuid, text);
drop function if exists public.scan_fail(uuid, text);
drop function if exists public.scan_heartbeat(uuid, integer, text);
drop function if exists public.scan_requeue_expired();
drop table if exists public.scan_jobs cascade;

-- GPU-bake: worker-pool (se docs/GPU_BAKE_PLAN.md)
-- Supabase er KUN kø og koordinering; all GPU-regning skjer på maskiner i
-- firmaets egen pool eller i Ampex-poolen. R2 holder blobbene.
--
-- Auth-modell: en worker-node er IKKE en person og har ingen rad i profiles.
-- Den melder seg inn med en engangskode fra appen og får et node-token som
-- kun duger til claim/heartbeat/complete. Tokenet lagres HASHET; RPC-ene er
-- security definer og slår opp node + firma selv, så en worker aldri trenger
-- en brukersesjon eller R2-nøklene.

-- ── worker_nodes ─────────────────────────────────────────────────────────────
create table public.worker_nodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null default '',
  hostname text,
  gpu_name text,
  worker_version text,
  -- sha256 av node-tokenet (hex). Klartekst vises én gang ved innmelding.
  token_hash text not null unique,
  status text not null default 'idle'
    check (status in ('idle', 'busy', 'offline')),
  last_heartbeat_at timestamptz,
  enrolled_by uuid references public.profiles (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index worker_nodes_company_idx on public.worker_nodes (company_id)
  where deleted_at is null and revoked_at is null;

create trigger worker_nodes_touch
  before update on public.worker_nodes
  for each row execute function public.touch_updated_at();

-- ── worker_enrollments — engangskoder for å melde inn en PC ──────────────────
create table public.worker_enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  code_hash text not null unique,
  created_by uuid references public.profiles (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_node uuid references public.worker_nodes (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger worker_enrollments_touch
  before update on public.worker_enrollments
  for each row execute function public.touch_updated_at();

-- ── scan_jobs ────────────────────────────────────────────────────────────────
create table public.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  room_id uuid,
  order_scan_id uuid,
  requested_by uuid references public.profiles (id),
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'running', 'done', 'failed', 'canceled')),
  -- hvilken pool som faktisk tok jobben — nødvendig for både fakturering og feilsøk
  pool text not null default 'firm' check (pool in ('firm', 'ampex')),
  input_prefix text not null,   -- R2-prefiks for framesDir
  output_key text,              -- R2-nøkkel til ferdig GLB
  keyframes int,
  progress real not null default 0,
  error text,
  claimed_by uuid references public.worker_nodes (id),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count int not null default 0,
  gpu_ms bigint,
  filled_fraction real,         -- regresjonsmålet mot on-device-baken
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Køuttrekket: eldste ventende jobb per firma
create index scan_jobs_queue_idx on public.scan_jobs (company_id, created_at)
  where status = 'queued' and deleted_at is null;

-- Utløpte leases (requeue-sveipen)
create index scan_jobs_lease_idx on public.scan_jobs (lease_expires_at)
  where status in ('claimed', 'running');

create trigger scan_jobs_touch
  before update on public.scan_jobs
  for each row execute function public.touch_updated_at();

-- ── RLS — appbrukere ser kun eget firma (regel: RLS per company_id) ──────────
alter table public.worker_nodes enable row level security;
alter table public.worker_enrollments enable row level security;
alter table public.scan_jobs enable row level security;

create policy worker_nodes_company_select on public.worker_nodes
  for select using (company_id = public.current_company_id());

create policy worker_enrollments_company_select on public.worker_enrollments
  for select using (company_id = public.current_company_id());

create policy scan_jobs_company_select on public.scan_jobs
  for select using (company_id = public.current_company_id());

create policy scan_jobs_company_insert on public.scan_jobs
  for insert with check (company_id = public.current_company_id());

create policy scan_jobs_company_update on public.scan_jobs
  for update using (company_id = public.current_company_id());

-- Worker-nodene endrer ALDRI rader direkte — kun via RPC-ene under.
-- Ingen update/delete-policy for worker_nodes/worker_enrollments med vilje.

-- ── Innmelding ───────────────────────────────────────────────────────────────

-- Admin i appen lager en engangskode. Klarteksten returneres én gang.
create or replace function public.create_worker_enrollment(ttl_minutes int default 30)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_company uuid := public.current_company_id();
  v_code text;
begin
  if v_company is null then
    raise exception 'ingen firmakontekst';
  end if;

  v_code := encode(gen_random_bytes(18), 'hex');

  insert into public.worker_enrollments (company_id, code_hash, created_by, expires_at)
  values (v_company,
          encode(digest(v_code, 'sha256'), 'hex'),
          auth.uid(),
          now() + make_interval(mins => ttl_minutes));

  return v_code;
end $$;

-- Worker-EXE bytter engangskoden mot et varig node-token (returneres én gang).
create or replace function public.enroll_worker_node(
  enrollment_code text,
  p_hostname text default null,
  p_gpu_name text default null,
  p_worker_version text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enroll public.worker_enrollments%rowtype;
  v_token text;
  v_node uuid;
begin
  select * into v_enroll
  from public.worker_enrollments
  where code_hash = encode(digest(enrollment_code, 'sha256'), 'hex')
    and used_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'ugyldig eller brukt innmeldingskode';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.worker_nodes
    (company_id, hostname, gpu_name, worker_version, token_hash, enrolled_by, name)
  values
    (v_enroll.company_id, p_hostname, p_gpu_name, p_worker_version,
     encode(digest(v_token, 'sha256'), 'hex'), v_enroll.created_by,
     coalesce(p_hostname, 'worker'))
  returning id into v_node;

  update public.worker_enrollments
     set used_at = now(), used_by_node = v_node
   where id = v_enroll.id;

  return v_token;
end $$;

-- ── Node-oppslag (intern) ────────────────────────────────────────────────────
create or replace function public.worker_node_for_token(node_token text)
returns public.worker_nodes
language sql
stable
security definer
set search_path = public, extensions
as $$
  select *
  from public.worker_nodes
  where token_hash = encode(digest(node_token, 'sha256'), 'hex')
    and revoked_at is null
    and deleted_at is null
$$;

-- ── Claim med lease ──────────────────────────────────────────────────────────

-- Plukk én ventende jobb. `skip locked` gjør at to PC-er i samme pool aldri
-- tar samme jobb. Leaset fornyes av heartbeat; utløper det, requeues jobben.
create or replace function public.claim_scan_job(
  node_token text,
  lease_seconds int default 300
)
returns public.scan_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_node public.worker_nodes;
  v_job public.scan_jobs;
begin
  v_node := public.worker_node_for_token(node_token);
  if v_node.id is null then
    raise exception 'ukjent eller trukket node-token';
  end if;

  select * into v_job
  from public.scan_jobs
  where company_id = v_node.company_id
    and status = 'queued'
    and deleted_at is null
    and attempt_count < 3
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.scan_jobs
     set status = 'claimed',
         claimed_by = v_node.id,
         claimed_at = now(),
         lease_expires_at = now() + make_interval(secs => lease_seconds),
         attempt_count = attempt_count + 1
   where id = v_job.id
  returning * into v_job;

  update public.worker_nodes
     set status = 'busy', last_heartbeat_at = now()
   where id = v_node.id;

  return v_job;
end $$;

-- Fornyer leaset og rapporterer framdrift. Uten dette dør jobben og requeues.
create or replace function public.heartbeat_scan_job(
  node_token text,
  job_id uuid,
  p_progress real default null,
  lease_seconds int default 300
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_node public.worker_nodes;
begin
  v_node := public.worker_node_for_token(node_token);
  if v_node.id is null then
    raise exception 'ukjent eller trukket node-token';
  end if;

  update public.scan_jobs
     set status = 'running',
         progress = coalesce(p_progress, progress),
         lease_expires_at = now() + make_interval(secs => lease_seconds)
   where id = job_id and claimed_by = v_node.id;

  update public.worker_nodes
     set last_heartbeat_at = now()
   where id = v_node.id;
end $$;

create or replace function public.complete_scan_job(
  node_token text,
  job_id uuid,
  p_output_key text,
  p_gpu_ms bigint default null,
  p_filled_fraction real default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_node public.worker_nodes;
begin
  v_node := public.worker_node_for_token(node_token);
  if v_node.id is null then
    raise exception 'ukjent eller trukket node-token';
  end if;

  update public.scan_jobs
     set status = 'done',
         output_key = p_output_key,
         gpu_ms = p_gpu_ms,
         filled_fraction = p_filled_fraction,
         progress = 1,
         lease_expires_at = null
   where id = job_id and claimed_by = v_node.id;

  update public.worker_nodes
     set status = 'idle', last_heartbeat_at = now()
   where id = v_node.id;
end $$;

create or replace function public.fail_scan_job(
  node_token text,
  job_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_node public.worker_nodes;
begin
  v_node := public.worker_node_for_token(node_token);
  if v_node.id is null then
    raise exception 'ukjent eller trukket node-token';
  end if;

  -- Tilbake i kø hvis det er forsøk igjen; ellers endelig feilet.
  update public.scan_jobs
     set status = case when attempt_count < 3 then 'queued' else 'failed' end,
         error = p_error,
         claimed_by = null,
         lease_expires_at = null
   where id = job_id and claimed_by = v_node.id;

  update public.worker_nodes
     set status = 'idle', last_heartbeat_at = now()
   where id = v_node.id;
end $$;

-- Requeue jobber der worker-en døde midt i (lease utløpt). Kjøres av cron.
create or replace function public.requeue_expired_scan_jobs()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  update public.scan_jobs
     set status = case when attempt_count < 3 then 'queued' else 'failed' end,
         error = coalesce(error, 'lease utløpt — worker svarte ikke'),
         claimed_by = null,
         lease_expires_at = null
   where status in ('claimed', 'running')
     and lease_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── Rettigheter ──────────────────────────────────────────────────────────────
-- Worker-EXE-en kjører med anon-nøkkel; node-tokenet ER autentiseringen.
grant execute on function public.enroll_worker_node(text, text, text, text) to anon, authenticated;
grant execute on function public.claim_scan_job(text, int) to anon, authenticated;
grant execute on function public.heartbeat_scan_job(text, uuid, real, int) to anon, authenticated;
grant execute on function public.complete_scan_job(text, uuid, text, bigint, real) to anon, authenticated;
grant execute on function public.fail_scan_job(text, uuid, text) to anon, authenticated;

-- Kun innloggede appbrukere lager innmeldingskoder
revoke execute on function public.create_worker_enrollment(int) from anon;

-- Intern hjelper og vedlikehold skal ikke nås utenfra
revoke execute on function public.worker_node_for_token(text) from anon, authenticated;
revoke execute on function public.requeue_expired_scan_jobs() from anon, authenticated;
