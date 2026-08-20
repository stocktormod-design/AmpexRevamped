-- Funnet ved å faktisk kjøre appen mot databasen, ikke ved å lese koden:
-- company_settings har company_id som primærnøkkel, ikke id. audit_row() leste
-- NEW.id, så hendelsen ble skrevet med rad_id = null — et revisjonsspor som
-- ikke kan si HVILKEN rad det beskriver. Det er ikke et revisjonsspor.
--
-- For en tabell med én rad per firma ER company_id radens identitet. Dette er
-- altså ikke en tilnærming, det er riktig nøkkel for akkurat de tabellene.
--
-- IKKE ANVENDT ENNÅ — se docs/STATUS.md.
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gammel jsonb;
  ny jsonb;
  diff jsonb := '{}'::jsonb;
  n text;
  firma uuid;
begin
  firma := coalesce(
    case when TG_OP = 'DELETE' then (to_jsonb(OLD)->>'company_id')::uuid
         else (to_jsonb(NEW)->>'company_id')::uuid end,
    current_company_id()
  );
  if firma is null then return coalesce(NEW, OLD); end if;

  if TG_OP = 'INSERT' then
    ny := to_jsonb(NEW) - 'created_at' - 'updated_at';
    insert into public.audit_events (company_id, actor_id, actor_name, tabell, rad_id, operasjon, endringer)
    values (firma, auth.uid(), audit_actor_name(), TG_TABLE_NAME,
            coalesce((to_jsonb(NEW)->>'id')::uuid, (to_jsonb(NEW)->>'company_id')::uuid), 'insert', ny);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    gammel := to_jsonb(OLD);
    ny := to_jsonb(NEW);
    for n in select jsonb_object_keys(ny) loop
      if n in ('updated_at') then continue; end if;
      if gammel->n is distinct from ny->n then
        diff := diff || jsonb_build_object(n, jsonb_build_object('fra', gammel->n, 'til', ny->n));
      end if;
    end loop;
    -- Ingen reelle endringer (kun updated_at) = ingen hendelse. Ellers ville
    -- hver synk-runde fylt sporet med rader som ikke sier noe.
    if diff = '{}'::jsonb then return NEW; end if;
    insert into public.audit_events (company_id, actor_id, actor_name, tabell, rad_id, operasjon, endringer)
    values (firma, auth.uid(), audit_actor_name(), TG_TABLE_NAME,
            coalesce((ny->>'id')::uuid, (ny->>'company_id')::uuid), 'update', diff);
    return NEW;
  end if;

  -- Hard delete skal ikke forekomme (regel 5 er soft delete), men skjer den,
  -- er den nettopp det man vil ha i sporet.
  insert into public.audit_events (company_id, actor_id, actor_name, tabell, rad_id, operasjon, endringer)
  values (firma, auth.uid(), audit_actor_name(), TG_TABLE_NAME,
          coalesce((to_jsonb(OLD)->>'id')::uuid, (to_jsonb(OLD)->>'company_id')::uuid), 'delete',
          to_jsonb(OLD) - 'created_at' - 'updated_at');
  return OLD;
end $$;

-- Den ene raden som alt er skrevet uten rad_id. Sporet er append-only for
-- klienter (én policy, og den er SELECT), men her er det skjemaeieren som
-- retter et kjent hull, ikke en app som skriver om sin egen historikk.
update public.audit_events
set rad_id = (endringer->>'company_id')::uuid
where rad_id is null and endringer ? 'company_id';
