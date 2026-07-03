-- HR: ferie og fravær + avdeling på profil (grunnlag for månedlig avdelingsfaktura).

alter table public.profiles
  add column if not exists department text;

comment on column public.profiles.department is
  'Valgfri avdeling/team for HR og fakturering (f.eks. «Elektro Øst»).';

create table if not exists public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  total_days numeric(6, 2) not null,
  comment text,
  status text not null default 'pending',
  processed_by uuid references public.profiles (id) on delete set null,
  processed_at timestamptz,
  admin_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_leave_requests_dates_valid check (end_date >= start_date),
  constraint hr_leave_requests_total_days_positive check (total_days > 0),
  constraint hr_leave_requests_leave_type_check check (
    leave_type in ('vacation', 'sick_leave', 'self_certified')
  ),
  constraint hr_leave_requests_status_check check (
    status in ('pending', 'approved', 'rejected')
  )
);

create index if not exists idx_hr_leave_requests_company_status
  on public.hr_leave_requests (company_id, status, created_at desc);

create index if not exists idx_hr_leave_requests_user_created
  on public.hr_leave_requests (user_id, created_at desc);

comment on table public.hr_leave_requests is
  'Ferie, sykemelding og egenmelding — godkjennes av HR/ledelse.';

drop trigger if exists trg_hr_leave_requests_set_updated_at on public.hr_leave_requests;
create trigger trg_hr_leave_requests_set_updated_at
before update on public.hr_leave_requests
for each row execute function public.set_updated_at();

create or replace function public.can_manage_hr_leave()
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
      and p.role::text in ('owner', 'admin', 'regnskapsforer')
  );
$$;

alter table public.hr_leave_requests enable row level security;

drop policy if exists "hr_leave_requests_select" on public.hr_leave_requests;
create policy "hr_leave_requests_select"
on public.hr_leave_requests for select to authenticated
using (
  company_id = public.get_user_company_id()
  and (user_id = auth.uid() or public.can_manage_hr_leave())
);

drop policy if exists "hr_leave_requests_insert_own" on public.hr_leave_requests;
create policy "hr_leave_requests_insert_own"
on public.hr_leave_requests for insert to authenticated
with check (
  company_id = public.get_user_company_id()
  and user_id = auth.uid()
  and status = 'pending'
);

drop policy if exists "hr_leave_requests_update_hr" on public.hr_leave_requests;
create policy "hr_leave_requests_update_hr"
on public.hr_leave_requests for update to authenticated
using (
  company_id = public.get_user_company_id()
  and public.can_manage_hr_leave()
)
with check (company_id = public.get_user_company_id());

grant execute on function public.can_manage_hr_leave() to authenticated;
