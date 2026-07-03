-- Per-room LiDAR / 3D scans linked to a drawing room.
-- Tenant isolation follows the same pattern as drawing_rooms (Del B1).
-- Storage path convention: {project_id}/{drawing_id}/rooms/{room_id}/scan-{timestamp}.glb
--                          inside the existing 'drawings' bucket.

create table if not exists public.room_lidar_scans (
  id uuid primary key default gen_random_uuid(),
  drawing_room_id uuid not null references public.drawing_rooms (id) on delete cascade,

  -- Storage paths (relative to 'drawings' bucket).
  original_file_path text not null,
  compressed_file_path text,
  thumbnail_path text,

  original_format text not null,
  original_size_bytes bigint not null,
  compressed_size_bytes bigint,
  compression_ratio real,
  points_count bigint,

  status text not null default 'uploading',
  compression_progress int not null default 0,
  error_message text,

  scanned_at timestamptz,
  device_info jsonb,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint room_lidar_scans_status_check check (
    status in ('uploading', 'processing', 'ready', 'failed')
  ),
  constraint room_lidar_scans_format_check check (
    original_format in ('glb', 'gltf', 'usdz', 'ply', 'obj')
  ),
  constraint room_lidar_scans_progress_range check (
    compression_progress between 0 and 100
  ),
  constraint room_lidar_scans_unique_room unique (drawing_room_id)
);

create index if not exists idx_room_lidar_scans_room
  on public.room_lidar_scans (drawing_room_id);
create index if not exists idx_room_lidar_scans_status
  on public.room_lidar_scans (status);

drop trigger if exists trg_room_lidar_scans_set_updated_at on public.room_lidar_scans;
create trigger trg_room_lidar_scans_set_updated_at
before update on public.room_lidar_scans
for each row
execute function public.set_updated_at();

alter table public.room_lidar_scans enable row level security;

create policy "room_lidar_scans_select"
on public.room_lidar_scans for select
using (
  exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = room_lidar_scans.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.can_access_project(p.id)
  )
);

create policy "room_lidar_scans_insert"
on public.room_lidar_scans for insert
with check (
  (uploaded_by is null or uploaded_by = auth.uid())
  and exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = room_lidar_scans.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "room_lidar_scans_update"
on public.room_lidar_scans for update
using (
  exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = room_lidar_scans.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
)
with check (
  exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = room_lidar_scans.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "room_lidar_scans_delete"
on public.room_lidar_scans for delete
using (
  exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = room_lidar_scans.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);
