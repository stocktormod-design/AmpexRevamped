-- Risk Assessment Modules: company-defined reusable checklist modules

create table if not exists public.risk_assessment_modules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.risk_assessment_module_items (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.risk_assessment_modules(id) on delete cascade,
  text text not null,
  is_required boolean not null default false,
  sort_order integer not null default 0
);

create index if not exists idx_ram_company_id on public.risk_assessment_modules(company_id);
create index if not exists idx_rami_module_id on public.risk_assessment_module_items(module_id);

alter table public.risk_assessment_modules enable row level security;
alter table public.risk_assessment_module_items enable row level security;

create policy "ram_select_same_company"
on public.risk_assessment_modules for select
using (company_id = public.get_user_company_id());

create policy "ram_write_privileged"
on public.risk_assessment_modules for all
using (
  company_id = public.get_user_company_id()
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'admin', 'installator')
  )
)
with check (
  company_id = public.get_user_company_id()
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'admin', 'installator')
  )
);

create policy "rami_select_same_company"
on public.risk_assessment_module_items for select
using (
  exists (
    select 1 from public.risk_assessment_modules m
    where m.id = module_id
    and m.company_id = public.get_user_company_id()
  )
);

create policy "rami_write_privileged"
on public.risk_assessment_module_items for all
using (
  exists (
    select 1 from public.risk_assessment_modules m
    where m.id = module_id
    and m.company_id = public.get_user_company_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner', 'admin', 'installator')
    )
  )
)
with check (
  exists (
    select 1 from public.risk_assessment_modules m
    where m.id = module_id
    and m.company_id = public.get_user_company_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner', 'admin', 'installator')
    )
  )
);
