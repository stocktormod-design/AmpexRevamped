-- Kursbevis per bruker + avvik med historikk og arkiv i storage (S3 via Supabase).

create table if not exists public.course_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  course_name text,
  issued_on date,
  file_path text not null,
  mime_type text not null default 'application/pdf',
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_course_certificates_user
  on public.course_certificates (company_id, user_id, created_at desc);

create table if not exists public.deviations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'archived')),
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high')),
  project_id uuid references public.projects (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  reported_by uuid not null references public.profiles (id),
  assigned_to uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  archived_at timestamptz,
  archive_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deviations_company_status
  on public.deviations (company_id, status, created_at desc);

create table if not exists public.deviation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  deviation_id uuid not null references public.deviations (id) on delete cascade,
  event_type text not null
    check (event_type in ('created', 'comment', 'status_changed', 'assigned', 'archived')),
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_deviation_events_deviation
  on public.deviation_events (deviation_id, created_at asc);

drop trigger if exists deviations_set_updated_at on public.deviations;
create trigger deviations_set_updated_at
  before update on public.deviations
  for each row execute function public.set_updated_at();

-- Storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'course-certificates',
    'course-certificates',
    false,
    12582912,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'deviation-archives',
    'deviation-archives',
    false,
    5242880,
    array['application/json']::text[]
  )
on conflict (id) do nothing;

create policy "course_certificates_storage_select" on storage.objects
  for select to authenticated using (bucket_id = 'course-certificates');

create policy "course_certificates_storage_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'course-certificates');

create policy "course_certificates_storage_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'course-certificates');

create policy "deviation_archives_storage_select" on storage.objects
  for select to authenticated using (bucket_id = 'deviation-archives');

create policy "deviation_archives_storage_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'deviation-archives');

alter table public.course_certificates enable row level security;
alter table public.deviations enable row level security;
alter table public.deviation_events enable row level security;

create policy "course_certificates_select_company"
  on public.course_certificates for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "course_certificates_insert"
  on public.course_certificates for insert to authenticated
  with check (
    company_id = public.get_user_company_id()
    and (
      user_id = auth.uid()
      or public.is_company_admin()
      or exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.role in ('baas', 'admin', 'owner')
      )
    )
  );

create policy "course_certificates_delete"
  on public.course_certificates for delete to authenticated
  using (
    company_id = public.get_user_company_id()
    and (user_id = auth.uid() or public.is_company_admin())
  );

create policy "deviations_select_company"
  on public.deviations for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "deviations_insert_company"
  on public.deviations for insert to authenticated
  with check (
    company_id = public.get_user_company_id()
    and reported_by = auth.uid()
  );

create policy "deviations_update_company"
  on public.deviations for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "deviation_events_select_company"
  on public.deviation_events for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "deviation_events_insert_company"
  on public.deviation_events for insert to authenticated
  with check (company_id = public.get_user_company_id());
