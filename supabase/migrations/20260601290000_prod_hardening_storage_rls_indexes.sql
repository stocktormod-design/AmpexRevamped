-- Produksjonsherding: order-photos storage firmaskille + RLS-ytelsesindekser.

-- ── Storage: order-photos (sti: {company_id}/{order_id}/...) ──

drop policy if exists "order_photos_storage_select" on storage.objects;
create policy "order_photos_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-photos'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

drop policy if exists "order_photos_storage_insert" on storage.objects;
create policy "order_photos_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-photos'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

drop policy if exists "order_photos_storage_delete" on storage.objects;
create policy "order_photos_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-photos'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

-- ── RLS-ytelse: company_id-indekser (tenant-filter ved høy samtidighet) ──

create index if not exists idx_order_photos_company_id
  on public.order_photos (company_id);

create index if not exists idx_order_photos_company_order
  on public.order_photos (company_id, order_id);

-- order_hours har ikke company_id; RLS joiner via orders — støtt begge retninger:
create index if not exists idx_orders_company_id_id
  on public.orders (company_id, id);

create index if not exists idx_hr_leave_requests_company_id
  on public.hr_leave_requests (company_id);

create index if not exists idx_order_master_log_company_id
  on public.order_master_log (company_id);
