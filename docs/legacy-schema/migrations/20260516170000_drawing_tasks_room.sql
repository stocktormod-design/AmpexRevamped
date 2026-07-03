-- Valgfritt rom-kobling på tegning-oppgaver (push / deep link).

alter table public.drawing_tasks
  add column if not exists drawing_room_id uuid references public.drawing_rooms (id) on delete set null;

create index if not exists idx_drawing_tasks_drawing_room_id
  on public.drawing_tasks (drawing_room_id)
  where drawing_room_id is not null;

comment on column public.drawing_tasks.drawing_room_id is
  'Rom oppgaven gjelder (valgfritt). Brukes i varsler og deep link til tegning.';
