-- Prosjektchat: tekst + bilder for alle med prosjekttilgang

create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text,
  image_path text,
  created_at timestamptz not null default now(),
  constraint project_messages_body_or_image check (
    (body is not null and length(trim(body)) > 0)
    or (image_path is not null and length(trim(image_path)) > 0)
  )
);

create index if not exists idx_project_messages_project_created
  on public.project_messages (project_id, created_at desc);

comment on table public.project_messages is
  'Prosjektchat — synlig for alle med can_access_project.';

alter table public.project_messages enable row level security;

drop policy if exists "project_messages_select" on public.project_messages;
create policy "project_messages_select"
on public.project_messages for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.can_access_project(p.id)
  )
);

drop policy if exists "project_messages_insert" on public.project_messages;
create policy "project_messages_insert"
on public.project_messages for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.can_access_project(p.id)
  )
);

-- Storage bucket: {company_id}/{project_id}/{filename}
insert into storage.buckets (id, name, public)
values ('project-chat', 'project-chat', false)
on conflict (id) do nothing;

drop policy if exists "project_chat_bucket_select" on storage.objects;
create policy "project_chat_bucket_select"
on storage.objects for select
using (
  bucket_id = 'project-chat'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
  and public.can_access_project(split_part(name, '/', 2)::uuid)
);

drop policy if exists "project_chat_bucket_insert" on storage.objects;
create policy "project_chat_bucket_insert"
on storage.objects for insert
with check (
  bucket_id = 'project-chat'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
  and public.can_access_project(split_part(name, '/', 2)::uuid)
);

drop policy if exists "project_chat_bucket_delete_admin" on storage.objects;
create policy "project_chat_bucket_delete_admin"
on storage.objects for delete
using (
  bucket_id = 'project-chat'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
  and public.is_company_admin()
);
