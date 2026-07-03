alter table public.supplier_products
  add column if not exists fdv_url text;

comment on column public.supplier_products.fdv_url is
  'Direkte lenke til FDV/datablad for varen hos grossist. Faller tilbake til products.fdv_url via product_id.';
