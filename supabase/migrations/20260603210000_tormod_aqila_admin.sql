-- Promote Tormod to admin + test tools (Aqila) for UI/rolle-forhåndsvisning.
update public.profiles
set
  role = 'admin'::public.app_role,
  admin_test_tools_enabled = true
where id = (
  select id from auth.users where lower(email) = lower('tormod.holand.arntsen@aqila.no') limit 1
);
