-- Egenskaper tolket ut av varenavnet (lib/katalog/egenskaper.ts, selvtestet i
-- verify:egenskaper). Grossistens standardfil har ingen egne felt for farge,
-- IP-klasse eller leder; navnet har dem ofte. Fylles av katalog:til-supabase.
-- Tomt betyr «står ikke i navnet», ikke «har ikke».
alter table public.katalog_varer
  add column if not exists farge        text,
  add column if not exists ip           text,
  add column if not exists leder        text,
  add column if not exists spenning     text,
  add column if not exists strom_a      numeric,
  add column if not exists kurve        text,
  add column if not exists jordfeil_ma  integer,
  add column if not exists poler        text,
  add column if not exists effekt_w     numeric,
  add column if not exists lumen        integer,
  add column if not exists kelvin       integer;

create index if not exists katalog_varer_farge on public.katalog_varer (farge) where farge is not null;
create index if not exists katalog_varer_ip on public.katalog_varer (ip) where ip is not null;
create index if not exists katalog_varer_leder on public.katalog_varer (leder) where leder is not null;
