-- LiDAR-ansvarlig per tegning: mottar innboks når noen etterspør 3D-scan for et rom.

alter table public.drawings
  add column if not exists lidar_responsible_user_id uuid references public.profiles (id) on delete set null;

create index if not exists idx_drawings_lidar_responsible_user_id
  on public.drawings (lidar_responsible_user_id)
  where lidar_responsible_user_id is not null;

comment on column public.drawings.lidar_responsible_user_id is
  'Bruker som får innboks-varsel ved etterspurt 3D-scan (rom på denne tegningen).';
