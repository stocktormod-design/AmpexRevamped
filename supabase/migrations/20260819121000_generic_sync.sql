-- Generisk WatermelonDB-synk, drevet av et register i stedet for håndskrevet
-- SQL per tabell.
--
-- Den forrige implementasjonen listet hver kolonne for hånd, tre ganger per
-- tabell (created, updated, push). Pull alene var 11 KB, og push var delt i
-- _watermelon_push_core pluss ni per-tabell-funksjoner. Resultatet var at nye
-- kolonner ble glemt: pris, MVA og kunde-ID finnes i appen, men ville aldri
-- krysset nettverket. Stille datatap som ingen oppdager før en faktura mangler
-- en linje.
--
-- Her leses kolonnene fra katalogen. Ny tabell = én rad i sync_tables.
--
-- _watermelon_pull_core, _watermelon_push_core og watermelon_push_* beholdes
-- med vilje, ubrukt. De er tilbakeveien — repoets migrasjonsmappe har ikke
-- definisjonene deres (se docs/DB_DRIFT.md).

create table if not exists public.sync_tables (
  table_name text primary key,
  -- Lav verdi pushes først. Nødvendig for fremmednøkler: en ordre kan peke på
  -- en kunde som ble opprettet i samme push.
  push_order int not null default 100,
  -- Kolonner klienten kan sette ved INSERT, men aldri overskrive ved UPDATE.
  -- order_number er den viktige: en offline-opprettet ordre har null lokalt til
  -- den har synket tilbake, og en tidlig redigering ville nullet nummeret
  -- serveren allerede tildelte.
  no_update text[] not null default '{}'
);

insert into public.sync_tables (table_name, push_order, no_update) values
  ('customers',               10, '{}'),
  ('activities',              10, '{}'),
  ('products',                10, '{}'),
  ('locations',               10, '{}'),
  ('projects',                10, '{}'),
  ('form_templates',          10, '{}'),
  ('orders',                  20, '{order_number}'),
  ('drawings',                20, '{}'),
  ('rooms',                   25, '{}'),
  ('order_materials',         30, '{}'),
  ('time_entries',            30, '{}'),
  ('order_members',           30, '{}'),
  ('order_documents',         30, '{}'),
  ('order_scans',             30, '{}'),
  ('stock_movements',         30, '{}'),
  ('project_members',         30, '{}'),
  ('tasks',                   30, '{}'),
  ('drawing_markup',          30, '{}'),
  ('drawing_loops',           30, '{}'),
  ('form_template_revisions', 30, '{}'),
  ('form_comments',           30, '{}')
on conflict (table_name) do nothing;

alter table public.sync_tables enable row level security;
drop policy if exists sync_tables_read on public.sync_tables;
create policy sync_tables_read on public.sync_tables for select to authenticated using (true);

-- company_id og deleted_at krysser aldri grensen: klienten skal verken se dem
-- eller kunne sette dem. created_by SENDES til klienten (den vises i UI), men
-- tas aldri imot — serveren setter den fra auth.uid().
create or replace function public.sync_hidden_columns()
returns text[] language sql immutable as
$$ select array['company_id', 'deleted_at'] $$;

create or replace function public.sync_pull_columns(_table text)
returns table (column_name text, data_type text)
language sql stable set search_path = public as $$
  select c.column_name::text, c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = _table
    and not (c.column_name = any (public.sync_hidden_columns()))
  order by c.ordinal_position
$$;

-- Bygger jsonb_build_object(...) for pull. To konverteringer må gjøres:
-- timestamptz til epoch-millisekunder (WatermelonDBs datoformat), og enum til
-- text (klienten har ingen enum-type).
create or replace function public.sync_pull_expr(_table text)
returns text language plpgsql stable set search_path = public as $$
declare c record; deler text[] := '{}';
begin
  for c in select * from public.sync_pull_columns(_table) loop
    deler := deler || format('%L', c.column_name);
    if c.data_type = 'timestamp with time zone' then
      deler := deler || format('(extract(epoch from x.%I) * 1000)::bigint', c.column_name);
    elsif c.data_type = 'USER-DEFINED' then
      deler := deler || format('x.%I::text', c.column_name);
    else
      deler := deler || format('x.%I', c.column_name);
    end if;
  end loop;
  return 'jsonb_build_object(' || array_to_string(deler, ', ') || ')';
end $$;

create or replace function public.watermelon_pull(last_pulled_at bigint default 0)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  _now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  _cutoff timestamptz := to_timestamp(last_pulled_at / 1000.0);
  _changes jsonb := '{}'::jsonb;
  _created jsonb; _updated jsonb; _deleted jsonb; _expr text; t record;
