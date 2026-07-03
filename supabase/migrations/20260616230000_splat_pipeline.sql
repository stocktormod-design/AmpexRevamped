-- Gaussian Splat pipeline: per-scan splat job tracking + private storage buckets.
-- (Applied to prod via Supabase MCP 2026-06-16; this file keeps migration history in sync.)

alter table public.room_lidar_scans
  add column if not exists splat_status text,
  add column if not exists splat_bundle_path text,
  add column if not exists splat_path text,
  add column if not exists splat_error text;

alter table public.order_lidar_scans
  add column if not exists splat_status text,
  add column if not exists splat_bundle_path text,
  add column if not exists splat_path text,
  add column if not exists splat_error text;

insert into storage.buckets (id, name, public)
values ('scan-bundles', 'scan-bundles', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('splats', 'splats', false)
on conflict (id) do nothing;
