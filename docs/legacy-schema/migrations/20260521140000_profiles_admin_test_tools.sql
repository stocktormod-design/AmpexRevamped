-- Admin-only: aktiverer testverktøy i innstillinger (øy-demo, push-test).

alter table public.profiles
  add column if not exists admin_test_tools_enabled boolean not null default false;

comment on column public.profiles.admin_test_tools_enabled is
  'Kun owner/admin: viser test-panel for arbeidsdag-øy og push-varsler.';
