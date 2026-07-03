-- Tom uuid[] ble tolket som «ingen har tilgang» (ANY på tom mengde er alltid false).
-- Normaliser til NULL (= alle med tegningstilgang) og oppdater RLS til samme semantikk.

update public.drawings
set visible_to_user_ids = null
where visible_to_user_ids is not null
  and cardinality(visible_to_user_ids) = 0;

update public.drawing_overlays
set visible_to_user_ids = null
where visible_to_user_ids is not null
  and cardinality(visible_to_user_ids) = 0;

drop policy if exists "drawings_select_by_project_access" on public.drawings;
create policy "drawings_select_by_project_access"
on public.drawings
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.company_id = public.get_user_company_id()
  )
  and (
    public.is_company_admin()
    or uploaded_by = auth.uid()
    or (
      is_published = true
      and public.can_view_project_blueprints(project_id)
      and (
        visible_to_user_ids is null
        or coalesce(cardinality(visible_to_user_ids), 0) = 0
        or auth.uid() = any(visible_to_user_ids)
      )
    )
  )
);

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
    or public.is_company_admin()
    or (
      is_published = true
      and (
        visible_to_user_ids is null
        or coalesce(cardinality(visible_to_user_ids), 0) = 0
        or auth.uid() = any(visible_to_user_ids)
      )
    )
  )
);

-- Samme tom-array-semantikk som for tegninger (policyene i 20260427150000_drawing_tasks.sql)
drop policy if exists "drawing_tasks_select" on public.drawing_tasks;
create policy "drawing_tasks_select"
on public.drawing_tasks for select
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_tasks.drawing_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_admin()
        or d.uploaded_by = auth.uid()
        or (
          d.is_published = true
          and public.can_view_project_blueprints(d.project_id)
          and (
            d.visible_to_user_ids is null
            or coalesce(cardinality(d.visible_to_user_ids), 0) = 0
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);

drop policy if exists "drawing_tasks_insert" on public.drawing_tasks;
create policy "drawing_tasks_insert"
on public.drawing_tasks for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_tasks.drawing_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_admin()
        or d.uploaded_by = auth.uid()
        or (
          d.is_published = true
          and public.can_view_project_blueprints(d.project_id)
          and (
            d.visible_to_user_ids is null
            or coalesce(cardinality(d.visible_to_user_ids), 0) = 0
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);

drop policy if exists "drawing_tasks_update" on public.drawing_tasks;
create policy "drawing_tasks_update"
on public.drawing_tasks for update
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_tasks.drawing_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_admin()
        or d.uploaded_by = auth.uid()
        or (
          d.is_published = true
          and public.can_view_project_blueprints(d.project_id)
          and (
            d.visible_to_user_ids is null
            or coalesce(cardinality(d.visible_to_user_ids), 0) = 0
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_tasks.drawing_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_admin()
        or d.uploaded_by = auth.uid()
        or (
          d.is_published = true
          and public.can_view_project_blueprints(d.project_id)
          and (
            d.visible_to_user_ids is null
            or coalesce(cardinality(d.visible_to_user_ids), 0) = 0
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);

drop policy if exists "drawing_tasks_delete" on public.drawing_tasks;
create policy "drawing_tasks_delete"
on public.drawing_tasks for delete
using (
  (created_by = auth.uid() or public.is_company_admin())
  and exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_tasks.drawing_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_admin()
        or d.uploaded_by = auth.uid()
        or (
          d.is_published = true
          and public.can_view_project_blueprints(d.project_id)
          and (
            d.visible_to_user_ids is null
            or coalesce(cardinality(d.visible_to_user_ids), 0) = 0
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);
