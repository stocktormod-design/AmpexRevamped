-- Flere strekkoder per vare (f.eks. eske vs. innhold)

create table if not exists public.warehouse_item_barcodes (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  warehouse_item_id uuid not null references public.warehouse_items (id) on delete cascade,
  barcode text not null,
  barcode_normalized text generated always as (lower(btrim(barcode))) stored,
  created_at timestamptz not null default now()
);

create index if not exists idx_warehouse_item_barcodes_item_id
  on public.warehouse_item_barcodes (warehouse_item_id);

create index if not exists idx_warehouse_item_barcodes_warehouse_id
  on public.warehouse_item_barcodes (warehouse_id);

create unique index if not exists warehouse_item_barcodes_wh_norm_unique
  on public.warehouse_item_barcodes (warehouse_id, barcode_normalized)
  where length(barcode_normalized) > 0;

create or replace function public.warehouse_item_barcodes_set_wh()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  select warehouse_id into strict new.warehouse_id
  from public.warehouse_items
  where id = new.warehouse_item_id;
  return new;
end;
$$;

drop trigger if exists trg_warehouse_item_barcodes_set_wh on public.warehouse_item_barcodes;
create trigger trg_warehouse_item_barcodes_set_wh
before insert or update of warehouse_item_id on public.warehouse_item_barcodes
for each row
execute function public.warehouse_item_barcodes_set_wh();

-- Eksisterende strekkoder flyttes før kolonnen fjernes
insert into public.warehouse_item_barcodes (warehouse_id, warehouse_item_id, barcode)
select wi.warehouse_id, wi.id, btrim(wi.barcode)
from public.warehouse_items wi
where wi.barcode is not null
  and length(btrim(wi.barcode)) > 0;

drop index if exists public.warehouse_items_wh_barcode_unique;

alter table public.warehouse_items
  drop column if exists barcode;

-- RLS
alter table public.warehouse_item_barcodes enable row level security;

create policy "warehouse_item_barcodes_select_same_company"
on public.warehouse_item_barcodes
for select
using (
  exists (
    select 1
    from public.warehouses w
    where w.id = warehouse_id
      and w.company_id = public.get_user_company_id()
  )
);

create policy "warehouse_item_barcodes_write_admin_only"
on public.warehouse_item_barcodes
for all
using (
  public.is_company_admin()
  and exists (
    select 1
    from public.warehouses w
    where w.id = warehouse_id
      and w.company_id = public.get_user_company_id()
  )
)
with check (
  public.is_company_admin()
  and exists (
    select 1
    from public.warehouses w
    where w.id = warehouse_id
      and w.company_id = public.get_user_company_id()
  )
);

-- Oppfølging av strekkode uavhengig av store/små bokstaver og trim
create or replace function public.match_warehouse_barcode(p_warehouse_id uuid, p_code text)
returns table (item_id uuid, item_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select wi.id, wi.name::text
  from public.warehouse_item_barcodes wib
  join public.warehouse_items wi on wi.id = wib.warehouse_item_id
  where wib.warehouse_id = p_warehouse_id
    and wi.warehouse_id = p_warehouse_id
    and wib.barcode_normalized = lower(btrim(p_code))
  limit 1;
$$;

grant execute on function public.match_warehouse_barcode(uuid, text) to authenticated;
