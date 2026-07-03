-- splat_jobs: audit trail for every Gaussian Splat training job, with cost tracking.
-- One row per dispatch. The worker writes back timing + cost when done.

CREATE TABLE IF NOT EXISTS public.splat_jobs (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scan_id             uuid         NOT NULL,
  table_name          text         NOT NULL CHECK (table_name IN ('room_lidar_scans', 'order_lidar_scans')),
  status              text         NOT NULL DEFAULT 'dispatched'
                                   CHECK (status IN ('dispatched', 'training', 'done', 'failed')),
  dispatched_at       timestamptz  NOT NULL DEFAULT now(),
  training_started_at timestamptz,
  finished_at         timestamptz,
  training_seconds    integer,
  gpu_cost_usd        numeric(10, 6),
  created_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS splat_jobs_company_month
  ON public.splat_jobs (company_id, dispatched_at DESC);

ALTER TABLE public.splat_jobs ENABLE ROW LEVEL SECURITY;

-- Company members can read their own jobs (for admin usage dashboard)
CREATE POLICY "company members can read splat jobs"
  ON public.splat_jobs FOR SELECT
  USING (company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- Per-company quota. Default: 10 scans/month included; overage allowed (tracked, not blocked).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS splat_quota_monthly   integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS splat_overage_allowed boolean NOT NULL DEFAULT true;