begin
  for t in select table_name from public.sync_tables order by table_name loop
    _expr := public.sync_pull_expr(t.table_name);

    -- Skillet created/updated er ikke kosmetikk: en rad i "created" som alt
    -- finnes lokalt er en feil i WatermelonDB, ikke en oppdatering.
    execute format(
      'select coalesce(jsonb_agg(%s), ''[]''::jsonb) from public.%I x
       where x.deleted_at is null and x.created_at > $1', _expr, t.table_name)
      into _created using _cutoff;

    execute format(
      'select coalesce(jsonb_agg(%s), ''[]''::jsonb) from public.%I x
       where x.deleted_at is null and x.updated_at > $1 and x.created_at <= $1', _expr, t.table_name)
      into _updated using _cutoff;

    execute format(
      'select coalesce(jsonb_agg(x.id), ''[]''::jsonb) from public.%I x
       where x.deleted_at is not null and x.deleted_at > $1', t.table_name)
      into _deleted using _cutoff;

    _changes := _changes || jsonb_build_object(t.table_name,
      jsonb_build_object('created', _created, 'updated', _updated, 'deleted', _deleted));
  end loop;

  return jsonb_build_object('changes', _changes, 'timestamp', _now_ms);
end $$;

-- Gjør klientraden klar for jsonb_populate_record.
create or replace function public.sync_payload_in(_table text, r jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare c record; v jsonb; ut jsonb := r;
begin
  for c in select * from public.sync_pull_columns(_table)
           where data_type = 'timestamp with time zone' loop
    v := ut -> c.column_name;
    if v is not null and jsonb_typeof(v) = 'number' then
      ut := jsonb_set(ut, array[c.column_name],
                      to_jsonb(to_timestamp((v #>> '{}')::numeric / 1000.0)));
    end if;
  end loop;

  -- company_id og created_by settes ALLTID server-side. Klienten kan ikke
  -- skrive seg inn i et annet firma uansett hva den sender. RLS håndhever det
  -- samme, men to låser på samme dør er billig.
  -- updated_at fra serverklokka: en telefon med feil klokke skal ikke kunne
  -- vinne en last-write-wins-konflikt den taper i virkeligheten.
  return (ut - 'deleted_at') || jsonb_build_object(
    'company_id', to_jsonb(public.current_company_id()),
    'created_by', to_jsonb(auth.uid()),
    'updated_at', to_jsonb(now()));
end $$;

create or replace function public.watermelon_push(changes jsonb, last_pulled_at bigint default 0)
returns void language plpgsql set search_path = public as $$
declare
  t record; r jsonb; payload jsonb;
  cols text[]; ins_cols text[]; sel_cols text[]; sett text[]; ider text[]; k text;
  truffet int;
begin
  for t in select table_name, no_update from public.sync_tables order by push_order, table_name loop
    if changes -> t.table_name is null then continue; end if;

    for r in select * from jsonb_array_elements(
      coalesce(changes -> t.table_name -> 'created', '[]'::jsonb) ||
      coalesce(changes -> t.table_name -> 'updated', '[]'::jsonb)) loop

      payload := public.sync_payload_in(t.table_name, r);

      -- Kun kolonner som finnes BÅDE i tabellen og i raden klienten sendte.
      -- Utelatte kolonner får sin default ved insert, og røres ikke ved update
      -- — en gammel klient kan aldri nulle et felt den ikke kjenner.
      select coalesce(array_agg(c.column_name::text order by c.ordinal_position), '{}')
        into cols from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t.table_name
         and c.column_name in (select jsonb_object_keys(payload));

      ins_cols := '{}'; sel_cols := '{}'; sett := '{}';
      foreach k in array cols loop
        ins_cols := ins_cols || format('%I', k);
        sel_cols := sel_cols || format('r.%I', k);
        if k in ('id', 'created_at', 'company_id', 'created_by') then continue; end if;
        if k = any (t.no_update) then continue; end if;
        sett := sett || format('%1$I = r.%1$I', k);
      end loop;

      -- UPDATE først, INSERT bare hvis ingen rad ble truffet.
      --
      -- Ikke `insert … on conflict do update`: Postgres evaluerer INSERT-delen
      -- FØR konflikten oppdages, så en oppdatering der klienten sendte et
      -- delsett av kolonnene ville brutt NOT NULL på en kolonne som ikke var
      -- med — selv om raden allerede finnes med verdien i behold.
      truffet := 0;
      if array_length(sett, 1) is not null then
        execute format(
          'update public.%1$I dst set %2$s
           from jsonb_populate_record(null::public.%1$I, $1) r
           where dst.id = r.id and dst.company_id = public.current_company_id()',
          t.table_name, array_to_string(sett, ', ')) using payload;
        get diagnostics truffet = row_count;
      end if;

      if truffet = 0 then
        -- `do nothing` og ikke `do update`: treffer vi en konflikt her, tilhører
        -- raden et annet firma, og da skal den være urørlig.
        execute format(
          'insert into public.%1$I (%2$s) select %3$s
           from jsonb_populate_record(null::public.%1$I, $1) r
           on conflict (id) do nothing',
          t.table_name, array_to_string(ins_cols, ', '), array_to_string(sel_cols, ', '))
        using payload;
      end if;
    end loop;

    select coalesce(array_agg(value), '{}') into ider
      from jsonb_array_elements_text(coalesce(changes -> t.table_name -> 'deleted', '[]'::jsonb));

    if array_length(ider, 1) > 0 then
      execute format(
        'update public.%I set deleted_at = now()
         where deleted_at is null and company_id = public.current_company_id()
           and id = any ($1::uuid[])', t.table_name) using ider;
    end if;
  end loop;
end $$;

revoke execute on function public.watermelon_pull(bigint) from anon;
revoke execute on function public.watermelon_push(jsonb, bigint) from anon;
grant execute on function public.watermelon_pull(bigint) to authenticated;
grant execute on function public.watermelon_push(jsonb, bigint) to authenticated;
grant select on public.sync_tables to authenticated;
