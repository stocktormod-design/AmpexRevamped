-- On-device splat training (msplat) replaces the RunPod/Vast cloud pipeline.
-- The splat_jobs audit table and per-company GPU quota columns existed only to
-- track/limit rented-GPU cost. On-device training is free, so they're removed.

-- Drop the FK columns first, otherwise splat_jobs can't be dropped.
alter table public.order_lidar_scans drop column if exists splat_job_id;
alter table public.room_lidar_scans  drop column if exists splat_job_id;

drop table if exists public.splat_jobs;

alter table public.companies drop column if exists splat_quota_monthly;
alter table public.companies drop column if exists splat_overage_allowed;
