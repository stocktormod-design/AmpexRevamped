-- Order-level LiDAR scans + public 3D share links (customer view / signature).

create table if not exists public.order_lidar_scans (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  storage_path text not null,
  status text not null default 'uploading',
  created_at timestamptz not null default now(),
  constraint order_lidar_scans_status_check check (
    status in ('uploading', 'ready', 'failed')
  )
);

create index if not exists idx_order_lidar_scans_order
  on public.order_lidar_scans (order_id, created_at desc);
create index if not exists idx_order_lidar_scans_company
  on public.order_lidar_scans (company_id);

alter table public.order_lidar_scans enable row level security;

create policy order_lidar_scans_select on public.order_lidar_scans
  for select to authenticated
  using (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
  );

create policy order_lidar_scans_insert on public.order_lidar_scans
  for insert to authenticated
  with check (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
  );

create policy order_lidar_scans_update on public.order_lidar_scans
  for update to authenticated
  using (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
  )
  with check (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
  );

create policy order_lidar_scans_delete on public.order_lidar_scans
  for delete to authenticated
  using (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
    and (
      (select role from public.profiles where id = auth.uid() limit 1) in ('owner', 'admin')
      or uploaded_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Public share links (unguessable UUID in URL; RLS for anon read/sign)
-- ---------------------------------------------------------------------------

create table if not exists public.public_share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  room_id uuid references public.drawing_rooms (id) on delete cascade,
  gltf_storage_path text not null,
  require_signature boolean not null default false,
  is_signed boolean not null default false,
  signed_by_name text,
  signature_svg text,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  constraint public_share_links_target_check check (
    order_id is not null or room_id is not null
  ),
  constraint public_share_links_signature_check check (
    (is_signed = false and signed_by_name is null and signature_svg is null and signed_at is null)
    or (
      is_signed = true
      and signed_by_name is not null
      and length(trim(signed_by_name)) > 0
      and signature_svg is not null
      and length(trim(signature_svg)) > 0
      and signed_at is not null
    )
  )
);

create index if not exists idx_public_share_links_order
  on public.public_share_links (order_id)
  where order_id is not null;

alter table public.public_share_links enable row level security;

-- Company staff: manage links for own tenant
create policy public_share_links_staff_select on public.public_share_links
  for select to authenticated
  using (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
  );

create policy public_share_links_staff_insert on public.public_share_links
  for insert to authenticated
  with check (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
  );

create policy public_share_links_staff_update on public.public_share_links
  for update to authenticated
  using (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
  )
  with check (
    company_id = (
      select company_id from public.profiles where id = auth.uid() limit 1
    )
  );

-- Anonymous: read any row when querying by primary key (UUID secrecy is the gate).
-- Avoid listing without filter in client code.
create policy public_share_links_anon_select on public.public_share_links
  for select to anon
  using (true);

-- Anonymous: sign only when signature required and not yet signed.
create policy public_share_links_anon_update_sign on public.public_share_links
  for update to anon
  using (require_signature = true and is_signed = false)
  with check (
    require_signature = true
    and is_signed = true
    and signed_by_name is not null
    and signature_svg is not null
    and signed_at is not null
  );

grant select, update on public.public_share_links to anon;

-- ---------------------------------------------------------------------------
-- Storage: order-scans bucket
-- Path: {company_id}/{order_id}/{uuid}.{ext}
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-scans',
  'order-scans',
  false,
  524288000,
  array[
    'model/gltf-binary',
    'model/gltf+json',
    'model/vnd.usdz+zip',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy order_scans_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'order-scans');

create policy order_scans_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'order-scans');

create policy order_scans_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'order-scans')
  with check (bucket_id = 'order-scans');

create policy order_scans_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'order-scans');
