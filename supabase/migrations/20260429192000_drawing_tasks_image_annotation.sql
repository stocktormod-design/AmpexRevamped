alter table public.drawing_tasks
  add column if not exists image_path text,
  add column if not exists image_annotation jsonb;
