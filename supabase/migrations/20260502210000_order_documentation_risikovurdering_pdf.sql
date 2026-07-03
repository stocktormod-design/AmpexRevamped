-- Steg 1 som PDF-rad (samme tabell som øvrige dokumenter).

insert into public.order_documentation (order_id, section_key, template_type, payload, is_completed)
select
  o.id,
  'order_risikovurdering',
  o.type,
  '{}'::jsonb,
  false
from public.orders o
on conflict (order_id, section_key) do nothing;
