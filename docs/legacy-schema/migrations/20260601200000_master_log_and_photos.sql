-- Master Log (ferdigstilte ordre) + S3-nøkkel-felter på order_photos (bucket order-photos finnes fra 20260425210000).

-- ── order_photos: s3_key / image_url (kompatibel med eksisterende file_path) ──

alter table public.order_photos
  add column if not exists s3_key text,
  add column if not exists image_url text;

update public.order_photos
set s3_key = file_path
where s3_key is null and file_path is not null;

comment on column public.order_photos.s3_key is
  'Objektsti i Supabase Storage (S3-kompatibel), f.eks. company_id/order_id/uuid.jpg';

comment on column public.order_photos.image_url is
  'Valgfri cache av offentlig/signed URL; vises via signed URL ved behov.';

create index if not exists idx_order_photos_order_id_created
  on public.order_photos (order_id, created_at desc);

drop policy if exists "order_photos_update" on public.order_photos;
create policy "order_photos_update"
on public.order_photos
for update
to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

-- ── order_master_log ──

create table if not exists public.order_master_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  order_number text,
  completed_at timestamptz not null default now(),
  completed_by uuid references public.profiles (id) on delete set null,
  completed_by_name text not null,
  customer_name text,
  total_materials_cost numeric(14, 4) not null default 0,
  total_materials_sale numeric(14, 4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_master_log_company_order_unique unique (company_id, order_id)
);

comment on table public.order_master_log is
  'Arkiv / master log over ferdigstilte ordre (når alle 5 PDF-punkter er fullført).';

create index if not exists idx_order_master_log_company_completed
  on public.order_master_log (company_id, completed_at desc);

create index if not exists idx_order_master_log_completed_by
  on public.order_master_log (company_id, completed_by);

alter table public.order_master_log enable row level security;

drop policy if exists "order_master_log_select_same_company" on public.order_master_log;
create policy "order_master_log_select_same_company"
on public.order_master_log
for select
to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "order_master_log_write_admin" on public.order_master_log;
create policy "order_master_log_write_admin"
on public.order_master_log
for all
to authenticated
using (company_id = public.get_user_company_id() and public.is_company_admin())
with check (company_id = public.get_user_company_id() and public.is_company_admin());

grant select on public.order_master_log to authenticated;
