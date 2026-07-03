-- Work-day GPS tracking + km (Del J4). company_id derived server-side from profiles.

alter table public.order_customers
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

comment on column public.order_customers.latitude is 'Optional WGS84 for proximity / kjørebok hints.';
comment on column public.order_customers.longitude is 'Optional WGS84 for proximity / kjørebok hints.';

create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sessions_ended_after_start check (
    ended_at is null or ended_at >= started_at
  )
);

create index if not exists idx_work_sessions_user_active
  on public.work_sessions (user_id, started_at desc)
  where ended_at is null;

create index if not exists idx_work_sessions_company_started
  on public.work_sessions (company_id, started_at desc);

create table if not exists public.location_samples (
  id uuid primary key default gen_random_uuid(),
  work_session_id uuid not null references public.work_sessions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision,
  speed_mps double precision,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint location_samples_lat_range check (latitude >= -90 and latitude <= 90),
  constraint location_samples_lng_range check (longitude >= -180 and longitude <= 180)
);

create index if not exists idx_location_samples_session_recorded
  on public.location_samples (work_session_id, recorded_at);

alter table public.work_sessions enable row level security;
alter table public.location_samples enable row level security;

-- Privileged roles may read team sessions/samples in same company (Del J4).
create or replace function public.can_view_team_work_tracking()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('owner', 'admin', 'baas', 'installator')
  );
$$;

drop policy if exists "work_sessions_select_own_or_privileged" on public.work_sessions;
create policy "work_sessions_select_own_or_privileged"
on public.work_sessions for select
using (
  user_id = auth.uid()
  or (
    public.can_view_team_work_tracking()
    and company_id = (select company_id from public.profiles where id = auth.uid())
  )
);

drop policy if exists "work_sessions_insert_own" on public.work_sessions;
create policy "work_sessions_insert_own"
on public.work_sessions for insert
with check (
  user_id = auth.uid()
  and company_id = (select company_id from public.profiles where id = auth.uid())
);

drop policy if exists "work_sessions_update_own" on public.work_sessions;
create policy "work_sessions_update_own"
on public.work_sessions for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "location_samples_select_own_or_privileged" on public.location_samples;
create policy "location_samples_select_own_or_privileged"
on public.location_samples for select
using (
  user_id = auth.uid()
  or (
    public.can_view_team_work_tracking()
    and company_id = (select company_id from public.profiles where id = auth.uid())
  )
);

drop policy if exists "location_samples_insert_own_active_session" on public.location_samples;
create policy "location_samples_insert_own_active_session"
on public.location_samples for insert
with check (
  user_id = auth.uid()
  and company_id = (select company_id from public.profiles where id = auth.uid())
  and exists (
    select 1
    from public.work_sessions ws
    where ws.id = location_samples.work_session_id
      and ws.user_id = auth.uid()
      and ws.ended_at is null
  )
);

drop trigger if exists trg_work_sessions_set_updated_at on public.work_sessions;
create trigger trg_work_sessions_set_updated_at
before update on public.work_sessions
for each row execute function public.set_updated_at();
