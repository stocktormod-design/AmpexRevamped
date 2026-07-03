-- Firmaets vanlige arbeidsdag (lokal tid, brukes av auto arbeidsdag i app).

alter table public.companies
  add column if not exists work_day_start time not null default '08:00';

alter table public.companies
  add column if not exists work_day_end time not null default '16:00';

comment on column public.companies.work_day_start is
  'Start av firmas arbeidsvindu for auto arbeidsdag (lokal tid, Europe/Oslo i app).';

comment on column public.companies.work_day_end is
  'Slutt av firmas arbeidsvindu for auto arbeidsdag (lokal tid).';

alter table public.companies
  drop constraint if exists companies_work_day_hours_order;

alter table public.companies
  add constraint companies_work_day_hours_order
  check (work_day_end > work_day_start);
