-- Multi-scan per room + scan name + 3D annotations.
-- Previously room_lidar_scans was unique per drawing_room_id (one scan per room).
-- The dense "Skan" flow stacks multiple scans per room, each with an editable name,
-- and supports text/arrow annotations stored as JSON.

alter table public.room_lidar_scans
  drop constraint if exists room_lidar_scans_unique_room;

alter table public.room_lidar_scans
  add column if not exists scan_name text;

alter table public.room_lidar_scans
  add column if not exists annotations jsonb not null default '[]'::jsonb;

-- order_lidar_scans already allows multiple rows per order; add the same fields.
alter table public.order_lidar_scans
  add column if not exists scan_name text;

alter table public.order_lidar_scans
  add column if not exists annotations jsonb not null default '[]'::jsonb;
