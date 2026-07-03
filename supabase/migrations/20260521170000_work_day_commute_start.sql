-- Tid brukeren vanligvis kjører fra hjem — GPS-sporing starter her (ellers 15 min før work_day_start).
alter table public.companies
  add column if not exists work_day_commute_start time;

comment on column public.companies.work_day_commute_start is
  'Når pendling til jobb vanligvis starter (norsk tid). NULL = 15 min før work_day_start.';
