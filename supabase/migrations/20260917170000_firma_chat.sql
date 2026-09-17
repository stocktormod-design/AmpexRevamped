-- Firmachat (2026-09-17): én tråd per firma, nede i høyre hjørne på kontoret.
--
-- Bakgrunnen er konkret: faglig ansvarlig sitter i flata og ser hva han vil ha
-- endret NÅ. Veien fra «dette burde stått annerledes» til at det står skrevet
-- ned et sted, skal være ett trykk — ikke en SMS som blir borte i en tråd om
-- noe annet.
--
-- Én tråd, ikke kanaler og ikke direktemeldinger. Firmaet er to personer;
-- kanaler ville vært et arkivsystem for en samtale som får plass i et vindu.
--
-- RLS er den vanlige: `company_id = current_company_id()`. Det er også hele
-- avgrensningen mot andre firmaer — hvert firma ser bare sin egen tråd.
create table public.firma_chat (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  -- Avsender lagres BÅDE som id og navn: navnet er et snapshot, så en melding
  -- fra i fjor viser hvem som skrev den selv om profilen er endret siden.
  bruker_id uuid not null references public.profiles (id),
  navn text not null default '',
  tekst text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger firma_chat_touch before update on public.firma_chat
  for each row execute function public.touch_updated_at();
create index firma_chat_firma_idx on public.firma_chat (company_id, created_at desc) where deleted_at is null;

alter table public.firma_chat enable row level security;

create policy firma_chat_select on public.firma_chat
  for select using (company_id = public.current_company_id());

-- Du kan bare skrive i DITT navn. Uten `bruker_id = auth.uid()` kunne en
-- ansatt lagt ord i munnen på en annen, og en chat der det er mulig er ikke
-- verdt å bruke til å avtale noe.
create policy firma_chat_insert on public.firma_chat
  for insert with check (company_id = public.current_company_id() and bruker_id = auth.uid());

-- Endre og slette: bare sine egne meldinger (soft delete, regel 5).
create policy firma_chat_update on public.firma_chat
  for update using (company_id = public.current_company_id() and bruker_id = auth.uid())
  with check (company_id = public.current_company_id() and bruker_id = auth.uid());

-- Realtime: meldingen skal komme fram mens den andre står i flata, uten at
-- noen trykker oppdater. Dette er den ENESTE tabellen i publikasjonen, med
-- vilje — resten av appen synker, den strømmer ikke.
alter publication supabase_realtime add table public.firma_chat;
