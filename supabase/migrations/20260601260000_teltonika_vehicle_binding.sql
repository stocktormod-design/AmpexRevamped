-- Teltonika FMB920: IMEI på bil-lager, aktiv bil på profil, sporingskilde på location_samples.

-- 1) Bil-lager: tracker IMEI (unik når satt)
alter table public.warehouses
  add column if not exists teltonika_imei text;

create unique index if not exists idx_warehouses_teltonika_imei_unique
  on public.warehouses (teltonika_imei)
  where teltonika_imei is not null;

comment on column public.warehouses.teltonika_imei is
  'Teltonika/Flespi device IMEI for vehicle warehouses (kind = vehicle).';

-- 2) Profil: aktiv bil (kan byttes fra dashboard; «fast bil» til daglig bruk)
alter table public.profiles
  add column if not exists active_vehicle_warehouse_id uuid references public.warehouses (id) on delete set null;

create index if not exists idx_profiles_active_vehicle_warehouse_id
  on public.profiles (active_vehicle_warehouse_id)
  where active_vehicle_warehouse_id is not null;

comment on column public.profiles.active_vehicle_warehouse_id is
  'Aktivt bil-lager (vehicle) for GPS-sporing via FMB920; flere brukere kan dele samme bil.';

-- 3) location_samples: kilde + bil
alter table public.location_samples
  add column if not exists source text,
  add column if not exists warehouse_id uuid references public.warehouses (id) on delete set null;

update public.location_samples
set source = 'phone'
where source is null;

alter table public.location_samples
  alter column source set default 'fmb920',
  alter column source set not null;

alter table public.location_samples
  drop constraint if exists location_samples_source_check;

alter table public.location_samples
  add constraint location_samples_source_check
  check (source in ('fmb920', 'phone', 'simulator'));

create index if not exists idx_location_samples_warehouse_recorded
  on public.location_samples (warehouse_id, recorded_at desc)
  where warehouse_id is not null;

comment on column public.location_samples.source is 'fmb920 | phone (legacy) | simulator (admin demo).';
comment on column public.location_samples.warehouse_id is 'Bil-lager for fmb920-spor; null for legacy phone/simulator.';

-- Valider at aktiv bil tilhører brukerens firma og er vehicle-lager
create or replace function public.validate_profile_active_vehicle()
returns trigger
language plpgsql
as $$
begin
  if new.active_vehicle_warehouse_id is null then
    return new;
  end if;
  if new.company_id is null then
    raise exception 'profile must have company_id before setting active_vehicle_warehouse_id';
  end if;
  if not exists (
    select 1
    from public.warehouses w
    where w.id = new.active_vehicle_warehouse_id
      and w.company_id = new.company_id
      and w.kind = 'vehicle'
  ) then
    raise exception 'active_vehicle_warehouse_id must reference a vehicle warehouse in the same company';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_validate_active_vehicle on public.profiles;
create trigger trg_profiles_validate_active_vehicle
before insert or update of active_vehicle_warehouse_id, company_id
on public.profiles
for each row execute function public.validate_profile_active_vehicle();

-- Tildel første bil-lager i firma til profiler uten aktiv bil
create or replace function public.assign_default_vehicle_for_company(
  p_company_id uuid,
  p_preferred_warehouse_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_count integer;
begin
  if p_company_id is null then
    return 0;
  end if;

  if p_preferred_warehouse_id is not null then
    select w.id into v_wh
    from public.warehouses w
    where w.id = p_preferred_warehouse_id
      and w.company_id = p_company_id
      and w.kind = 'vehicle'
    limit 1;
  end if;

  if v_wh is null then
    select w.id into v_wh
    from public.warehouses w
    where w.company_id = p_company_id
      and w.kind = 'vehicle'
    order by w.created_at asc
    limit 1;
  end if;

  if v_wh is null then
    return 0;
  end if;

  update public.profiles p
  set active_vehicle_warehouse_id = v_wh
  where p.company_id = p_company_id
    and p.active_vehicle_warehouse_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.assign_default_vehicle_for_company(uuid, uuid) is
  'Setter active_vehicle_warehouse_id på profiler uten aktiv bil når firma får bil-lager.';

-- Når nytt bil-lager opprettes: fordel til profiler uten aktiv bil
create or replace function public.on_vehicle_warehouse_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'vehicle' then
    perform public.assign_default_vehicle_for_company(new.company_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_warehouses_assign_default_vehicle on public.warehouses;
create trigger trg_warehouses_assign_default_vehicle
after insert on public.warehouses
for each row execute function public.on_vehicle_warehouse_created();

-- Backfill eksisterende profiler
select public.assign_default_vehicle_for_company(c.id)
from public.companies c;

grant execute on function public.assign_default_vehicle_for_company(uuid, uuid) to service_role;
