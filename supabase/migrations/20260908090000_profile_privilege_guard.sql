-- ─────────────────────────────────────────────────────────────────────────────
-- SIKKERHETSFIKS: rettighetseskalering og tilgang på tvers av firma via profiles
--
-- ⚠️ IKKE KJØRT ENNÅ. Les hele denne kommentaren før du anvender den.
--
-- HULLET (funnet 2026-09-08 ved gjennomgang av hele repoet)
--   `20260703160000_foundation.sql:73` har:
--       create policy profiles_self_update on public.profiles
--         for update using (id = auth.uid());
--
--   For UPDATE bruker Postgres USING-uttrykket også som WITH CHECK når WITH CHECK
--   mangler. Predikatet begrenser derfor BARE `id`. Raden må fortsatt tilhøre deg
--   etterpå, men ingenting hindrer at du endrer de to kolonnene som styrer all
--   tilgang i systemet:
--
--     update public.profiles set role = 'owner'      where id = auth.uid();
--     update public.profiles set company_id = '<annet firma>' where id = auth.uid();
--
--   Den andre er den alvorlige. `current_company_id()` (foundation.sql:55) leser
--   nettopp `profiles.company_id`, og ALLE RLS-policyer i basen sammenligner mot
--   den. En innlogget lærling kan altså flytte seg selv inn i et hvilket som helst
--   firma og få full lese- og skrivetilgang til deres ordrer, kunder, timer og
--   dokumentasjon. Det bryter tenant-isolasjonen, som er den ene invarianten et
--   fler-firma-SaaS ikke kan bomme på.
--
--   Legacy-skjemaet HADDE en vakt for dette
--   (`docs/legacy-schema/migrations/20260421192000_profile_role_guard.sql`, som
--   festet company_id i sin WITH CHECK). Den ble aldri portert til revamp-
--   fundamentet. Dette er altså en regresjon, ikke et hull som aldri var tenkt på.
--
-- HVORFOR TRIGGER OG IKKE BARE EN STRAMMERE POLICY
--   En RLS-policy kan ikke se OLD-raden. «Rollen skal være uendret» er derfor ikke
--   uttrykkbart i WITH CHECK. En BEFORE UPDATE-trigger har både OLD og NEW og er
--   den eneste presise formuleringen.
--
-- HVORFOR DETTE ER TRYGT Å KJØRE
--   Appen SELECTer fra `profiles` (auth-user.ts, order-access.ts, company-guard.ts,
--   medlem.tsx), men skriver aldri til den. Ingen kodesti settes i stå av denne
--   fiksen. Rolle og firmatilknytning settes i dag ut av båndet (SQL-konsollen).
--   `service_role` går utenom RLS og treffes uansett ikke av triggeren, så
--   edge-funksjoner og admin-verktøy er upåvirket.
--
-- ETTER AT DEN ER KJØRT
--   · Selvbetjent: en bruker kan fortsatt endre `full_name`, `phone` og øvrige
--     egne felt på sin egen rad.
--   · `role` og `company_id` kan bare endres av en `owner`/`admin` i SAMME firma,
--     eller av `service_role`.
--   · `company_id` kan settes ÉN gang mens den er null (innmelding), slik legacy
--     også tillot. Etter det er den låst for vanlige brukere.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kaller_rolle public.app_role;
  kaller_firma uuid;
begin
  -- service_role (edge-funksjoner, admin-skript) går utenom.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Ingen av de to vernede kolonnene er endret → ingenting å vokte.
  if new.role is not distinct from old.role
     and new.company_id is not distinct from old.company_id then
    return new;
  end if;

  -- Les kallerens EGEN rad direkte, ikke via current_company_id(): den funksjonen
  -- leser samme tabell vi holder på å endre, og skal ikke kunne brukes til å
  -- bekrefte sin egen eskalering.
  select p.role, p.company_id into kaller_rolle, kaller_firma
  from public.profiles p
  where p.id = auth.uid();

  -- Innmelding: firmatilknytning kan settes én gang mens den er null.
  if old.company_id is null
     and new.company_id is not null
     and new.role is not distinct from old.role
     and old.id = auth.uid() then
    return new;
  end if;

  -- Alt annet krever owner/admin i det firmaet raden allerede tilhører.
  if kaller_rolle not in ('owner', 'admin') then
    raise exception
      'Ikke tillatt: bare owner eller admin kan endre rolle eller firmatilknytning (bruker %)', auth.uid()
      using errcode = '42501';
  end if;

  if kaller_firma is null or old.company_id is distinct from kaller_firma then
    raise exception
      'Ikke tillatt: kan bare endre profiler i eget firma'
      using errcode = '42501';
  end if;

  -- En admin skal heller ikke kunne flytte noen UT av firmaet.
  if new.company_id is distinct from old.company_id then
    raise exception
      'Ikke tillatt: firmatilknytning kan ikke flyttes'
      using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function public.guard_profile_privileges() from anon, authenticated;

drop trigger if exists profiles_privilege_guard on public.profiles;
create trigger profiles_privilege_guard
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

comment on function public.guard_profile_privileges() is
  'Hindrer at en bruker gir seg selv en høyere rolle eller flytter seg til et annet firma. Se migrasjonens toppkommentar (2026-09-08).';
