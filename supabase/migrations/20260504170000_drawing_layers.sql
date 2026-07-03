-- Multi-discipline layer stack per drawing + discipline-aligned room status.

create table if not exists public.drawing_layers (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  discipline text not null check (discipline in ('arkitekt', 'brann', 'elkraft', 'tele', 'automasjon', 'belysning')),
  file_path text not null,
  display_order int not null default 0,
  visible boolean not null default true,
  opacity real not null default 1.0 check (opacity >= 0 and opacity <= 1),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drawing_layers_unique_discipline_per_drawing unique (drawing_id, discipline)
);

create index if not exists idx_drawing_layers_drawing on public.drawing_layers (drawing_id, display_order);
create index if not exists idx_drawing_layers_discipline on public.drawing_layers (discipline);

drop trigger if exists trg_drawing_layers_set_updated_at on public.drawing_layers;
create trigger trg_drawing_layers_set_updated_at
before update on public.drawing_layers
for each row
execute function public.set_updated_at();

alter table public.drawing_layers enable row level security;

create policy "drawing_layers_select"
on public.drawing_layers for select
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_layers.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.can_access_project(p.id)
  )
);

create policy "drawing_layers_insert"
on public.drawing_layers for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_layers.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "drawing_layers_update"
on public.drawing_layers for update
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_layers.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
)
with check (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_layers.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

create policy "drawing_layers_delete"
on public.drawing_layers for delete
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_layers.drawing_id
      and p.company_id = public.get_user_company_id()
      and public.is_company_privileged()
  )
);

-- room status discipline migration (old values -> new discipline names)
update public.drawing_room_status set discipline = 'brann' where discipline = 'fire';
update public.drawing_room_status set discipline = 'elkraft' where discipline in ('power', 'all');
update public.drawing_room_status set discipline = 'tele' where discipline = 'low_voltage';

alter table public.drawing_room_status
  drop constraint if exists drawing_room_status_discipline;
alter table public.drawing_room_status
  add constraint drawing_room_status_discipline
  check (discipline in ('brann', 'elkraft', 'tele', 'automasjon', 'belysning'));

alter table public.drawing_room_status
  add column if not exists progress int not null default 0 check (progress >= 0 and progress <= 100);

alter table public.drawing_room_status
  drop constraint if exists drawing_room_status_status;
alter table public.drawing_room_status
  add constraint drawing_room_status_status
  check (status in ('not_started', 'in_progress', 'completed'));

update public.drawing_room_status set status = 'completed' where status = 'done';
update public.drawing_room_status set status = 'in_progress' where status = 'issues';

