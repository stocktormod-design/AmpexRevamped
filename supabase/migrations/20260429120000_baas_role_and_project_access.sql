-- Sprint 1: baas role + invite-based project access
-- Adds 'baas' leadership role, extends project access, adds invite columns and policies.

-- 1. Add 'baas' enum value idempotently
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'baas'
  ) then
    alter type public.app_role add value 'baas';
  end if;
end $$;

-- 2. Add is_company_privileged(): owner/admin/baas get full project access
create or replace function public.is_company_privileged()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role::text in ('owner', 'admin', 'baas')
  );
$$;

grant execute on function public.is_company_privileged() to authenticated;

-- 3. Update can_access_project() so baas also gets full project access
create or replace function public.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_privileged()
        or exists (
          select 1
          from public.project_assignments pa
          where pa.project_id = p.id
            and pa.user_id = auth.uid()
        )
      )
  );
$$;

-- 4. Extend project_assignments with invited_by and invited_at if missing
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_assignments'
      and column_name = 'invited_by'
  ) then
    alter table public.project_assignments
      add column invited_by uuid references public.profiles (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_assignments'
      and column_name = 'invited_at'
  ) then
    alter table public.project_assignments
      add column invited_at timestamptz;
  end if;
end $$;

-- 5. Allow owner/admin/baas to manage project_assignments
drop policy if exists "project_assignments_write_admin_only" on public.project_assignments;
drop policy if exists "project_assignments_write_privileged" on public.project_assignments;
create policy "project_assignments_write_privileged"
on public.project_assignments for all
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

-- 6. Allow baas to create and update projects
drop policy if exists "projects_insert_admin_only" on public.projects;
drop policy if exists "projects_insert_privileged" on public.projects;
create policy "projects_insert_privileged"
on public.projects for insert
with check (
  company_id = public.get_user_company_id()
  and public.is_company_privileged()
);

drop policy if exists "projects_update_admin_only" on public.projects;
drop policy if exists "projects_update_privileged" on public.projects;
create policy "projects_update_privileged"
on public.projects for update
using (
  company_id = public.get_user_company_id()
  and public.is_company_privileged()
)
with check (
  company_id = public.get_user_company_id()
  and public.is_company_privileged()
);

-- 7. Update blueprint access management to include baas
drop policy if exists "project_blueprint_access_insert_admin" on public.project_blueprint_access;
drop policy if exists "project_blueprint_access_insert_privileged" on public.project_blueprint_access;
create policy "project_blueprint_access_insert_privileged"
on public.project_blueprint_access for insert
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
  and user_id in (
    select pr.id
    from public.profiles pr
    where pr.company_id = public.get_user_company_id()
  )
);

drop policy if exists "project_blueprint_access_delete_admin" on public.project_blueprint_access;
drop policy if exists "project_blueprint_access_delete_privileged" on public.project_blueprint_access;
create policy "project_blueprint_access_delete_privileged"
on public.project_blueprint_access for delete
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

-- 8. Update can_view_project_blueprints to use privileged check
create or replace function public.can_view_project_blueprints(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.company_id = public.get_user_company_id()
  )
  and (
    public.is_company_privileged()
    or (
      public.can_access_project(target_project_id)
      and (
        not exists (
          select 1
          from public.project_blueprint_access a
          where a.project_id = target_project_id
        )
        or exists (
          select 1
          from public.project_blueprint_access a
          where a.project_id = target_project_id
            and a.user_id = auth.uid()
        )
      )
    )
  );
$$;

-- 9. Update is_blueprint_access_blocked so baas is never blocked
create or replace function public.is_blueprint_access_blocked(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.company_id = public.get_user_company_id()
  )
  and not public.is_company_privileged()
  and exists (
    select 1
    from public.project_blueprint_access a
    where a.project_id = target_project_id
  )
  and not exists (
    select 1
    from public.project_blueprint_access a
    where a.project_id = target_project_id
      and a.user_id = auth.uid()
  );
$$;
