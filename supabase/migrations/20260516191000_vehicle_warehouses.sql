-- Bil-lager: lager pr. registreringsnummer + valgfri tilordning av selskapsbrukere per bil/varelinje.

alter table public.warehouses
  add column if not exists kind text not null default 'standard';

alter table public.warehouses
  drop constraint if exists warehouses_kind_check;

alter table public.warehouses
  add constraint warehouses_kind_check
  check (kind in ('standard', 'vehicle'));

comment on column public.warehouses.kind is
  'standard: vanlig strekkode-lager; vehicle: bil-lager der koder i warehouse_item_barcodes er reg.nr.';

alter table public.warehouse_items
  add column if not exists assigned_user_ids uuid[];

comment on column public.warehouse_items.assigned_user_ids is
  'Brukere tilordnet varen/bilen (må være profiler i samme company_id; valideres i applikasjon).';
