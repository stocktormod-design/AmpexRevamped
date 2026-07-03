-- Prøveperiode per firma: NULL = ingen begrensning (eksisterende + betalte kunder)
alter table public.companies
  add column if not exists trial_ends_at timestamptz;

comment on column public.companies.trial_ends_at is
  'Når satt og tidspunktet er passert, blokkeres skrivende server actions (lesing tillatt). NULL = ingen prøvegrense.';
