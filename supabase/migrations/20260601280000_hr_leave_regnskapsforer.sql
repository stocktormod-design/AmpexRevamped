-- Regnskapsfører skal kunne behandle ferie/fravær (samme som HR-portalen i UI).

create or replace function public.can_manage_hr_leave()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('owner', 'admin', 'regnskapsforer')
  );
$$;
