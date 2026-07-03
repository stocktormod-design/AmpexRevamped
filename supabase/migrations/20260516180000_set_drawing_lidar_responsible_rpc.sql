-- Pålitelig lagring av LiDAR-ansvarlige (omgår PostgREST schema-cache-problemer).

create or replace function public.set_drawing_lidar_responsible(
  p_drawing_id uuid,
  p_user_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  v_ids := coalesce(p_user_ids, array[]::uuid[]);

  if cardinality(v_ids) = 0 then
    update public.drawings
    set
      lidar_responsible_user_ids = null,
      lidar_responsible_user_id = null
    where id = p_drawing_id;
  else
    update public.drawings
    set
      lidar_responsible_user_ids = v_ids,
      lidar_responsible_user_id = v_ids[1]
    where id = p_drawing_id;
  end if;

  return (
    select coalesce(lidar_responsible_user_ids, array[]::uuid[])
    from public.drawings
    where id = p_drawing_id
  );
end;
$$;

comment on function public.set_drawing_lidar_responsible(uuid, uuid[]) is
  'Setter LiDAR-ansvarlige på tegning; returnerer lagret uuid[].';

grant execute on function public.set_drawing_lidar_responsible(uuid, uuid[]) to service_role;
grant execute on function public.set_drawing_lidar_responsible(uuid, uuid[]) to authenticated;
