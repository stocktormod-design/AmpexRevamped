-- Dedikert regnskapsrolle (viser Regnskap i meny — ikke alle admin).

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role'
      and e.enumlabel = 'regnskapsforer'
  ) then
    alter type public.app_role add value 'regnskapsforer';
  end if;
end $$;
