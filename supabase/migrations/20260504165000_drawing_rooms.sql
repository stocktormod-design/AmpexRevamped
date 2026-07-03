-- Room zones and discipline-aware room status per drawing.

create table if not exists public.drawing_rooms (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  name text not null,
  geometry jsonb not null,
  sort_order int not null default 0,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drawing_rooms_name_len check (char_length(name) between 1 and 120),
  constraint drawing_rooms_geometry_type check (jsonb_typeof(geometry) = 'object')
);

create index if not exists idx_drawing_rooms_drawing_sort
  on public.drawing_rooms (drawing_id, sort_order, created_at);

create table if not exists public.drawing_room_status (
  id uuid primary key default gen_random_uuid(),
  drawing_room_id uuid not null references public.drawing_rooms (id) on delete cascade,
  discipline text not null default 'all',
  status text not null default 'not_started',
  task_total int not null default 0,
  task_completed int not null default 0,
  issue_count int not null default 0,
  notes text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint drawing_room_status_discipline check (
    discipline in ('all', 'fire', 'power', 'low_voltage', 'automation')
  ),
  constraint drawing_room_status_status check (
    status in ('not_started', 'in_progress', 'issues', 'done')
  ),
  constraint drawing_room_status_counts_non_negative check (
    task_total >= 0 and task_completed >= 0 and issue_count >= 0 and task_completed <= task_total
  ),
  constraint drawing_room_status_unique_room_discipline unique (drawing_room_id, discipline)
);

create index if not exists idx_drawing_room_status_room
  on public.drawing_room_status (drawing_room_id, discipline);

drop trigger if exists trg_drawing_rooms_set_updated_at on public.drawing_rooms;
create trigger trg_drawing_rooms_set_updated_at
before update on public.drawing_rooms
for each row
execute function public.set_updated_at();

drop trigger if exists trg_drawing_room_status_set_updated_at on public.drawing_room_status;
create trigger trg_drawing_room_status_set_updated_at
before update on public.drawing_room_status
for each row
execute function public.set_updated_at();

alter table public.drawing_rooms enable row level security;
alter table public.drawing_room_status enable row level security;

create policy "drawing_rooms_select"
on public.drawing_rooms for select
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_rooms.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.can_access_project(p.id)
  )
);

create policy "drawing_rooms_insert"
on public.drawing_rooms for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_rooms.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "drawing_rooms_update"
on public.drawing_rooms for update
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_rooms.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
)
with check (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_rooms.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "drawing_rooms_delete"
on public.drawing_rooms for delete
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_rooms.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "drawing_room_status_select"
on public.drawing_room_status for select
using (
  exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = drawing_room_status.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.can_access_project(p.id)
  )
);

create policy "drawing_room_status_insert"
on public.drawing_room_status for insert
with check (
  (updated_by is null or updated_by = auth.uid())
  and exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = drawing_room_status.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "drawing_room_status_update"
on public.drawing_room_status for update
using (
  exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = drawing_room_status.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
)
with check (
  (updated_by is null or updated_by = auth.uid())
  and exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = drawing_room_status.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "drawing_room_status_delete"
on public.drawing_room_status for delete
using (
  exists (
    select 1
    from public.drawing_rooms r
    join public.drawings d on d.id = r.drawing_id
    join public.projects p on p.id = d.project_id
    where r.id = drawing_room_status.drawing_room_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);
