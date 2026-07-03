-- Per-project allowlist: which users may view published drawings (blueprints).
-- Empty list = all users who already have project access (can_access_project) may view published tegninger.

create table if not exists public.project_blueprint_access (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists idx_project_blueprint_access_project_id
  on public.project_blueprint_access (project_id);

create index if not exists idx_project_blueprint_access_user_id
  on public.project_blueprint_access (user_id);

alter table public.project_blueprint_access enable row level security;

drop policy if exists "project_blueprint_access_select" on public.project_blueprint_access;
create policy "project_blueprint_access_select"
on public.project_blueprint_access for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
  )
  and (
    public.is_company_admin()
    or user_id = auth.uid()
  )
);

drop policy if exists "project_blueprint_access_insert_admin" on public.project_blueprint_access;
create policy "project_blueprint_access_insert_admin"
on public.project_blueprint_access for insert
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_admin()
  )
  and user_id in (
    select pr.id
    from public.profiles pr
    where pr.company_id = public.get_user_company_id()
  )
);

drop policy if exists "project_blueprint_access_delete_admin" on public.project_blueprint_access;
create policy "project_blueprint_access_delete_admin"
on public.project_blueprint_access for delete
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_admin()
  )
);

-- Admins: always. Others: project access AND (no allowlist OR on allowlist).
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
    public.is_company_admin()
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

grant execute on function public.can_view_project_blueprints(uuid) to authenticated;

-- For UI: true when allowlist exists and current user is not on it (and not admin).
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
  and not public.is_company_admin()
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

grant execute on function public.is_blueprint_access_blocked(uuid) to authenticated;

-- Pins on drawings: same visibility as tegninger.
drop policy if exists "pins_select_by_project_access" on public.pins;
create policy "pins_select_by_project_access"
on public.pins for select
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
);

drop policy if exists "pins_insert_by_project_access" on public.pins;
create policy "pins_insert_by_project_access"
on public.pins for insert
with check (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
);

drop policy if exists "pins_update_by_creator_or_admin" on public.pins;
create policy "pins_update_by_creator_or_admin"
on public.pins for update
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
  and (
    created_by = auth.uid()
    or public.is_company_admin()
  )
)
with check (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
  and (
    created_by = auth.uid()
    or public.is_company_admin()
  )
);

-- Drawings: keep draft vs published; add blueprint gate for published rows.
drop policy if exists "drawings_select_by_project_access" on public.drawings;

create policy "drawings_select_by_project_access"
on public.drawings for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
  )
  and (
    public.is_company_admin()
    or (
      is_published = true
      and public.can_view_project_blueprints(project_id)
    )
  )
);

-- Storage: same gate as DB rows (path: {company_id}/{project_id}/...)
drop policy if exists "drawings_bucket_select_same_company" on storage.objects;
drop policy if exists "drawings_bucket_select_blueprint_access" on storage.objects;

create policy "drawings_bucket_select_blueprint_access"
on storage.objects for select
using (
  bucket_id = 'drawings'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
  and public.can_view_project_blueprints(split_part(name, '/', 2)::uuid)
);

-- Published overlays on drawings: align with blueprint visibility.
drop policy if exists "drawing_overlays_select_by_project_access" on public.drawing_overlays;
create policy "drawing_overlays_select_by_project_access"
on public.drawing_overlays for select
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
  and (
    created_by = auth.uid()
    or (
      is_published = true
      and (
        visibility_scope = 'all'
        or (visibility_scope = 'admins' and public.is_company_admin())
      )
    )
  )
);

drop policy if exists "drawing_overlays_insert_by_project_access" on public.drawing_overlays;
create policy "drawing_overlays_insert_by_project_access"
on public.drawing_overlays for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
);

drop policy if exists "drawing_overlays_update_by_creator_or_admin" on public.drawing_overlays;
create policy "drawing_overlays_update_by_creator_or_admin"
on public.drawing_overlays for update
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
  and (created_by = auth.uid() or public.is_company_admin())
)
with check (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
  and (created_by = auth.uid() or public.is_company_admin())
);

drop policy if exists "drawing_overlays_delete_by_creator_or_admin" on public.drawing_overlays;
create policy "drawing_overlays_delete_by_creator_or_admin"
on public.drawing_overlays for delete
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
      and public.can_view_project_blueprints(p.id)
  )
  and (created_by = auth.uid() or public.is_company_admin())
);
