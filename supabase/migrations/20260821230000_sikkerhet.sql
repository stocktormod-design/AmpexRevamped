-- Sikkerhetsherding.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. RETTIGHETSESKALERING I `profiles`  ← den alvorlige
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Policyen `profiles_self_update` var:
--
--     for update using (id = auth.uid())          -- ingen with_check
--
-- Uten `with_check` bruker Postgres `using`-uttrykket på den NYE raden også.
-- Sjekken ble altså «er den nye radens id lik min id?» — og det er den jo, uansett
-- hva annet man endret i samme setning. Konsekvensen:
--
--     update profiles set role = 'owner' where id = auth.uid();
--     update profiles set company_id = '<et annet firma>' where id = auth.uid();
--
-- Begge gikk gjennom. Den første gjør en lærling til eier. Den andre flytter
-- brukeren inn i et ANNET firma, og siden `current_company_id()` leser
-- `profiles.company_id`, følger hele RLS-modellen etter: alle policyer i basen
-- sier «company_id = current_company_id()», og den verdien var brukerens egen å
-- sette. Én setning fra en innlogget montør ga full tilgang til et fremmed
-- firmas ordrer, kunder, timer og dokumentasjon.
--
-- RLS kan ikke begrense KOLONNER, bare rader. Derfor løses det med en trigger
-- som ser på hva som faktisk ble endret.

create or replace function public.profiles_vern()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  aktor_rolle app_role;
begin
  -- `service_role` (Edge Functions, migrasjoner, admin-verktøy) går utenom.
  -- Uten dette kan ikke `handle_new_user` sette rolle på en ny bruker.
  if auth.uid() is null then return NEW; end if;

  if NEW.id is distinct from OLD.id then
    raise exception 'Kan ikke endre id på en profil.' using errcode = '42501';
  end if;

  -- Firmabytte er en tenancy-endring. Den skjer aldri fra en klient.
  if NEW.company_id is distinct from OLD.company_id then
    raise exception 'Firmatilhørighet kan ikke endres herfra.' using errcode = '42501';
  end if;

  if NEW.role is distinct from OLD.role then
    select p.role into aktor_rolle from profiles p where p.id = auth.uid();
    if aktor_rolle is null or aktor_rolle not in ('owner', 'admin') then
      raise exception 'Bare eier eller administrator kan endre roller.' using errcode = '42501';
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists profiles_vern_trg on public.profiles;
create trigger profiles_vern_trg before update on public.profiles
  for each row execute function public.profiles_vern();

-- Eier og administrator skal kunne endre rollen til en kollega. Det fantes
-- ingen policy for det i det hele tatt — rolleendring måtte gjøres utenom
-- appen. Triggeren over er det som hindrer at dette blir en ny vei inn:
-- `company_id` kan fortsatt ikke endres, av noen.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_admin_update') then
    create policy profiles_admin_update on public.profiles for update
      using (
        company_id = public.current_company_id()
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('owner', 'admin')
        )
      )
      with check (company_id = public.current_company_id());
  end if;
end $$;

-- Og `profiles_self_update` får den `with_check` den skulle hatt. Triggeren
-- fanger resten, men to lås er bedre enn én på nettopp denne tabellen.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and company_id = public.current_company_id());

-- Profiler slettes ikke fra klienten. Det finnes ingen delete-policy fra før,
-- og den skal ikke komme: sletting av en ansatt håndteres som soft delete
-- (`deleted_at`) fordi timene og signaturene hennes skal stå.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. `search_path` som ikke kan kapres
-- ═══════════════════════════════════════════════════════════════════════════
--
-- En funksjon uten pinnet `search_path` slår opp tabell- og funksjonsnavn i det
-- skjemaet kalleren har først i sin sti. Kan noen lage et skjema, kan de legge
-- inn sin egen `orders` og få funksjonen til å skrive dit i stedet.

alter function public.sync_hidden_columns() set search_path to 'public';
alter function public.assign_quote_number() set search_path to 'public';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Triggerfunksjoner skal ikke kunne kalles som REST-endepunkt
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Alt i `public` blir automatisk et RPC-endepunkt hos PostgREST. En
-- triggerfunksjon som `audit_row()` har ingenting der å gjøre — og fordi den er
-- SECURITY DEFINER kjører den med eierens rettigheter.
--
-- At triggerne slutter å virke er ikke en risiko: Postgres sjekker EXECUTE på
-- en triggerfunksjon når triggeren OPPRETTES, ikke hver gang den fyrer.

revoke execute on function public.audit_row() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.krev_faglig_godkjenning() from anon, authenticated;
revoke execute on function public.touch_updated_at() from anon, authenticated;
revoke execute on function public.assign_order_number() from anon, authenticated;
revoke execute on function public.assign_quote_number() from anon, authenticated;
revoke execute on function public.sync_hidden_columns() from anon, authenticated;
revoke execute on function public.profiles_vern() from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Ingen RPC-er for uinnloggede
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `anon` betyr «ikke logget inn». Den viktigste her er `log_audit_event`: uten
-- denne kunne hvem som helst på internett skrive linjer inn i revisjonsloggen
-- — den ene tabellen hele poenget med er at den er til å stole på.
--
-- `current_company_id()` og `kan_skrive_ik()` beholder anon EXECUTE med vilje.
-- De brukes INNE i RLS-policyer, og policyer evalueres med kallerens rolle. Tas
-- de fra anon, bytter et tomt svar plass med en databasefeil, og vi vinner
-- ingenting — funksjonene gir null og false uten sesjon uansett.
--
-- `scan_*` røres ikke. Pool-noden autentiserer med anon-nøkkelen og et
-- node-token (se `worker/ampex_worker/api.py`), ikke med en brukersesjon. Det
-- er en bevisst modell, og å trekke anon der ville tatt ned bakepoolen.

revoke execute on function public.log_audit_event(text, jsonb) from anon;
revoke execute on function public.company_settings_for_me() from anon;
revoke execute on function public.kan_godkjenne_faglig() from anon;
revoke execute on function public.kan_fryses(uuid) from anon;
revoke execute on function public.oppbevaring_til() from anon;
revoke execute on function public.audit_actor_name() from anon, authenticated;
revoke execute on function public.get_company_ai_key(uuid, text) from anon;
revoke execute on function public.set_company_ai_key(uuid, text, text) from anon;

revoke execute on function public.watermelon_pull(bigint) from anon;
revoke execute on function public.watermelon_push(jsonb, bigint) from anon;
revoke execute on function public._watermelon_pull_core(timestamptz, bigint) from anon, authenticated;
revoke execute on function public._watermelon_push_core(jsonb) from anon, authenticated;
revoke execute on function public.sync_payload_in(text, jsonb) from anon, authenticated;
revoke execute on function public.sync_pull_columns(text) from anon, authenticated;
revoke execute on function public.sync_pull_expr(text) from anon, authenticated;

revoke execute on function public.watermelon_push_form_comments(jsonb) from anon;
revoke execute on function public.watermelon_push_form_revisions(jsonb) from anon;
revoke execute on function public.watermelon_push_form_templates(jsonb) from anon;
revoke execute on function public.watermelon_push_loops(jsonb) from anon;
revoke execute on function public.watermelon_push_markup(jsonb) from anon;
revoke execute on function public.watermelon_push_members(jsonb) from anon;
revoke execute on function public.watermelon_push_order_scans(jsonb) from anon;
revoke execute on function public.watermelon_push_rooms(jsonb) from anon;
revoke execute on function public.watermelon_push_tasks(jsonb) from anon;
