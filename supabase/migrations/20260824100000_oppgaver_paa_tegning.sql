-- Oppgaver som lever PÅ tegningen: frist, beskrivelse, pin og mottakere.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvorfor pin på koordinat og ikke en forhåndsdefinert lokasjon
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Autodesk Build løser dette med «locations» — et hierarki en prosjekt-
-- administrator må sette opp i webmodulen FØR noen i felt kan pinne noe. Det er
-- riktig for et byggeprosjekt med tolv fag og en BIM-koordinator. Det er feil
-- for en bas som står i et rom og ser at det mangler et stikk.
--
-- Her er pinnen bare to tall: `pin_x` og `pin_y` i normaliserte side-
-- koordinater (0–1), samme rom som `rooms.shape` og `drawing_loops.nodes`
-- allerede bruker. Ingen oppsett, ingen administrator, ingen venting.
--
-- Normaliserte koordinater og ikke piksler: samme tegning vises på en telefon,
-- et nettbrett og en kontorskjerm, og en pin i piksler ville flyttet seg.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvorfor mottakere er en egen tabell
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `tasks.assigned_to` er ÉN person — den som er ansvarlig. Men en oppgave
-- sendes ofte til flere, eller til alle på prosjektet: «her mangler det stikk»
-- angår både den som skal gjøre det og den som planla det.
--
-- Å presse det inn i `assigned_to` ville betydd enten en kommaseparert streng
-- (som ingen kan spørre på) eller at ansvar og informasjon blir samme ting.
-- De er ikke det: én er ansvarlig, flere er informert.
--
-- `synlighet = 'prosjekt'` er den tredje formen — alle på prosjektet ser den,
-- uten at noen står oppført. Da er det ingen som har fått den, og det er
-- poenget: en oppslagstavle, ikke en oppgave.
--
-- Tilbakerulling: se nederst.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Oppgaven
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tasks
  add column if not exists beskrivelse text,
  add column if not exists frist_at timestamptz,
  add column if not exists drawing_id uuid references public.drawings (id),
  add column if not exists pin_x real,
  add column if not exists pin_y real,
  add column if not exists synlighet text not null default 'tildelt';

alter table public.tasks drop constraint if exists tasks_synlighet_sjekk;
alter table public.tasks add constraint tasks_synlighet_sjekk
  check (synlighet in ('tildelt', 'prosjekt'));

-- En halv pin er ingen pin. Uten denne kunne en rad hatt x uten y, og da ville
-- den tegnet seg på venstre kant av arket uten at noen forsto hvorfor.
alter table public.tasks drop constraint if exists tasks_pin_hel;
alter table public.tasks add constraint tasks_pin_hel
  check ((pin_x is null) = (pin_y is null));

-- En pin uten tegning peker ingen steder.
alter table public.tasks drop constraint if exists tasks_pin_krever_tegning;
alter table public.tasks add constraint tasks_pin_krever_tegning
  check (pin_x is null or drawing_id is not null);

-- Koordinatene er normaliserte. En verdi utenfor 0–1 er en regnefeil i
-- klienten, ikke et punkt utenfor arket.
alter table public.tasks drop constraint if exists tasks_pin_innenfor;
alter table public.tasks add constraint tasks_pin_innenfor
  check (
    (pin_x is null or (pin_x >= 0 and pin_x <= 1))
    and (pin_y is null or (pin_y >= 0 and pin_y <= 1))
  );

create index if not exists tasks_drawing_idx on public.tasks (drawing_id)
  where deleted_at is null and drawing_id is not null;
create index if not exists tasks_frist_idx on public.tasks (frist_at)
  where deleted_at is null and status <> 'done';

comment on column public.tasks.pin_x is
  'Normalisert x (0-1) paa tegningen. Samme koordinatrom som rooms.shape og drawing_loops.nodes.';
comment on column public.tasks.synlighet is
  'tildelt = kun mottakere og ansvarlig. prosjekt = alle paa prosjektet.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Mottakerne
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `user_navn` lagres ved siden av `user_id`, som ellers i basen
-- (`time_entries.user_name`, `project_members.user_name`). Det er bevisst
-- denormalisering: en oppgave fra i fjor skal kunne leses selv om personen har
-- sluttet, og et navn som forsvinner fra historikken er historikk som ikke kan
-- forklares.

create table if not exists public.task_mottakere (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  user_navn text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Samme person kan ikke stå to ganger. Fjernes hun, frigjør soft deleten
-- plassen så hun kan legges til igjen senere.
create unique index if not exists task_mottakere_unik
  on public.task_mottakere (task_id, user_id) where deleted_at is null;
create index if not exists task_mottakere_bruker_idx
  on public.task_mottakere (user_id) where deleted_at is null;

alter table public.task_mottakere enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='task_mottakere' and policyname='task_mottakere_sel') then
    create policy task_mottakere_sel on public.task_mottakere for select
      using (company_id = public.current_company_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='task_mottakere' and policyname='task_mottakere_ins') then
    create policy task_mottakere_ins on public.task_mottakere for insert
      with check (company_id = public.current_company_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='task_mottakere' and policyname='task_mottakere_upd') then
    create policy task_mottakere_upd on public.task_mottakere for update
      using (company_id = public.current_company_id())
      with check (company_id = public.current_company_id());
  end if;
  -- Ingen delete-policy. Soft delete, regel 5.
end $$;

drop trigger if exists task_mottakere_touch on public.task_mottakere;
create trigger task_mottakere_touch before update on public.task_mottakere
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Synken
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `sync_pull_columns` leser kolonnene fra information_schema, så de nye
-- feltene på `tasks` sendes til appen automatisk. Det er hele poenget med den
-- generiske synken — men det betyr også at appens LOKALE skjema må kjenne dem,
-- ellers avviser WatermelonDB raden. Se `lib/db/schema.ts` (v32) og
-- `lib/db/migrations.ts`.
--
-- `push_order` 30: mottakerne peker på en oppgave, og oppgaven må finnes først.

insert into public.sync_tables (table_name, push_order, no_update)
values ('task_mottakere', 35, '{}')
on conflict (table_name) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tilbakerulling
-- ═══════════════════════════════════════════════════════════════════════════
--
--   delete from public.sync_tables where table_name = 'task_mottakere';
--   drop table public.task_mottakere;
--   alter table public.tasks
--     drop column beskrivelse, drop column frist_at, drop column drawing_id,
--     drop column pin_x, drop column pin_y, drop column synlighet;
