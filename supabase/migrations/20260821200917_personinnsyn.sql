-- Innsyn og dataportabilitet (GDPR art. 15 og 20).
--
-- Fristen er én måned fra en person spør. Uten verktøy betyr det håndskrevne
-- spørringer mot produksjon under tidspress, og det er nettopp da man enten
-- glemmer en tabell eller får med en annens data. Begge deler er avvik.
--
-- Funksjonene er SECURITY DEFINER fordi de må lese på tvers av tabeller uten å
-- kjempe mot medlemskapsreglene i RLS. Det gjør vakten under til det eneste som
-- står mellom kaller og dataene, så den er stram med vilje: firmatilhørighet OG
-- rolle, sjekket her, ikke antatt fra klienten.

create or replace function public.krev_innsynsrett()
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare firma uuid;
begin
  select p.company_id into firma
  from profiles p
  where p.id = auth.uid() and p.role in ('owner', 'admin') and p.deleted_at is null;

  if firma is null then
    raise exception 'Bare eier eller administrator kan hente ut innsyn.' using errcode = '42501';
  end if;
  return firma;
end $$;

-- ── Kundens kunde ──────────────────────────────────────────────────────────
create or replace function public.personinnsyn_kunde(kunde_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare firma uuid := public.krev_innsynsrett(); ut jsonb;
begin
  -- Kunden må ligge i MITT firma. Uten denne blir funksjonen en
  -- oppslagstjeneste for hele basen på uuid.
  if not exists (select 1 from customers c where c.id = kunde_id and c.company_id = firma) then
    raise exception 'Ukjent kunde.' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'type', 'personinnsyn.kunde',
    'hentet_at', now(),
    'kunde', to_jsonb(c) - 'company_id',
    'ordrer', coalesce((
      select jsonb_agg(to_jsonb(o) - 'company_id' order by o.created_at)
      from orders o where o.customer_id = c.id and o.company_id = firma), '[]'::jsonb),
    'tilbud', coalesce((
      select jsonb_agg(to_jsonb(q) - 'company_id' order by q.created_at)
      from quotes q where q.customer_id = c.id and q.company_id = firma), '[]'::jsonb),
    'signaturer', coalesce((
      select jsonb_agg(to_jsonb(s) - 'company_id' - 'strokes' order by s.signed_at)
      from order_signatures s join orders o on o.id = s.order_id
      where o.customer_id = c.id and s.company_id = firma), '[]'::jsonb),
    'dokumentasjon', coalesce((
      select jsonb_agg(to_jsonb(d) - 'company_id' order by d.created_at)
      from order_documents d join orders o on o.id = d.order_id
      where o.customer_id = c.id and d.company_id = firma), '[]'::jsonb),
    'skann', coalesce((
      select jsonb_agg(to_jsonb(sc) - 'company_id' order by sc.created_at)
      from order_scans sc join orders o on o.id = sc.order_id
      where o.customer_id = c.id and sc.company_id = firma), '[]'::jsonb)
  ) into ut
  from customers c where c.id = kunde_id;

  -- Uthenting av personopplysninger er selv en behandling, og den skal spores.
  -- HVA som ble hentet står ikke i loggen; det ville gjort revisjonssporet til
  -- en kopi av det man nettopp hentet ut.
  perform public.log_audit_event('personinnsyn.kunde',
    jsonb_build_object('kunde_id', kunde_id, 'firma', firma));

  return ut;
end $$;

-- ── Firmaets ansatte ───────────────────────────────────────────────────────
-- Signaturer, timenotater og kjøretøy hører med: det er nettopp den typen
-- opplysninger en ansatt har grunn til å be om innsyn i.
create or replace function public.personinnsyn_ansatt(bruker_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare firma uuid := public.krev_innsynsrett(); ut jsonb;
begin
  if not exists (select 1 from profiles p where p.id = bruker_id and p.company_id = firma) then
    raise exception 'Ukjent bruker.' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'type', 'personinnsyn.ansatt',
    'hentet_at', now(),
    'profil', to_jsonb(p) - 'company_id',
    'timer', coalesce((
      select jsonb_agg(to_jsonb(t) - 'company_id' order by t.date)
      from time_entries t where t.user_id = p.id and t.company_id = firma), '[]'::jsonb),
    'ordremedlemskap', coalesce((
      select jsonb_agg(to_jsonb(m) - 'company_id' order by m.created_at)
      from order_members m where m.user_id = p.id and m.company_id = firma), '[]'::jsonb),
    'tildelte_ordrer', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'order_number', o.order_number,
                                          'title', o.title, 'status', o.status) order by o.created_at)
      from orders o where o.assigned_to = p.id and o.company_id = firma), '[]'::jsonb),
    'signaturer', coalesce((
      select jsonb_agg(to_jsonb(s) - 'company_id' order by s.signed_at)
      from order_signatures s where s.signed_by = p.id and s.company_id = firma), '[]'::jsonb),
    'lesebekreftelser', coalesce((
      select jsonb_agg(to_jsonb(l) - 'company_id' order by l.lest_at)
      from ik_lest l where l.user_id = p.id and l.company_id = firma), '[]'::jsonb),
    'kjoretoy', coalesce((
      select jsonb_agg(jsonb_build_object('id', lo.id, 'name', lo.name, 'reg_nr', lo.reg_nr) order by lo.name)
      from locations lo where lo.assigned_to = p.id and lo.company_id = firma), '[]'::jsonb),
    -- audit_events har norske kolonnenavn: tabell, operasjon, skjedde_at.
    'endringer_jeg_har_gjort', coalesce((
      select jsonb_agg(jsonb_build_object('at', a.skjedde_at, 'operasjon', a.operasjon,
                                          'hendelse', a.hendelse, 'tabell', a.tabell)
                       order by a.skjedde_at desc)
      from audit_events a where a.actor_id = p.id and a.company_id = firma), '[]'::jsonb)
  ) into ut
  from profiles p where p.id = bruker_id;

  perform public.log_audit_event('personinnsyn.ansatt',
    jsonb_build_object('bruker_id', bruker_id, 'firma', firma));

  return ut;
end $$;

revoke execute on function public.krev_innsynsrett() from anon, authenticated;
revoke execute on function public.personinnsyn_kunde(uuid) from anon;
revoke execute on function public.personinnsyn_ansatt(uuid) from anon;
