-- Protocols: company-wide documents with acknowledgement tracking

-- Categories
create table if not exists public.protocol_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint protocol_categories_name_company_unique unique (company_id, name)
);

create index if not exists idx_protocol_categories_company_id
  on public.protocol_categories (company_id);

-- Protocols
create table if not exists public.protocols (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  category_id uuid references public.protocol_categories (id) on delete set null,
  name text not null,
  description text,
  file_path text not null,
  content_text text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_protocols_company_id
  on public.protocols (company_id);

create index if not exists idx_protocols_category_id
  on public.protocols (category_id);

drop trigger if exists trg_protocols_set_updated_at on public.protocols;
create trigger trg_protocols_set_updated_at
before update on public.protocols
for each row
execute function public.set_updated_at();

-- Acknowledgements (one per user per protocol)
create table if not exists public.protocol_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  constraint protocol_acknowledgements_unique unique (protocol_id, user_id)
);

create index if not exists idx_protocol_acks_protocol_id
  on public.protocol_acknowledgements (protocol_id);

create index if not exists idx_protocol_acks_user_id
  on public.protocol_acknowledgements (user_id);

-- RLS

alter table public.protocol_categories enable row level security;
alter table public.protocols enable row level security;
alter table public.protocol_acknowledgements enable row level security;

-- protocol_categories: company members can read; only admins can write
create policy "protocol_categories_select"
on public.protocol_categories for select
using (company_id = public.get_user_company_id());

create policy "protocol_categories_insert"
on public.protocol_categories for insert
with check (company_id = public.get_user_company_id() and public.is_company_admin());

create policy "protocol_categories_delete"
on public.protocol_categories for delete
using (company_id = public.get_user_company_id() and public.is_company_admin());

-- protocols: company members can read; only admins can write
create policy "protocols_select"
on public.protocols for select
using (company_id = public.get_user_company_id());

create policy "protocols_insert"
on public.protocols for insert
with check (company_id = public.get_user_company_id() and public.is_company_admin());

create policy "protocols_update"
on public.protocols for update
using (company_id = public.get_user_company_id() and public.is_company_admin());

create policy "protocols_delete"
on public.protocols for delete
using (company_id = public.get_user_company_id() and public.is_company_admin());

-- protocol_acknowledgements: users can read acks for protocols in their company;
--   can create/view their own acks; admins can view all
create policy "protocol_acks_select"
on public.protocol_acknowledgements for select
using (
  exists (
    select 1 from public.protocols p
    where p.id = protocol_id
      and p.company_id = public.get_user_company_id()
  )
  and (
    user_id = auth.uid()
    or public.is_company_admin()
  )
);

create policy "protocol_acks_insert"
on public.protocol_acknowledgements for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.protocols p
    where p.id = protocol_id
      and p.company_id = public.get_user_company_id()
  )
);

-- Storage bucket for protocols (create via Supabase Storage or admin API)
-- Run separately in Supabase Studio if needed:
-- insert into storage.buckets (id, name, public) values ('protocols', 'protocols', false)
-- on conflict do nothing;
