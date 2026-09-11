-- Ampex-flata trenger å se FOLKENE i et firma, ikke bare firmaet.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvorfor `firmaets_ansatte()` ikke holder
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Den funksjonen (20260822120000) filtrerer på `current_company_id()` inne i
-- seg selv, og det er hele poenget med den: den som spør skal ikke kunne oppgi
-- hvilket firma hun spør om. En Ampex-admin står som regel ikke i firmaet han
-- ser på — og skal ikke måtte bytte inn i det bare for å se om eieren har tatt
-- imot invitasjonen sin.
--
-- Derfor en egen funksjon som TAR firmaet som argument, og som i gjengjeld
-- ikke kan nås av noen klient i det hele tatt. Samme form som
-- `finn_bruker_paa_epost()`: security definer, trukket fra public, anon OG
-- authenticated, slik at bare `service_role` — altså Edge Functionen, etter et
-- oppslag i `ampex_admins` — kommer til.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvorfor tre tidsstempler og ikke ett «har tilgang»-flagg
-- ═══════════════════════════════════════════════════════════════════════════
--
-- De tre svarer på tre forskjellige spørsmål, og den som skal purre trenger
-- alle:
--
--   invited_at        gikk det ut en invitasjon, og når?
--   email_confirmed_at  har hun laget seg en konto? Dette er nøyaktig feltet
--                     GoTrue selv ser på: `/invite` avviser en bekreftet
--                     bruker, og da er en NY invitasjon umulig — det som
--                     trengs da er en passordlenke.
--   last_sign_in_at   har hun faktisk vært innom etterpå?
--
-- Et sammenslått flagg ville skjult nettopp skillet valget står på.
--
-- Soft-slettede profiler er MED, og `deleted_at` følger med ut. En som er
-- trukket skal ikke få en ny invitasjon, og den avgjørelsen tas i Edge
-- Functionen — men den kan ikke tas av en rad som ikke finnes.

create or replace function public.ampex_firmaets_folk(p_firma uuid)
returns table (
  id uuid,
  epost text,
  full_name text,
  role public.app_role,
  invitert_at timestamptz,
  bekreftet_at timestamptz,
  sist_innlogget_at timestamptz,
  deleted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    u.email::text,
    p.full_name,
    p.role,
    u.invited_at,
    u.email_confirmed_at,
    u.last_sign_in_at,
    p.deleted_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.company_id = p_firma
  -- De som ikke har kommet inn øverst. Det er dem lista finnes for.
  order by (u.email_confirmed_at is null) desc, p.full_name
$$;

-- `from public, anon, authenticated` og ikke bare `from anon`: en ny funksjon
-- får EXECUTE til PUBLIC automatisk, og PUBLIC kan ikke trekkes fra en rolle
-- — se 20260822130000, som fant nettopp det.
revoke execute on function public.ampex_firmaets_folk(uuid) from public, anon, authenticated;
