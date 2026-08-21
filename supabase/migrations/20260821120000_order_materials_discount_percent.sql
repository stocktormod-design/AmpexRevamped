-- Rabatt avtalt i et tilbud fulgte ikke med når tilbudet ble ordre: quote_lines
-- har discount_percent, order_materials hadde det ikke. Et akseptert tilbud med
-- 20 % rabatt ble dermed fakturert til full pris — kunden fikk regning på noe
-- annet enn det hun sa ja til, og ingenting i appen sa fra.
--
-- ANVENDT 21.08.2026.
alter table public.order_materials
  add column if not exists discount_percent numeric;

comment on column public.order_materials.discount_percent is
  'Rabatt i prosent avtalt i tilbudet. Kopieres fra quote_lines ved aksept. Null = ingen rabatt.';
