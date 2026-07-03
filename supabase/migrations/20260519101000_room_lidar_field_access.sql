-- Montør/lærling: se, laste opp og erstatte LiDAR på tegninger de har tilgang til.

create or replace function public.can_access_room_lidar_for_room(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = target_room_id
      and p.company_id = public.get_user_company_id()
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  );
$$;

grant execute on function public.can_access_room_lidar_for_room(uuid) to authenticated;

drop policy if exists "room_lidar_scans_select" on public.room_lidar_scans;

create policy "room_lidar_scans_select"
on public.room_lidar_scans for select
using (public.can_access_room_lidar_for_room(drawing_room_id));

drop policy if exists "room_lidar_scans_insert" on public.room_lidar_scans;
drop policy if exists "room_lidar_scans_update" on public.room_lidar_scans;
drop policy if exists "room_lidar_scans_delete" on public.room_lidar_scans;

create policy "room_lidar_scans_insert"
on public.room_lidar_scans for insert
with check (
  (uploaded_by is null or uploaded_by = auth.uid())
  and public.can_access_room_lidar_for_room(drawing_room_id)
);

create policy "room_lidar_scans_update"
on public.room_lidar_scans for update
using (public.can_access_room_lidar_for_room(drawing_room_id))
with check (
  (uploaded_by is null or uploaded_by = auth.uid())
  and public.can_access_room_lidar_for_room(drawing_room_id)
);

create policy "room_lidar_scans_delete"
on public.room_lidar_scans for delete
using (
  public.is_company_privileged()
  or (
    public.can_access_room_lidar_for_room(drawing_room_id)
    and uploaded_by = auth.uid()
  )
);

-- Felt kan laste opp scan-filer (path: {company_id}/{project_id}/...)
drop policy if exists "drawings_bucket_insert_room_scan_field" on storage.objects;

create policy "drawings_bucket_insert_room_scan_field"
on storage.objects for insert
with check (
  bucket_id = 'drawings'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
  and public.can_view_project_blueprints(split_part(name, '/', 2)::uuid)
  and position('/rooms/' in name) > 0
  and exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()
      and pr.role::text in ('owner', 'admin', 'baas', 'installator', 'montor', 'apprentice')
  )
);
