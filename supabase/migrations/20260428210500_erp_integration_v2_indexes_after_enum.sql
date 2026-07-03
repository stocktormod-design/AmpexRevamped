-- Indekser for erp_sync_jobs som refererer til nye sync_job_status-verdier.
-- Må ligge i egen migrasjon etter 20260428210000: PG tillater ikke bruk av nye
-- enum-literaler i samme transaksjon som ALTER TYPE ... ADD VALUE (SQLSTATE 55P04).

-- Plukk opp jobber klare for retry.
create index if not exists idx_erp_sync_jobs_next_retry
  on public.erp_sync_jobs (next_retry_at)
  where status = 'retry_wait' and next_retry_at is not null;

-- Aktive jobber per firma og provider (for worker-sjekk).
create index if not exists idx_erp_sync_jobs_company_provider_active
  on public.erp_sync_jobs (company_id, provider, status)
  where status in ('queued', 'processing', 'retry_wait');
