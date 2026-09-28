-- Internkontrollen leses i montørappen (2026-09-13): punktene og rutinene
-- synkes ned som alt annet. Skriving skjer fra kontoret; appen sender aldri
-- rader for disse tabellene, og RLS (kan_skrive_ik) stopper den om den gjorde.
-- push_order høyt: ingenting i appen peker hit.
insert into public.sync_tables (table_name, push_order, no_update)
values ('ik_punkter', 90, '{}'), ('ik_rutiner', 91, '{}')
on conflict (table_name) do nothing;

-- Ny tabell skal gi telefonen ALLE radene første gang, ikke bare de som er nyere
-- enn forrige synk. WatermelonDB sender tabellene lagt til siden forrige synk
-- (migrationsEnabledAtVersion i lib/db/sync.ts); for dem er skjæringen 0.
-- Gamle klienter kaller uten full_tables og får som før. Kjørt live 13.09.
drop function if exists public.watermelon_pull(bigint);

create or replace function public.watermelon_pull(last_pulled_at bigint default 0, full_tables text[] default '{}')
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  _now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  _cutoff timestamptz := to_timestamp(last_pulled_at / 1000.0);
  _t_cutoff timestamptz;
  _changes jsonb := '{}'::jsonb;
  _created jsonb; _updated jsonb; _deleted jsonb; _expr text; t record;
begin
  for t in select table_name from public.sync_tables order by table_name loop
    _expr := public.sync_pull_expr(t.table_name);
    _t_cutoff := case when t.table_name = any (coalesce(full_tables, '{}')) then to_timestamp(0) else _cutoff end;
    execute format(
      'select coalesce(jsonb_agg(%s), ''[]''::jsonb) from public.%I x
       where x.deleted_at is null and x.created_at > $1', _expr, t.table_name)
      into _created using _t_cutoff;
    execute format(
      'select coalesce(jsonb_agg(%s), ''[]''::jsonb) from public.%I x
       where x.deleted_at is null and x.updated_at > $1 and x.created_at <= $1', _expr, t.table_name)
      into _updated using _t_cutoff;
    execute format(
      'select coalesce(jsonb_agg(x.id), ''[]''::jsonb) from public.%I x
       where x.deleted_at is not null and x.deleted_at > $1', t.table_name)
      into _deleted using _t_cutoff;
    _changes := _changes || jsonb_build_object(t.table_name,
      jsonb_build_object('created', _created, 'updated', _updated, 'deleted', _deleted));
  end loop;
  return jsonb_build_object('changes', _changes, 'timestamp', _now_ms);
end $function$;

grant execute on function public.watermelon_pull(bigint, text[]) to authenticated;
-- Som watermelon_push: kun innloggede. (create function gir PUBLIC execute som standard.)
revoke execute on function public.watermelon_pull(bigint, text[]) from public, anon;
