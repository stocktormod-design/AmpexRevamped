-- Transport-valg per firma for auto-påfyll: hvordan samlebestillingen sendes.
-- 'simulate' (default, dagens oppførsel = logg), 'email' (Resend → grossist
-- ordremottak), 'edi' (reservert, ikke implementert ennå).

alter table public.company_settings
  add column if not exists auto_order_transport text not null default 'simulate';

alter table public.company_settings
  drop constraint if exists company_settings_auto_order_transport_check;
alter table public.company_settings
  add constraint company_settings_auto_order_transport_check
  check (auto_order_transport in ('simulate', 'email', 'edi'));

comment on column public.company_settings.auto_order_transport is
  'Hvordan auto-påfyll sendes: simulate (logg), email (Resend→ordremottak), edi (reservert).';
