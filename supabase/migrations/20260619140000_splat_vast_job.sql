-- Track Vast.ai contract IDs separately from splat_error.
alter table public.room_lidar_scans
  add column if not exists splat_job_id text;

alter table public.order_lidar_scans
  add column if not exists splat_job_id text;
