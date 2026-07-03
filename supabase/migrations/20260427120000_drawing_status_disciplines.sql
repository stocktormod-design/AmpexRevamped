-- Add drawing_status and disciplines to drawings.
-- drawing_status: 'draft' | 'official' | 'archived'
-- disciplines: text array of assigned discipline tags

alter table public.drawings
  add column if not exists drawing_status text not null default 'draft'
    check (drawing_status in ('draft', 'official', 'archived'));

-- Backfill from existing is_published flag
update public.drawings
  set drawing_status = case when is_published then 'official' else 'draft' end;

alter table public.drawings
  add column if not exists disciplines text[] not null default '{}';

create index if not exists idx_drawings_project_status_created
  on public.drawings (project_id, drawing_status, created_at desc);

-- Replace select policy: non-admins see only official (not archived/draft)
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
    or drawing_status = 'official'
  )
);
