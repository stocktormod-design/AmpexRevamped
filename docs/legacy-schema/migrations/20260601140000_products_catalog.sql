-- Global varekatalog (EFObasen / elnummer) for produktsøk i Ampex.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  elnummer text not null,
  name text not null,
  description text,
  supplier text,
  etim_class text,
  image_url text,
  fdv_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_elnummer_unique unique (elnummer)
);

comment on table public.products is
  'Nasjonal produktkatalog (EFO/elnummer). Delt på tvers av tenants; skrives via service role/import.';

create index if not exists products_elnummer_idx on public.products (elnummer);

create index if not exists products_name_trgm_gin_idx
  on public.products using gin (name extensions.gin_trgm_ops);

drop trigger if exists trg_products_set_updated_at on public.products;
create trigger trg_products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

-- Søk: eksakt elnummer + delstreng/trigram på navn.
create or replace function public.search_products(
  p_query text,
  p_limit int default 50
)
returns table (
  id uuid,
  elnummer text,
  name text,
  description text,
  supplier text,
  etim_class text,
  image_url text,
  fdv_url text,
  rank real
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  q text := nullif(btrim(p_query), '');
  q_el text;
  lim int := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if q is null then
    return;
  end if;

  q_el := regexp_replace(q, '\s+', '', 'g');

  return query
  select
    p.id,
    p.elnummer,
    p.name,
    p.description,
    p.supplier,
    p.etim_class,
    p.image_url,
    p.fdv_url,
  case
    when p.elnummer = q_el or p.elnummer = q then 1.0::real
    else similarity(p.name, q)::real
  end as rank
  from public.products p
  where
    p.elnummer = q_el
    or p.elnummer = q
    or (
      length(q) >= 2
      and (
        p.name % q
        or p.name ilike '%' || q || '%'
      )
    )
  order by
    case when p.elnummer = q_el or p.elnummer = q then 0 else 1 end,
    rank desc nulls last,
    p.name asc
  limit lim;
end;
$$;

grant execute on function public.search_products(text, int) to authenticated;

alter table public.products enable row level security;

drop policy if exists "products_select_authenticated" on public.products;
create policy "products_select_authenticated"
on public.products
for select
to authenticated
using (true);

grant select on public.products to authenticated;
