-- Prosjektleder per prosjekt (assignment_role) + master aktivitetslogg.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'project_assignment_role'
  ) then
    create type public.project_assignment_role as enum ('member', 'prosjektleder');
  end if;
end $$;

alter table public.project_assignments
  add column if not exists assignment_role public.project_assignment_role not null default 'member';

create index if not exists idx_project_assignments_prosjektleder
  on public.project_assignments (project_id)
  where assignment_role = 'prosjektleder';

create table if not exists public.project_activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  summary text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_activity_log_project_created
  on public.project_activity_log (project_id, created_at desc);

alter table public.project_activity_log enable row level security;

-- Les: baas/admin/owner eller prosjektleder på prosjektet, innen samme firma
create policy "project_activity_log_select"
on public.project_activity_log for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_activity_log.project_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_privileged()
        or exists (
          select 1
          from public.project_assignments pa
          where pa.project_id = p.id
            and pa.user_id = auth.uid()
            and pa.assignment_role = 'prosjektleder'
        )
      )
  )
);

grant select on public.project_activity_log to authenticated;
