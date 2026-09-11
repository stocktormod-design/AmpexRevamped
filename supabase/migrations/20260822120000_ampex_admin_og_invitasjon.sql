-- Hvem oppretter firmaer, og hvem oppretter brukere i dem.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Utgangspunktet: det fantes ingen vei i det hele tatt
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `companies` har ingen insert-policy, og `profiles.company_id` kan ikke settes
-- fra en klient — `profiles_vern` fra sikkerhetsmigrasjonen stopper det med
-- vilje, fordi company_id ER tenancy-modellen. Begge deler er riktig, og
-- ingenting av det endres her.
--
-- Konsekvensen var bare at det ikke fantes NOEN vei: firma og brukere måtte
-- lages for hånd i SQL-editoren. Denne migrasjonen legger til de to tingene
-- som mangler for at Edge Functions med `service_role` skal kunne gjøre det i
-- stedet, og for at kontoret skal kunne vise resultatet.
--
--   1. `ampex_admins` — hvem som står OVER firmaene
--   2. `firmaets_ansatte()` — skillet mellom «invitert» og «har vært innom»
--
-- Selve opprettingen skjer i `supabase/functions/ampex-admin` og
-- `supabase/functions/inviter-ansatt`. Den ligger DER og ikke her fordi den
-- trenger auth-admin-API-et (invitasjons-e-post), som ikke finnes i SQL.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ampex_admins
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dette er den ene tabellen i basen som ikke hører til et firma. Den svarer på
-- ett spørsmål: får denne brukeren opprette firmaer?
--
-- Hvorfor en egen tabell og ikke et flagg på `profiles`: profiles er
-- klient-oppdaterbar. `profiles_self_update` lar deg skrive til din egen rad,
-- og `profiles_vern` passer bare på `id`, `company_id` og `role`. Et
-- `ampex_admin`-flagg i den tabellen ville vært en kolonne enhver innlogget
-- bruker kunne satt på seg selv — nøyaktig den eskaleringen sikkerhets-
-- migrasjonen lukket, gjenåpnet et annet sted.

create table if not exists public.ampex_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  /** Hvem og hvorfor. Denne tabellen skal kunne leses av et menneske om et år. */
  notat text,
  created_at timestamptz not null default now()
);

alter table public.ampex_admins enable row level security;

-- Du får se AT du selv står der. Ikke hvem andre som gjør det: lista over hvem
-- som har tilgang over alle firmaer er i seg selv opplysninger.
drop policy if exists ampex_admins_self_select on public.ampex_admins;
create policy ampex_admins_self_select on public.ampex_admins
  for select using (user_id = auth.uid());

-- Ingen insert-, update- eller delete-policy, med vilje. Rader settes inn med
-- `service_role` — fra SQL-editoren eller en migrasjon. En tabell som gir
-- tilgang på tvers av alle firmaer skal ikke ha en skriveflate i det hele tatt,
-- og særlig ikke en som kan nås fra en nettleser.
revoke insert, update, delete on public.ampex_admins from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. firmaets_ansatte()
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Firma-flata leser i dag `profiles` rett. Det holder til navn og rolle, men
-- den kan ikke skille en som er invitert i går fra en som har jobbet her i to
-- år — og det er nettopp den forskjellen den som inviterte trenger å se, for å
-- vite om han skal purre.
--
-- Svaret står i `auth.users` (`invited_at`, `last_sign_in_at`), og det skjemaet
-- når ingen klient. Derfor security definer, og derfor filtrert på
-- `current_company_id()` inne i funksjonen: den som kaller skal ikke kunne
-- oppgi hvilket firma hun spør om.
--
-- E-posten er med. Den står i auth og ikke i profiles, og uten den er en
-- invitert kollega bare et navn — man ser ikke hvilken adresse invitasjonen
-- faktisk gikk til, som er det første man vil sjekke når den ikke kom fram.

create or replace function public.firmaets_ansatte()
returns table (
  id uuid,
  full_name text,
  epost text,
  role public.app_role,
  phone text,
  har_logget_inn boolean,
  invitert_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    u.email::text,
    p.role,
    p.phone,
    u.last_sign_in_at is not null,
    u.invited_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.company_id = public.current_company_id()
    and p.deleted_at is null
  order by (u.last_sign_in_at is null) desc, p.full_name
$$;

-- `current_company_id()` gir null uten sesjon, og `company_id = null` treffer
-- ingen rader. Funksjonen er altså tom for anon uansett — men den skal ikke
-- ligge som et endepunkt for uinnloggede likevel.
--
-- Formen er `from public`, ikke `from anon`. En ny funksjon får EXECUTE til
-- PUBLIC automatisk, og PUBLIC er ikke en rolle man kan trekke fra en annen
-- rolle — `revoke … from anon` tar bare et grant gitt til anon direkte og lar
-- PUBLIC stå. Se 20260822130000, som fant nettopp det.
revoke execute on function public.firmaets_ansatte() from public, anon;
grant execute on function public.firmaets_ansatte() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. finn_bruker_paa_epost() — kun for service_role
-- ═══════════════════════════════════════════════════════════════════════════
--
-- En invitasjon må vite om adressen finnes fra før, og hva den i så fall
-- allerede tilhører. Uten det svaret er de tre utfallene umulige å skille:
-- ny person, kollega som allerede står i lista, og — den viktige — en konto
-- som hører til et ANNET firma. Den siste skal avvises, ikke flyttes.
--
-- `auth.admin.listUsers()` har ingen søk på e-post og paginerer, så det er
-- feil verktøy. Dette er riktig verktøy, og det er derfor det er trukket fra
-- BÅDE anon og authenticated: en funksjon som svarer «finnes denne adressen»
-- er et oppslagsverk over hvem som er kunde hos Ampex. `service_role` går
-- utenom grants og når den likevel.

create or replace function public.finn_bruker_paa_epost(p_epost text)
returns table (id uuid, company_id uuid, role public.app_role)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, p.company_id, p.role
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_epost))
  limit 1
$$;

revoke execute on function public.finn_bruker_paa_epost(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Oppstart: den første Ampex-administratoren
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Den kan ikke settes i en migrasjon, fordi brukeren må finnes i `auth.users`
-- først, og hvem det er varierer mellom prosjektene. Kjør dette én gang i
-- SQL-editoren, med din egen adresse:
--
--   insert into public.ampex_admins (user_id, notat)
--   select id, 'Tormod — opprettet fra SQL-editoren'
--   from auth.users where email = 'din@adresse.no'
--   on conflict (user_id) do nothing;
--
-- IKKE sett inn `test@ampex.no`. Passordet til den kontoen står i klartekst i
-- et offentlig git-repo (`desktop/src/ruter/Logginn.tsx`), og en konto med det
-- passordet skal ikke kunne opprette firmaer.
