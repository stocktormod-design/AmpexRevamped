-- AMPEX REVAMP — fundament (clean start 2026-07-03)
-- Konvensjon for ALLE domenetabeller (kreves av WatermelonDB-synk):
--   id uuid PRIMARY KEY            (klient-generert, aldri serial)
--   company_id uuid NOT NULL       (RLS-grense)
--   created_at / updated_at        (updated_at auto-touch = synk-cursor)
--   deleted_at                     (soft delete — aldri DELETE)

create extension if not exists pgcrypto;

create type public.app_role as enum
  ('owner', 'admin', 'bas', 'installator', 'montor', 'laerling', 'regnskapsforer');

-- Auto-touch updated_at ved enhver UPDATE (synk-cursor for pull)
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── companies ────────────────────────────────────────────────────────────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_number text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger companies_touch
  before update on public.companies
  for each row execute function public.touch_updated_at();

-- ── profiles ─────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id),
  role public.app_role not null default 'montor',
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Innloggets brukers firma — security definer så RLS-policies kan bruke den
-- uten rekursjon mot profiles.
create or replace function public.current_company_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.companies enable row level security;
alter table public.profiles enable row level security;

create policy companies_member_select on public.companies
  for select using (id = public.current_company_id());

create policy profiles_company_select on public.profiles
  for select using (id = auth.uid() or company_id = public.current_company_id());

create policy profiles_self_update on public.profiles
  for update using (id = auth.uid());

-- ── Profil auto-opprettes ved signup ────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
