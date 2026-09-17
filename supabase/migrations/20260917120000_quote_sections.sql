-- Områder i tilbudet (2026-09-17): «Stue 32 500», «Kjøkken 12 500», og en sum
-- per rom i stedet for én flat linjeliste. Et tilbud på en enebolig er i
-- praksis alltid delt opp av montøren selv, med tekstlinjer som overskrifter —
-- da teller ikke summen per rom, og kunden som spør «hva koster bare kjøkkenet»
-- får ikke svar uten at noen regner for hånd.
--
-- Nestet via parent_id: bygg → etasje → rom er tre nivåer, og det er så dypt
-- som noen faktisk går. Appen viser ett nivå; dybden finnes for kontoret.
create table public.quote_sections (
  id uuid primary key,
  company_id uuid not null references public.companies (id),
  quote_id uuid not null references public.quotes (id),
  parent_id uuid references public.quote_sections (id),
  name text not null default '',
  sort_order integer not null default 0,
  -- Hvor området kom fra: montøren selv, et rom fra tegningen, eller en pakke.
  -- Det avgjør om det kan kobles tilbake når tegningen endres.
  source text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger quote_sections_touch before update on public.quote_sections
  for each row execute function public.touch_updated_at();
create trigger quote_sections_audit after insert or update or delete on public.quote_sections
  for each row execute function public.audit_row();
create index quote_sections_company_updated_idx on public.quote_sections (company_id, updated_at);
create index quote_sections_quote_idx on public.quote_sections (quote_id) where deleted_at is null;
create index quote_sections_parent_idx on public.quote_sections (parent_id) where deleted_at is null;
alter table public.quote_sections enable row level security;
create policy quote_sections_company_select on public.quote_sections
  for select using (company_id = public.current_company_id());
create policy quote_sections_company_insert on public.quote_sections
  for insert with check (company_id = public.current_company_id());
create policy quote_sections_company_update on public.quote_sections
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- push_order 25: ETTER quotes (15), FØR quote_lines (30) — linja peker hit.
insert into public.sync_tables (table_name, push_order, no_update)
values ('quote_sections', 25, '{}')
on conflict (table_name) do nothing;

-- Null = linja ligger rett i tilbudet, som før. Et slettet område skal ALDRI
-- ta linjene med seg (penger som forsvinner fra en sum er verre enn et rot);
-- lib/quotes.ts legger dem tilbake på tilbudet før området slettes.
alter table public.quote_lines add column if not exists section_id uuid references public.quote_sections (id);
create index if not exists quote_lines_section_idx on public.quote_lines (section_id) where deleted_at is null;
