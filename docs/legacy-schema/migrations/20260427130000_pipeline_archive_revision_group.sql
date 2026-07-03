-- Replaces the single drawing_status bucket with two independent axes:
--   pipeline    ('draft' | 'official')  — which workflow the drawing belongs to
--   is_archived (boolean)               — hidden from default views, preserves pipeline
--   revision_group_id (uuid, nullable)  — groups drawings that are versions of the same plan
--
-- drawing_status and is_published are kept in sync for backward compatibility.

alter table public.drawings
  add column if not exists pipeline text not null default 'draft'
    check (pipeline in ('draft', 'official')),
  add column if not exists is_archived boolean not null default false,
  add column if not exists revision_group_id uuid;

-- Backfill pipeline and is_archived from drawing_status (set by previous migration),
-- with fallback to is_published for any rows not yet touched.
update public.drawings set
  pipeline = case
    when drawing_status = 'official' then 'official'
    when drawing_status = 'archived' then 'official'
    when is_published = true         then 'official'
    else 'draft'
  end,
  is_archived = case
    when drawing_status = 'archived' then true
    else false
  end;

-- Assign revision_group_id to existing official drawings by project + name.
-- Each distinct (project_id, lower(name)) group of official drawings shares a UUID.
do $$
declare
  r   record;
  gid uuid;
begin
  for r in
    select distinct project_id, lower(trim(name)) as base_name
    from public.drawings
    where pipeline = 'official'
  loop
    gid := gen_random_uuid();
    update public.drawings
      set revision_group_id = gid
    where project_id   = r.project_id
      and lower(trim(name)) = r.base_name
      and pipeline = 'official';
  end loop;
end;
$$;

-- Re-sync is_published and drawing_status to match the new fields
update public.drawings set
  is_published   = (pipeline = 'official' and is_archived = false),
  drawing_status = case
    when is_archived then 'archived'
    when pipeline = 'official' then 'official'
    else 'draft'
  end;

-- Fix the drawing_overlays tool_type constraint (was missing 'point')
alter table public.drawing_overlays
  drop constraint if exists drawing_overlays_tool_type_check;

alter table public.drawing_overlays
  add constraint drawing_overlays_tool_type_check
    check (tool_type in ('detector', 'point', 'line', 'rect', 'text'));

-- Index for project page query patterns
create index if not exists idx_drawings_project_pipeline_archived
  on public.drawings (project_id, pipeline, is_archived, created_at desc);

-- Update select policy: non-admins see only official + not-archived
drop policy if exists "drawings_select_by_project_access" on public.drawings;

create policy "drawings_select_by_project_access"
on public.drawings
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.can_access_project(p.id)
  )
  and (
    public.is_company_admin()
    or (pipeline = 'official' and is_archived = false)
  )
);
