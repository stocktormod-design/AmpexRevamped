-- Draft/publish workflow for drawings.

alter table public.drawings
  add column if not exists is_published boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.profiles (id) on delete set null;

create index if not exists idx_drawings_project_publish_created
  on public.drawings (project_id, is_published, created_at desc);

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
    or is_published = true
  )
);
