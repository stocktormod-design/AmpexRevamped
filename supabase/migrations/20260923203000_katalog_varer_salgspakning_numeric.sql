-- Solars V4 har desimale salgspakninger (f.eks. «2.1» for kabel på meter).
-- Innlastingen stoppet på bolk 14 med integer; numeric tar begge.
alter table public.katalog_varer alter column salgspakning type numeric using salgspakning::numeric;
