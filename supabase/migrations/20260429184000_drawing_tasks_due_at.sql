alter table public.drawing_tasks
  add column if not exists due_at timestamptz;

create index if not exists idx_drawing_tasks_due_at
  on public.drawing_tasks (due_at);
