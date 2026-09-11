-- FELTNIVÅ-FLETTING VED PUSH (2026-08-30).
--
-- PROBLEMET, målt og reprodusert i tools/verify-e2e.ts steg 7b:
-- push skrev HELE raden. To montører med samme ordre i lomma, som endret hvert
-- sitt felt, endte med at den siste overskrev den førstes arbeid sporløst.
-- A satte status til 'fakturaklar', B pushet en merknad med sin gamle kopi, og
-- A sin status var borte. Ingen feilmelding, ingen spor.
--
-- LØSNINGEN: WatermelonDB sender allerede `_changed` i hver rad — bibliotekets
-- egen liste over hvilke kolonner enheten faktisk rørte (se
-- node_modules/@nozbe/watermelondb/sync/impl/fetchLocal.js, der det står som en
-- TODO at feltet IKKE strippes før det sendes). Serveren hadde altså
-- informasjonen hele tiden, men brukte den ikke. Nå skrives bare de kolonnene.
--
-- `updated_at` settes alltid, ellers ser raden urørt ut for de andre enhetenes
-- inkrementelle pull, og endringen ville aldri nådd fram.
--
-- Mangler `_changed` (eldre klient, eller en rad som opprettes), faller vi
-- tilbake til gammel oppførsel med full skriving. Ingen klient slutter å virke.
--
-- Eneste endring fra forrige versjon er `endrede`-variabelen og den ene
-- `if`-en merket «Kjernen» under. Resten står urørt med vilje.
create or replace function public.watermelon_push(changes jsonb, last_pulled_at bigint DEFAULT 0)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  t record; r jsonb; payload jsonb;
  cols text[]; ins_cols text[]; sel_cols text[]; sett text[]; ider text[]; k text;
  truffet int;
  endrede text[];
begin
  for t in select table_name, no_update from public.sync_tables order by push_order, table_name loop
    if changes -> t.table_name is null then continue; end if;

    for r in select * from jsonb_array_elements(
      coalesce(changes -> t.table_name -> 'created', '[]'::jsonb) ||
      coalesce(changes -> t.table_name -> 'updated', '[]'::jsonb)) loop

      payload := public.sync_payload_in(t.table_name, r);

      endrede := case
        when coalesce(r ->> '_changed', '') = '' then null
        else string_to_array(r ->> '_changed', ',')
      end;

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
        -- Kjernen: rør bare det enheten selv endret.
        if endrede is not null and k <> 'updated_at' and not (k = any (endrede)) then continue; end if;
        sett := sett || format('%1$I = r.%1$I', k);
      end loop;

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
end $function$;
