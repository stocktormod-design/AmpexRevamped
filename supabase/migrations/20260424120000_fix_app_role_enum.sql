-- Sikrer app_role: montor (fra worker) + apprentice. Idempotent.
-- Trengs hvis migrasjonshistorikk sa 20260422120000 var applied uten at DDL faktisk kjørte.

do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'worker'
  ) then
    alter type public.app_role rename value 'worker' to 'montor';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'apprentice'
  ) then
    alter type public.app_role add value 'apprentice';
  end if;
end $$;

alter table public.profiles
  alter column role set default 'montor'::public.app_role;
