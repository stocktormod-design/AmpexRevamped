-- Ordrenummeret blir en fasit: én serie per firma, som bare går oppover.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hva som var galt
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `assign_order_number()` fra 20260703161000 regnet nummeret ut slik:
--
--   select coalesce(max(order_number), 0) + 1 from orders where company_id = …
--
-- Det er ikke en serie. Det er et spørsmål om hva som ligger i tabellen NÅ, og
-- svaret endrer seg når tabellen gjør det. Tre hull, i stigende alvorlighet:
--
--   1. **Nummeret kan gjenbrukes.** Forsvinner raden med det høyeste nummeret
--      — en opprydding i testdata, en `delete` med `service_role`, en
--      gjenoppretting fra en eldre sikkerhetskopi — så peker `max()` på nest
--      høyeste, og NESTE ordre får et nummer som har vært brukt før. To
--      forskjellige jobber, samme «ordre 42», og den ene av dem står på en
--      faktura som er sendt.
--
--   2. **Nummeret kunne endres etterpå.** `orders_company_update` slipper
--      gjennom enhver kolonne. Ingenting hindret `update orders set
--      order_number = 1`. Et nummer som kan endres er ikke en identitet, det
--      er et notat.
--
--   3. **Klienten kunne oppgi det selv.** Triggeren tildelte bare når feltet
--      var null. `sync_tables.no_update` stopper klienten fra å OVERSKRIVE
--      nummeret, men ikke fra å sette det ved INSERT — og kontorappen skriver
--      rett mot PostgREST, utenom synken helt.
--
-- Advisory lock-en løste bare det fjerde problemet: to samtidige insert i
-- samme sekund. Den var riktig, og den er beholdt i form av radlåsen under.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hva som gjelder nå
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nummeret kommer fra en teller som lever i sin egen tabell og som ALDRI ser
-- på `orders`. Da spiller det ingen rolle hva som skjer med radene: sletter du
-- ordre 8, er neste ordre fortsatt 9.
--
-- Hvorfor en tabell og ikke en `sequence`: en sequence er ikke transaksjonell.
-- Ruller inserten tilbake — RLS avviser den, en fremmednøkkel mangler, synken
-- feiler halvveis — så er nummeret brent, og serien får et hull ingen kan
-- forklare. En radoppdatering rulles tilbake sammen med resten. Tellere per
-- firma i én sequence hver hadde dessuten betydd DDL ved hvert nye firma.
--
-- Prisen er at to samtidige ordrer i samme firma serialiseres på én rad. Det
-- er riktig pris: to ordrer som skal ha hvert sitt nummer MÅ vente på
-- hverandre, ellers får de det samme.
--
-- Tilbudsnummeret hadde nøyaktig samme feil (`assign_quote_number`), og er med
-- her. Å rette den ene og la den andre stå ville vært verre enn å la begge
-- stå: da tror man det er ordnet.
--
-- Tilbakerulling: se nederst.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tellerne
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.nummerserier (
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Hvilken serie. Utvides med 'faktura' den dagen fakturanummeret blir vårt.
  serie text not null check (serie in ('ordre', 'tilbud')),
  -- Nummeret som deles ut NESTE gang. Går bare oppover.
  neste integer not null default 1 check (neste >= 1),
  updated_at timestamptz not null default now(),
  primary key (company_id, serie)
);

-- RLS på, og ingen policy i det hele tatt. Det er ikke en forglemmelse: en
-- teller ingen klient kan lese er en teller ingen klient kan lyve om.
-- Funksjonen under er `security definer` og går utenom RLS — den ene veien inn.
alter table public.nummerserier enable row level security;
revoke all on public.nummerserier from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Utdelingen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `update … returning` tar en radlås. Nummer to venter til nummer én har
-- committet, og får da den nye verdien. Det er hele samtidighetshåndteringen,
-- og den er databasens egen — ikke en advisory lock vi må huske å ta.

