-- Prosjektsted for arbeidsdag / nærhetsforslag (kan brukes når ordre-kunde mangler GPS).

alter table public.projects
  add column if not exists site_address text,
  add column if not exists site_latitude double precision,
  add column if not exists site_longitude double precision,
  add column if not exists site_maps_query text;

comment on column public.projects.site_address is 'Anleggsadresse (visning + geokoding).';
comment on column public.projects.site_latitude is 'WGS84 for arbeidsdag / simulator.';
comment on column public.projects.site_longitude is 'WGS84 for arbeidsdag / simulator.';
