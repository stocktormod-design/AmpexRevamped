-- Replace coarse visibility_scope ('all'|'admins') with per-user allowlists.
-- visible_to_user_ids = null  → visible to all users who have project blueprint access
-- visible_to_user_ids = [...]  → visible only to those specific users (+ always self + admins)
-- Same semantics added to drawings.

-- ── drawing_overlays ──────────────────────────────────────────────────────────
alter table public.drawing_overlays
  add column if not exists visible_to_user_ids uuid[];

-- Må fjerne policy som refererer til visibility_scope før kolonnen kan droppes.
drop policy if exists "drawing_overlays_select_by_project_access" on public.drawing_overlays;

alter table public.drawing_overlays
  drop column if exists visibility_scope;

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
        or auth.uid() = any(visible_to_user_ids)
      )
    )
  )
);

-- ── drawings ─────────────────────────────────────────────────────────────────
alter table public.drawings
  add column if not exists visible_to_user_ids uuid[];

-- Update drawings select policy to honour per-drawing allowlist
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
    or uploaded_by = auth.uid()
    or (
      is_published = true
      and public.can_view_project_blueprints(project_id)
      and (
        visible_to_user_ids is null
        or auth.uid() = any(visible_to_user_ids)
      )
    )
  )
);
