-- Fryste ordre-PDF-er (R2-sti) + firmaskille på storage-buckets.

alter table public.order_documentation
  add column if not exists r2_frozen_path text,
  add column if not exists frozen_at timestamptz;

comment on column public.order_documentation.r2_frozen_path is
  'Cloudflare R2-nøkkel: archived-orders/{company_id}/{order_id}/{section_key}.pdf';
comment on column public.order_documentation.frozen_at is
  'Tidsstempel når PDF ble bakt og lastet til R2 (uforanderlig arkiv).';

create index if not exists idx_order_documentation_frozen_at
  on public.order_documentation (order_id)
  where frozen_at is not null;

-- ── Storage: order-documents (sti: {company_id}/{order_id}/...) ──

drop policy if exists "order_documents_storage_select" on storage.objects;
create policy "order_documents_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-documents'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

drop policy if exists "order_documents_storage_insert" on storage.objects;
create policy "order_documents_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-documents'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

drop policy if exists "order_documents_storage_update" on storage.objects;
create policy "order_documents_storage_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'order-documents'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
)
with check (
  bucket_id = 'order-documents'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

drop policy if exists "order_documents_storage_delete" on storage.objects;
create policy "order_documents_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-documents'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

-- ── Storage: order-scans (sti: {company_id}/{order_id}/...) ──

drop policy if exists "order_scans_storage_select" on storage.objects;
create policy "order_scans_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-scans'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

drop policy if exists "order_scans_storage_insert" on storage.objects;
create policy "order_scans_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-scans'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

drop policy if exists "order_scans_storage_update" on storage.objects;
create policy "order_scans_storage_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'order-scans'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
)
with check (
  bucket_id = 'order-scans'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);

drop policy if exists "order_scans_storage_delete" on storage.objects;
create policy "order_scans_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-scans'
  and split_part(name, '/', 1) = public.get_user_company_id()::text
);