create or replace function public.neste_i_serie(p_company uuid, p_serie text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_company is null then
    raise exception 'Kan ikke tildele %-nummer uten firma', p_serie using errcode = '23502';
  end if;

  insert into public.nummerserier (company_id, serie)
  values (p_company, p_serie)
  on conflict (company_id, serie) do nothing;

  update public.nummerserier
     set neste = neste + 1, updated_at = now()
   where company_id = p_company and serie = p_serie
  returning neste - 1 into n;

  return n;
end $$;

revoke execute on function public.neste_i_serie(uuid, text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Tildelingen ved insert
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Merk `:=` uten `if new.order_number is null`. Det klienten måtte ha sendt
-- blir overskrevet, hver gang. Det ER forskjellen på «serveren tildeler som
-- regel» og «serveren er fasit»: så lenge det finnes én vei der klienten
-- bestemmer nummeret, er det klienten som eier serien.
--
-- Offline-klienten sender null uansett (se kommentaren i `sync_tables`), så
-- ingen mister noe på dette.

create or replace function public.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.order_number := public.neste_i_serie(new.company_id, 'ordre');
  return new;
end $$;

create or replace function public.assign_quote_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.quote_number := public.neste_i_serie(new.company_id, 'tilbud');
  return new;
end $$;

revoke execute on function public.assign_order_number() from public, anon, authenticated;
revoke execute on function public.assign_quote_number() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Nummeret er låst etter tildeling
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Gjelder alle, `service_role` inkludert. Skal et nummer virkelig rettes, er
-- det en bevisst handling i SQL-editoren:
--
--   alter table public.orders disable trigger orders_nummer_laast;
--   …rett…
--   alter table public.orders enable trigger orders_nummer_laast;
--
-- Det er med vilje tungvint. Et ordrenummer som står på en sendt faktura skal
-- ikke kunne endres av en `update` som egentlig skulle sette en status.
--
-- Soft delete går klar: `deleted_at` er en annen kolonne, og nummeret følger
-- raden ned. Det er også poenget — nummeret blir aldri ledig igjen.

create or replace function public.nummer_er_laast()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'orders' and new.order_number is distinct from old.order_number then
    raise exception 'Ordrenummer kan ikke endres (% → %)', old.order_number, new.order_number
      using errcode = '23514';
  end if;
  if tg_table_name = 'quotes' and new.quote_number is distinct from old.quote_number then
    raise exception 'Tilbudsnummer kan ikke endres (% → %)', old.quote_number, new.quote_number
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists orders_nummer_laast on public.orders;
create trigger orders_nummer_laast before update on public.orders
  for each row execute function public.nummer_er_laast();

drop trigger if exists quotes_nummer_laast on public.quotes;
create trigger quotes_nummer_laast before update on public.quotes
  for each row execute function public.nummer_er_laast();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Start tellerne der de faktisk står
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `max(order_number) + 1` brukes ÉN gang — her, som utgangspunkt. Etterpå
-- leses `orders` aldri mer for å bestemme et nummer. Slettede rader teller
-- med: nummeret deres er brukt opp.

insert into public.nummerserier (company_id, serie, neste)
select company_id, 'ordre', coalesce(max(order_number), 0) + 1
from public.orders
group by company_id
on conflict (company_id, serie) do update
  set neste = greatest(public.nummerserier.neste, excluded.neste);

insert into public.nummerserier (company_id, serie, neste)
select company_id, 'tilbud', coalesce(max(quote_number), 0) + 1
from public.quotes
group by company_id
on conflict (company_id, serie) do update
  set neste = greatest(public.nummerserier.neste, excluded.neste);

-- Firmaer uten ordrer ennå får raden sin når den første kommer
-- (`on conflict do nothing` i `neste_i_serie`).

-- ═══════════════════════════════════════════════════════════════════════════
-- Tilbakerulling
-- ═══════════════════════════════════════════════════════════════════════════
--
--   drop trigger orders_nummer_laast on public.orders;
--   drop trigger quotes_nummer_laast on public.quotes;
--   drop function public.nummer_er_laast();
--   -- legg tilbake max()+1-versjonen av assign_order_number/assign_quote_number
--   drop function public.neste_i_serie(uuid, text);
--   drop table public.nummerserier;
