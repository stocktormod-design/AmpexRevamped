-- Loggmalen (2026-09-27). Loggen følger malen lærlingen leverer i fagbrev.io:
-- oppdrag, risikovurdering, materielliste … egenvurdering. Se lib/laeretid/mal.ts.
alter table public.laeretid_logg add column if not exists mal_id text;
alter table public.laeretid_logg add column if not exists utfylling text;
comment on column public.laeretid_logg.mal_id is 'Loggmalen loggen følger (lib/laeretid/mal.ts). Null = standardmalen.';
comment on column public.laeretid_logg.utfylling is 'Malens seksjoner som JSON: tekst per tekstseksjon, rader per tabell. innhold er den samme loggen som ren tekst.';
