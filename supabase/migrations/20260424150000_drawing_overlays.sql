-- Overlay annotations for drawing paint view.

create table if not exists public.drawing_overlays (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  tool_type text not null check (tool_type in ('detector', 'line', 'rect', 'text')),
  layer_name text not null default 'Lag 1',
  layer_color text not null default '#ef4444',
  payload jsonb not null,
  is_published boolean not null default false,
  visibility_scope text not null default 'all' check (visibility_scope in ('all', 'admins')),
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_drawing_overlays_drawing_published
  on public.drawing_overlays (drawing_id, is_published, created_at);

create index if not exists idx_drawing_overlays_created_by
  on public.drawing_overlays (created_by);

drop trigger if exists trg_drawing_overlays_set_updated_at on public.drawing_overlays;
create trigger trg_drawing_overlays_set_updated_at
before update on public.drawing_overlays
for each row
execute function public.set_updated_at();

alter table public.drawing_overlays enable row level security;

create policy "drawing_overlays_select_by_project_access"
on public.drawing_overlays
for select
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
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

create policy "drawing_overlays_insert_by_project_access"
on public.drawing_overlays
for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
  )
);

create policy "drawing_overlays_update_by_creator_or_admin"
on public.drawing_overlays
for update
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
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
  )
  and (created_by = auth.uid() or public.is_company_admin())
);

create policy "drawing_overlays_delete_by_creator_or_admin"
on public.drawing_overlays
for delete
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_id
      and public.can_access_project(p.id)
  )
  and (created_by = auth.uid() or public.is_company_admin())
);
