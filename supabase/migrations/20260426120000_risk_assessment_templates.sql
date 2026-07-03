-- Reusable risk assessment templates per company.

create table if not exists public.risk_assessment_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create index if not exists idx_risk_assessment_templates_company_id
  on public.risk_assessment_templates(company_id);

alter table public.risk_assessment_templates enable row level security;

drop policy if exists "rat_select_same_company" on public.risk_assessment_templates;
create policy "rat_select_same_company"
on public.risk_assessment_templates for select
using (company_id = public.get_user_company_id());

drop policy if exists "rat_write_privileged" on public.risk_assessment_templates;
create policy "rat_write_privileged"
on public.risk_assessment_templates for all
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

alter table public.risk_assessment_modules
  add column if not exists template_id uuid references public.risk_assessment_templates(id) on delete cascade;

create index if not exists idx_ram_template_id
  on public.risk_assessment_modules(template_id);

alter table public.orders
  add column if not exists risk_template_id uuid references public.risk_assessment_templates(id) on delete set null;

create index if not exists idx_orders_risk_template_id
  on public.orders(risk_template_id);

-- Backfill: one default template per company and attach existing modules.
insert into public.risk_assessment_templates (company_id, name)
select distinct m.company_id, 'Standard risikomal'
from public.risk_assessment_modules m
where not exists (
  select 1
  from public.risk_assessment_templates t
  where t.company_id = m.company_id
);

update public.risk_assessment_modules m
set template_id = t.id
from public.risk_assessment_templates t
where t.company_id = m.company_id
  and m.template_id is null
  and t.name = 'Standard risikomal';

update public.orders o
set risk_template_id = t.id
from public.risk_assessment_templates t
where o.company_id = t.company_id
  and o.risk_template_id is null
  and t.name = 'Standard risikomal';
