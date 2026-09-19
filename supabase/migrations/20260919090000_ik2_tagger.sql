-- Tagger i internkontroll v2 (2026-09-19): et register, ikke fritekst.
--
-- Før sto taggen som én tekst på rutinen («Måling, FSE, HMS» — tre tagger i
-- ett felt), og filteret ble bygget av det som tilfeldigvis var skrevet. Nå
-- lages taggen én gang, settes på så mange rutiner man vil, og filteret er
-- registeret. `ik2_rutiner.tag` blir stående, men skrives ikke lenger.

create table public.ik2_tagger (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  navn text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger ik2_tagger_touch before update on public.ik2_tagger
  for each row execute function public.touch_updated_at();
create trigger ik2_tagger_audit after insert or update or delete on public.ik2_tagger
  for each row execute function public.audit_row();
-- Samme navn to ganger i samme firma er én tagg, uansett store bokstaver.
create unique index ik2_tagger_navn_idx on public.ik2_tagger (company_id, lower(navn)) where deleted_at is null;
alter table public.ik2_tagger enable row level security;
create policy ik2_tagger_select on public.ik2_tagger
  for select using (company_id = public.current_company_id());
create policy ik2_tagger_insert on public.ik2_tagger
  for insert with check (company_id = public.current_company_id());
create policy ik2_tagger_update on public.ik2_tagger
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Koblingen rutine ↔ tagg. En kobling er ikke data, det er et forhold; den
-- slettes hardt når taggen tas av rutinen. Taggen selv slettes mykt.
create table public.ik2_rutine_tagger (
  rutine_id uuid not null references public.ik2_rutiner (id),
  tag_id uuid not null references public.ik2_tagger (id),
  company_id uuid not null references public.companies (id),
  created_at timestamptz not null default now(),
  primary key (rutine_id, tag_id)
);
create index ik2_rutine_tagger_tag_idx on public.ik2_rutine_tagger (tag_id);
alter table public.ik2_rutine_tagger enable row level security;
create policy ik2_rutine_tagger_select on public.ik2_rutine_tagger
  for select using (company_id = public.current_company_id());
create policy ik2_rutine_tagger_insert on public.ik2_rutine_tagger
  for insert with check (company_id = public.current_company_id());
create policy ik2_rutine_tagger_delete on public.ik2_rutine_tagger
  for delete using (company_id = public.current_company_id());

-- Det som alt står i fritekstfeltet blir tagger: «Måling, FSE, HMS» → tre.
with deler as (
  select r.id as rutine_id, r.company_id, trim(d) as navn
  from public.ik2_rutiner r, unnest(string_to_array(r.tag, ',')) as d
  where r.deleted_at is null and r.tag is not null and trim(d) <> ''
), nye as (
  insert into public.ik2_tagger (id, company_id, navn, sort_order)
  select gen_random_uuid(), company_id, min(navn), 0
  from deler group by company_id, lower(navn)
  returning id, company_id, navn
)
insert into public.ik2_rutine_tagger (rutine_id, tag_id, company_id)
select d.rutine_id, n.id, d.company_id
from deler d join nye n on n.company_id = d.company_id and lower(n.navn) = lower(d.navn)
on conflict do nothing;
