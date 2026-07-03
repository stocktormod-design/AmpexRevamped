-- Montør (tidligere worker) + lærling; unik strekkode per lager

do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'worker'
  ) then
    alter type public.app_role rename value 'worker' to 'montor';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'apprentice'
  ) then
    alter type public.app_role add value 'apprentice';
  end if;
end $$;

alter table public.profiles
  alter column role set default 'montor'::public.app_role;

create unique index if not exists warehouse_items_wh_barcode_unique
on public.warehouse_items (warehouse_id, lower(btrim(barcode)))
where barcode is not null and length(btrim(barcode)) > 0;
