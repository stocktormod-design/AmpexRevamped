-- Fire dokumentseksjoner etter SJA (rekkefølge: samsvar, sluttkontroll, kursfortegnelse, utstyr).
-- Fjerner tidligere «order_sjekkliste»-rad; legger inn manglende av de fire nøklene.

delete from public.order_documentation
where section_key = 'order_sjekkliste';

insert into public.order_documentation (order_id, section_key, template_type, payload, is_completed)
select
  o.id,
  s.section_key,
  o.type,
  '{}'::jsonb,
  false
from public.orders o
cross join (
  values
    ('order_samsvar'),
    ('order_sluttkontroll'),
    ('order_kursfortegnelse'),
    ('order_utstyr_fel36')
) as s(section_key)
on conflict (order_id, section_key) do nothing;
