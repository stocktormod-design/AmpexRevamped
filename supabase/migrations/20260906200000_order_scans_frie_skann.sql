-- Frie skann (2026-09-06): et skann trenger ikke høre til en ordre. Skann-lista
-- på Hjem/Meg lager rader uten order_id; de kan knyttes til en ordre senere.
alter table public.order_scans alter column order_id drop not null;
