-- Kopier company_id, role og department fra invite-metadata til profiles ved opprettelse.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role public.app_role := 'montor'::public.app_role;
  v_company_id uuid;
  v_department text;
  v_full_name text;
  v_phone text;
begin
  v_full_name := coalesce(meta->>'full_name', '');
  v_phone := nullif(trim(coalesce(meta->>'phone', '')), '');

  if nullif(trim(coalesce(meta->>'company_id', '')), '') is not null then
    begin
      v_company_id := (meta->>'company_id')::uuid;
    exception when others then
      v_company_id := null;
    end;
  end if;

  v_department := nullif(trim(coalesce(meta->>'department', '')), '');

  if nullif(trim(coalesce(meta->>'role', '')), '') is not null then
    begin
      v_role := (meta->>'role')::public.app_role;
    exception when others then
      v_role := 'montor'::public.app_role;
    end;
  end if;

  insert into public.profiles (id, full_name, phone, company_id, role, department)
  values (new.id, v_full_name, v_phone, v_company_id, v_role, v_department)
  on conflict (id) do update
  set
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    phone = coalesce(excluded.phone, public.profiles.phone),
    company_id = coalesce(excluded.company_id, public.profiles.company_id),
    role = coalesce(excluded.role, public.profiles.role),
    department = coalesce(excluded.department, public.profiles.department);

  return new;
end;
$$;
