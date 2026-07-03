-- Prosedyrer: revisjonshistorikk + tilbakemeldinger (levende prosedyresystem)

alter table public.protocols
  add column if not exists current_revision_number int not null default 1;

comment on column public.protocols.current_revision_number is
  'Gjeldende revisjonsnummer; økes når admin laster opp ny PDF.';

alter table public.protocol_acknowledgements
  add column if not exists revision_number int not null default 1;

comment on column public.protocol_acknowledgements.revision_number is
  'Revisjon brukeren bekreftet å ha lest.';

-- ── Revisjonshistorikk ────────────────────────────────────────────────
create table if not exists public.protocol_revisions (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id) on delete cascade,
  revision_number int not null,
  file_path text not null,
  content_text text,
  change_note text,
  diff_summary jsonb,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint protocol_revisions_protocol_revision_unique unique (protocol_id, revision_number)
);

create index if not exists idx_protocol_revisions_protocol_id
  on public.protocol_revisions (protocol_id);

comment on table public.protocol_revisions is
  'Arkiverte PDF-revisjoner når prosedyre oppdateres.';

-- ── Tilbakemeldinger / forbedringspunkter ─────────────────────────────
create table if not exists public.protocol_feedback (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'improvement'
    check (kind in ('improvement', 'question', 'feedback')),
  body text not null,
  page_number int,
  revision_number int,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_protocol_feedback_protocol_id
  on public.protocol_feedback (protocol_id);

create index if not exists idx_protocol_feedback_created_at
  on public.protocol_feedback (protocol_id, created_at desc);

comment on table public.protocol_feedback is
  'Felt-tilbakemeldinger og forbedringsforslag på prosedyrer.';

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.protocol_revisions enable row level security;
alter table public.protocol_feedback enable row level security;

drop policy if exists "protocol_revisions_select" on public.protocol_revisions;
create policy "protocol_revisions_select"
on public.protocol_revisions for select
using (
  exists (
    select 1 from public.protocols p
    where p.id = protocol_id
      and p.company_id = public.get_user_company_id()
  )
);

drop policy if exists "protocol_revisions_insert" on public.protocol_revisions;
create policy "protocol_revisions_insert"
on public.protocol_revisions for insert
with check (
  exists (
    select 1 from public.protocols p
    where p.id = protocol_id
      and p.company_id = public.get_user_company_id()
  )
  and public.is_company_admin()
);

drop policy if exists "protocol_feedback_select" on public.protocol_feedback;
create policy "protocol_feedback_select"
on public.protocol_feedback for select
using (
  exists (
    select 1 from public.protocols p
    where p.id = protocol_id
      and p.company_id = public.get_user_company_id()
  )
);

drop policy if exists "protocol_feedback_insert" on public.protocol_feedback;
create policy "protocol_feedback_insert"
on public.protocol_feedback for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.protocols p
    where p.id = protocol_id
      and p.company_id = public.get_user_company_id()
  )
);

drop policy if exists "protocol_feedback_update" on public.protocol_feedback;
create policy "protocol_feedback_update"
on public.protocol_feedback for update
using (
  exists (
    select 1 from public.protocols p
    where p.id = protocol_id
      and p.company_id = public.get_user_company_id()
  )
  and public.is_company_admin()
);
