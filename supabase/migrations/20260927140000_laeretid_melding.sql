-- Samtalen som skriver loggen (2026-09-27).
--
-- Lærlingen skriver ikke loggen selv. Boten spør ham ut om dagen — etter en
-- fast avhørsliste, se lib/laeretid/utsporing.ts — og skriver loggen av svarene,
-- notatene og instruksen hans. Denne tabellen er samtalen.
--
-- Svarene er hans, akkurat som quizsvarene: INGEN tilknytning gir innsyn, heller
-- ikke faglig leder eller koordinator. Det er her han sier «jeg husker ikke» og
-- «montøren gjorde det», og blir det lesbart for sjefen slutter han å si det.
create table if not exists public.laeretid_melding (
  id uuid primary key default gen_random_uuid(),
  laerling_id uuid not null references public.profiles(id),
  logg_id uuid not null references public.laeretid_logg(id),
  rolle text not null check (rolle in ('laerling', 'bot')),
  tekst text not null,
  -- Hvilke punkter på avhørslista svaret dekker, kommaseparert. Settes på
  -- lærlingens melding når boten har lest den.
  dekker text,
  -- NEK-punktet boten ba ham slå opp. Nummer og side, aldri innhold.
  nek text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists laeretid_melding_logg on public.laeretid_melding(logg_id) where deleted_at is null;

alter table public.laeretid_melding enable row level security;

drop policy if exists laeretid_melding_les on public.laeretid_melding;
create policy laeretid_melding_les on public.laeretid_melding for select
  using (laerling_id = auth.uid());
drop policy if exists laeretid_melding_skriv on public.laeretid_melding;
create policy laeretid_melding_skriv on public.laeretid_melding for all
  using (laerling_id = auth.uid()) with check (laerling_id = auth.uid());

insert into public.sync_tables (table_name, push_order, no_update, eier, eier_kolonne)
values ('laeretid_melding', 102, '{}', 'bruker', 'laerling_id')
on conflict (table_name) do update
  set push_order = excluded.push_order, eier = excluded.eier, eier_kolonne = excluded.eier_kolonne;
