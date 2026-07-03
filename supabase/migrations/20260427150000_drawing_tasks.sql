-- Per-drawing checklist tasks (separate from overlay geometry).
create table if not exists public.drawing_tasks (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  title text not null,
  description text,
  sort_order int not null default 0,
  completed_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_drawing_tasks_drawing_sort
  on public.drawing_tasks (drawing_id, sort_order, created_at);

drop trigger if exists trg_drawing_tasks_set_updated_at on public.drawing_tasks;
create trigger trg_drawing_tasks_set_updated_at
before update on public.drawing_tasks
for each row
execute function public.set_updated_at();

alter table public.drawing_tasks enable row level security;

-- Match drawing visibility: same logic as drawings_select_by_project_access
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
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);

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
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);

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
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);

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
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);
