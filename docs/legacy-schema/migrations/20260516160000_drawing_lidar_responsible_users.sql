-- Flere LiDAR-ansvarlige per tegning (uuid[] som visible_to_user_ids).

alter table public.drawings
  add column if not exists lidar_responsible_user_ids uuid[];

-- Backfill fra enkeltkolonne hvis den finnes
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'drawings'
      and column_name = 'lidar_responsible_user_id'
  ) then
    update public.drawings
    set lidar_responsible_user_ids = array[lidar_responsible_user_id]
    where lidar_responsible_user_id is not null
      and (
        lidar_responsible_user_ids is null
        or cardinality(lidar_responsible_user_ids) = 0
      );
  end if;
end $$;

create index if not exists idx_drawings_lidar_responsible_user_ids
  on public.drawings using gin (lidar_responsible_user_ids)
  where lidar_responsible_user_ids is not null;

comment on column public.drawings.lidar_responsible_user_ids is
  'Brukere som får innboks ved etterspurt 3D-scan for rom på tegningen.';
