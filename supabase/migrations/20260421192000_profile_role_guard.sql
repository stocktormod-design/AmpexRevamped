drop policy if exists "profiles_update_admin_or_self" on public.profiles;

create policy "profiles_update_owner_or_self"
on public.profiles
for update
using (
  (
    id = auth.uid()
    and (
      company_id = public.get_user_company_id()
      or company_id is null
    )
  )
  or (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.role = 'owner'
    )
  )
)
with check (
  (
    id = auth.uid()
    and (
      company_id = public.get_user_company_id()
      or company_id is null
    )
  )
  or (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.role = 'owner'
    )
  )
);

create policy "profiles_update_admin_non_owner"
on public.profiles
for update
using (
  company_id = public.get_user_company_id()
  and role <> 'owner'
  and exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and me.role = 'admin'
  )
)
with check (
  company_id = public.get_user_company_id()
  and role <> 'owner'
  and exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and me.role = 'admin'
  )
);
