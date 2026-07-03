-- Seed five fixed documentation rows per order (canonical section keys, per order_id).
-- Legacy rows (e.g. sjekkliste-bolig) are left untouched; UI and server logic use the new keys only.

insert into public.order_documentation (order_id, section_key, template_type, payload, is_completed)
select
  o.id,
  s.section_key,
  o.type,
  '{"notes":""}'::jsonb,
  false
from public.orders o
cross join (
  values
    ('order_sjekkliste'),
    ('order_samsvar'),
    ('order_kursfortegnelse'),
    ('order_sluttkontroll'),
    ('order_utstyr_fel36')
) as s(section_key)
on conflict (order_id, section_key) do nothing;
