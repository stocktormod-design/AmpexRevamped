-- Opplæringsregister (2026-09-17). Kapittel 7 i internkontrollen sa hvordan
-- opplæring skjer, men kunne ikke svare på det DLE spør om først: hvem har
-- gyldig FSE i år. Én rad per kurs per ansatt, med gyldig-til. FSE og
-- førstehjelp er årlige; andre kurs og sertifikater kan stå uten utløp.
--
-- Skrives fra kontoret. Ikke i sync_tables ennå — montøren trenger ikke
-- lista lokalt, og «mitt kort» kan hentes rett fra basen når den flata lages.

create table public.kompetanse (
  id uuid primary key,
  company_id uuid not null default public.current_company_id() references public.companies (id),
  user_id uuid not null references public.profiles (id),
  -- fse | forstehjelp | kurs | sertifikat | annet. Fritekst-tittel i tillegg.
  type text not null default 'kurs' check (type in ('fse', 'forstehjelp', 'kurs', 'sertifikat', 'annet')),
  tittel text not null,
  dato date not null,
  gyldig_til date,
  notat text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger kompetanse_touch before update on public.kompetanse
  for each row execute function public.touch_updated_at();

create index kompetanse_user_idx on public.kompetanse (company_id, user_id) where deleted_at is null;

alter table public.kompetanse enable row level security;

create policy kompetanse_select on public.kompetanse
  for select using (company_id = public.current_company_id());
create policy kompetanse_insert on public.kompetanse
  for insert with check (company_id = public.current_company_id());
create policy kompetanse_update on public.kompetanse
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
