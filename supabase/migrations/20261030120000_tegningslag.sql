-- Tegningslaget (lib/prosjektering.ts): det som tegnes OPPÅ en plan — rom, punkter, kurser,
-- føringer, farer med risikomatrise, SJA (FSE § 10) og kompetanse. Ett dokument per plan.
--
-- To eiere, aldri begge:
--   * en ORDRE (Tormod 30.10: «det er jo det samme som en ordre») — planen er lastet opp på
--     ordren, og delingslenka er ordrens dokumentasjon til kunden;
--   * en TEGNING i et prosjekt (Tormod 30.10, kveld: «i prosjekt skal dette være bygget på
--     allerede») — planen er tegningen som alt ligger i prosjektets mappetre.
--
-- Ett jsonb-dokument, ikke tabeller per punkt: bare kontoret skriver det (regel 2,
-- desktop skriver rett mot Supabase), det lagres som helhet, og delingslenka leser
-- det som helhet. Blir punktene noe montøren skal krysse av på telefonen, flyttes de
-- til egne rader da.
--
-- Delingslenka: `del_token` er en tilfeldig nøkkel kontoret lager. Edge-funksjonen
-- `delt-ordre` slår opp på den med service-rollen og gir ut dokumentet, eieren
-- og en kortlevd lenke til planbildet. Ingen anon-policy på tabellen. Null token = ikke delt.
create table public.tegningslag (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id),
  order_id uuid references public.orders (id),
  drawing_id uuid references public.drawings (id),
  data jsonb not null default '{}'::jsonb,
  del_token text unique check (del_token is null or length(del_token) >= 24),
  delt_at timestamptz,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint tegningslag_en_eier check (num_nonnulls(order_id, drawing_id) = 1)
);

create unique index tegningslag_en_per_ordre on public.tegningslag (order_id) where deleted_at is null and order_id is not null;
create unique index tegningslag_en_per_tegning on public.tegningslag (drawing_id) where deleted_at is null and drawing_id is not null;
create index tegningslag_company_updated_idx on public.tegningslag (company_id, updated_at);

create trigger tegningslag_touch before update on public.tegningslag
  for each row execute function public.touch_updated_at();

alter table public.tegningslag enable row level security;

create policy tegningslag_company_select on public.tegningslag
  for select using (company_id = public.current_company_id());
create policy tegningslag_company_insert on public.tegningslag
  for insert with check (company_id = public.current_company_id());
create policy tegningslag_company_update on public.tegningslag
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
-- Ingen delete-policy: soft delete via deleted_at (regel #5)
