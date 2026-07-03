-- Auto arbeidsdag: én bryter per bruker (innstillinger).

alter table public.profiles
  add column if not exists work_day_auto_enabled boolean not null default false;

comment on column public.profiles.work_day_auto_enabled is
  'Når true: start arbeidsdag automatisk og vis kjøring/timer-forslag (øy-UI) mens appen er i bruk.';
