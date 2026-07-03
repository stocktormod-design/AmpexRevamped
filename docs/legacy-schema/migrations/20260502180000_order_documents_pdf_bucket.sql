-- Private PDF storage for filled order documentation (per order + section_key).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-documents',
  'order-documents',
  false,
  12582912,
  array['application/pdf']::text[]
)
on conflict (id) do nothing;

create policy "order_documents_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'order-documents');

create policy "order_documents_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'order-documents');

create policy "order_documents_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'order-documents')
  with check (bucket_id = 'order-documents');

create policy "order_documents_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'order-documents');
