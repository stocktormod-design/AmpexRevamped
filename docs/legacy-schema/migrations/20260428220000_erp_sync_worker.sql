-- ERP sync-worker: atomisk job-claim med FOR UPDATE SKIP LOCKED.
-- Forhindrer race conditions i multi-instance-miljøer (f.eks. Vercel serverless).

-- claim_sync_job: plukk én jobb atomisk og sett den til 'processing'.
-- Kalles kun via service role (admin-klient i API-ruten).
create or replace function public.claim_sync_job()
returns table(
  job_id         uuid,
  integration_id uuid,
  company_id     uuid,
  provider       text,
  order_id       uuid,
  retry_count    integer,
  max_retries    integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  -- Hent neste tilgjengelige jobb og lås raden.
  -- SKIP LOCKED: hopp over rader som allerede er låst av en annen worker.
  -- Sorter på created_at for FIFO-prosessering.
  select j.id into v_job_id
  from public.erp_sync_jobs j
  where j.status in ('queued', 'retry_wait')
    and (j.next_retry_at is null or j.next_retry_at <= now())
  order by j.created_at asc
  limit 1
  for update skip locked;

  if not found then
    return;  -- Ingen jobber tilgjengelig
  end if;

  -- Atomisk overgang til 'processing' — andre workers ser denne statusen
  -- umiddelbart etter commit og hopper over jobben.
  update public.erp_sync_jobs
  set
    status     = 'processing',
    started_at = now(),
    updated_at = now()
  where id = v_job_id;

  -- Returner jobbdata til worker.
  return query
    select
      j.id,
      j.integration_id,
      j.company_id,
      j.provider::text,
      j.order_id,
      j.retry_count,
      j.max_retries
    from public.erp_sync_jobs j
    where j.id = v_job_id;
end;
$$;

revoke execute on function public.claim_sync_job() from public, authenticated, anon;
grant  execute on function public.claim_sync_job() to service_role;
