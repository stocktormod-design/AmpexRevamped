-- Internkontroll v2 (2026-09-17) — en PRØVEFLATE ved siden av den som virker.
--
-- Tre nivåer, som faglig ansvarlig ba om: overordnet formål → punkt → rutine.
-- En rutine henger ALLTID på et punkt, aldri rett på formålet; det er hele
-- forskjellen fra v1, der de fjorten kapitlene hadde rutinene direkte.
--
-- EGNE TABELLER, ikke nye kolonner på ik_punkter/ik_rutiner. Grunnen er at v2
-- skal kunne SLETTES: `drop table ik2_rutiner, ik2_punkter, ik2_formal` og én
-- rad ut av menyen, så er den borte og internkontrollen står som før. Hadde v2
-- delt tabeller med v1, ville underpunktene dukket opp som ekstra kapitler i
-- den flata faglig ansvarlig faktisk bruker.
--
-- Ikke i sync_tables: dette skrives fra kontoret, og montørappen skal ikke
-- synke ned en flate som kanskje forsvinner igjen.

create table public.ik2_formal (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  tittel text not null default '',
  tekst text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.ik2_punkter (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  formal_id uuid not null references public.ik2_formal (id),
  tittel text not null default '',
  tekst text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.ik2_rutiner (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  punkt_id uuid not null references public.ik2_punkter (id),
  tittel text not null default '',
  innhold text,
  -- Én tagg, fritekst: «HMS», «AUS», «tavle». Fritekst og ikke kodeliste av
  -- samme grunn som hjemmelsfeltet i v1 — firmaet kjenner sitt eget arbeid,
  -- og en låst liste blir feil ved neste revisjon.
  tag text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger ik2_formal_touch before update on public.ik2_formal
  for each row execute function public.touch_updated_at();
create trigger ik2_punkter_touch before update on public.ik2_punkter
  for each row execute function public.touch_updated_at();
create trigger ik2_rutiner_touch before update on public.ik2_rutiner
  for each row execute function public.touch_updated_at();

create index ik2_punkter_formal_idx on public.ik2_punkter (formal_id) where deleted_at is null;
create index ik2_rutiner_punkt_idx on public.ik2_rutiner (punkt_id) where deleted_at is null;
create index ik2_rutiner_tag_idx on public.ik2_rutiner (company_id, tag) where deleted_at is null;

alter table public.ik2_formal enable row level security;
alter table public.ik2_punkter enable row level security;
alter table public.ik2_rutiner enable row level security;

create policy ik2_formal_select on public.ik2_formal
  for select using (company_id = public.current_company_id());
create policy ik2_formal_insert on public.ik2_formal
  for insert with check (company_id = public.current_company_id());
create policy ik2_formal_update on public.ik2_formal
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy ik2_punkter_select on public.ik2_punkter
  for select using (company_id = public.current_company_id());
create policy ik2_punkter_insert on public.ik2_punkter
  for insert with check (company_id = public.current_company_id());
create policy ik2_punkter_update on public.ik2_punkter
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy ik2_rutiner_select on public.ik2_rutiner
  for select using (company_id = public.current_company_id());
create policy ik2_rutiner_insert on public.ik2_rutiner
  for insert with check (company_id = public.current_company_id());
create policy ik2_rutiner_update on public.ik2_rutiner
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Rammeverket inn i v2 (2026-09-17, samme kveld): de fjorten punktene fra
-- forskriften ER strukturen, også her. Nummeret og hjemmelen står på formålet
-- slik at «Punkt 4 · § 5 andre ledd nr. 7» kan vises uten et oppslag.
-- Teksten under dem er firmaets egen, og fylles ikke ut av oss.
alter table public.ik2_formal add column if not exists nummer text;
alter table public.ik2_formal add column if not exists hjemmel text;
