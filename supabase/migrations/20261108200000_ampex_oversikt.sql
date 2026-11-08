-- Ampex-oversikten (Tormod 08.11: «that oversight panel for me up ASAP»).
--
-- Én rad per firma med det som svarer på «bruker de den?»: hvor mange som har
-- vært aktive, hva som faktisk er laget, og når noe sist skjedde. Pluss én rad
-- per person i et firma med sist aktivitet og hvilken app/telefon de har.
--
-- «Aktiv» = har skrevet noe (en rad med created_by/updated_at) eller sendt
-- skannlogg/tilbakemelding/stemmebruk. Innlogging alene teller ikke — appen
-- holder sesjonen i månedsvis, så sist_innlogget sier lite.
--
-- Bare service_role når funksjonene (ampex-admin sjekker ampex_admins først),
-- samme mønster som ampex_firmaets_folk.

create or replace function public.ampex_oversikt()
returns table (
  company_id uuid,
  prosjekter bigint,
  tegninger bigint,
  ordre bigint,
  skann bigint,
  timer_7d bigint,
  markering_7d bigint,
  aktive_7d bigint,
  aktive_30d bigint,
  tilbakemeldinger_apne bigint,
  stemme_min_30d numeric,
  ai_tier text,
  sist_aktiv timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with hendelser as (
    select company_id, created_by as user_id, updated_at as t from projects where created_by is not null
    union all select company_id, created_by, updated_at from drawings where created_by is not null
    union all select company_id, created_by, updated_at from drawing_markup where created_by is not null
    union all select company_id, created_by, updated_at from orders where created_by is not null
    union all select company_id, created_by, updated_at from order_scans where created_by is not null
    union all select company_id, created_by, updated_at from time_entries where created_by is not null
    union all select company_id, created_by, updated_at from tasks where created_by is not null
    union all select company_id, user_id, created_at from tilbakemelding where user_id is not null
    union all select company_id, user_id, updated_at from voice_usage
    union all select p.company_id, s.user_id, s.created_at from skannlogg s join profiles p on p.id = s.user_id
  )
  select
    c.id,
    (select count(*) from projects x where x.company_id = c.id and x.deleted_at is null),
    (select count(*) from drawings x where x.company_id = c.id and x.deleted_at is null),
    (select count(*) from orders x where x.company_id = c.id and x.deleted_at is null),
    (select count(*) from order_scans x where x.company_id = c.id and x.deleted_at is null),
    (select count(*) from time_entries x where x.company_id = c.id and x.deleted_at is null and x.created_at > now() - interval '7 days'),
    (select count(*) from drawing_markup x where x.company_id = c.id and x.deleted_at is null and x.created_at > now() - interval '7 days'),
    (select count(distinct h.user_id) from hendelser h where h.company_id = c.id and h.t > now() - interval '7 days'),
    (select count(distinct h.user_id) from hendelser h where h.company_id = c.id and h.t > now() - interval '30 days'),
    (select count(*) from tilbakemelding x where x.company_id = c.id and x.status in ('ny', 'sett')),
    (select round(coalesce(sum(v.speech_sec), 0) / 60.0, 1) from voice_usage v where v.company_id = c.id and v.day > current_date - 30),
    (select s.voice_tier::text from company_settings s where s.company_id = c.id),
    (select max(h.t) from hendelser h where h.company_id = c.id)
  from companies c
$$;

create or replace function public.ampex_folk_aktivitet(p_firma uuid)
returns table (
  user_id uuid,
  sist_aktiv timestamptz,
  rader_30d bigint,
  skann bigint,
  app_versjon text,
  bygg text,
  modell text,
  os text
)
language sql
security definer
set search_path = public
stable
as $$
  with hendelser as (
    select created_by as user_id, updated_at as t from projects where company_id = p_firma
    union all select created_by, updated_at from drawings where company_id = p_firma
    union all select created_by, updated_at from drawing_markup where company_id = p_firma
    union all select created_by, updated_at from orders where company_id = p_firma
    union all select created_by, updated_at from order_scans where company_id = p_firma
    union all select created_by, updated_at from time_entries where company_id = p_firma
    union all select created_by, updated_at from tasks where company_id = p_firma
    union all select user_id, created_at from tilbakemelding where company_id = p_firma
    union all select user_id, updated_at from voice_usage where company_id = p_firma
    union all select s.user_id, s.created_at from skannlogg s join profiles p on p.id = s.user_id where p.company_id = p_firma
  ),
  siste_enhet as (
    select distinct on (t.user_id) t.user_id, t.app_versjon, t.bygg, t.modell, t.os
    from tilbakemelding t where t.company_id = p_firma
    order by t.user_id, t.created_at desc
  ),
  siste_skann as (
    select distinct on (s.user_id) s.user_id, s.modell, s.ios
    from skannlogg s join profiles p on p.id = s.user_id where p.company_id = p_firma
    order by s.user_id, s.created_at desc
  )
  select
    p.id,
    (select max(h.t) from hendelser h where h.user_id = p.id),
    (select count(*) from hendelser h where h.user_id = p.id and h.t > now() - interval '30 days'),
    (select count(*) from order_scans o where o.created_by = p.id and o.deleted_at is null),
    e.app_versjon,
    e.bygg,
    coalesce(e.modell, k.modell),
    coalesce(e.os, case when k.ios is not null then 'iOS ' || k.ios end)
  from profiles p
  left join siste_enhet e on e.user_id = p.id
  left join siste_skann k on k.user_id = p.id
  where p.company_id = p_firma
$$;

revoke all on function public.ampex_oversikt() from public, anon, authenticated;
revoke all on function public.ampex_folk_aktivitet(uuid) from public, anon, authenticated;
grant execute on function public.ampex_oversikt() to service_role;
grant execute on function public.ampex_folk_aktivitet(uuid) to service_role;
