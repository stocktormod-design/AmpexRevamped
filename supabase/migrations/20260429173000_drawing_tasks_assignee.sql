-- Allow assigning drawing tasks to specific project members.
alter table public.drawing_tasks
  add column if not exists assigned_to uuid references public.profiles (id) on delete set null;

create index if not exists idx_drawing_tasks_assigned_to
  on public.drawing_tasks (assigned_to);
