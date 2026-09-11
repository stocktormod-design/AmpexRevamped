-- Internkontroll: firmaets IK-system, punkt for punkt.
--
-- Hvorfor egne tabeller og ikke `form_templates`: et IK-punkt er en RUTINE med
-- hjemmel, ansvarlig person og gjennomgangsfrist. Et skjema er noe man fyller
-- ut. De to henger sammen — punktet «Sluttkontroll» peker på sluttkontroll-
-- skjemaet — men de er ikke det samme, og et kapittel presset inn i en
-- skjemamal mister nettopp de feltene som gjør IK-systemet levende.
--
-- Den levende delen er tre ting, og alle tre er kolonner her:
--   1. `sist_gjennomgatt` + `gjennomgang_intervall_mnd` — et punkt som ikke er
--      sett på i tide skal si fra selv. Uten dette blir IK-systemet en perm.
--   2. `ik_revisjoner` — hver endring beholdes med endringsnotat og hvem.
--      Append-only: en rutine som ble endret etter en hendelse skal kunne
--      dokumenteres slik den var DA hendelsen skjedde.
--   3. `audit_row`-triggere — samme sporing som resten av basen.
--
-- Tilbakerulling: `drop table ik_punkt_skjema, ik_revisjoner, ik_punkter;`
-- Migrasjonen rører ingen eksisterende tabell bortsett fra å legge til
-- audit-triggere på form_templates og form_template_revisions, som manglet.

-- ── Punktene ────────────────────────────────────────────────────────────────

create table if not exists public.ik_punkter (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id),

  -- Firmaets egen nummerering. Tekst og ikke tall, fordi «2.1» er vanlig.
  nummer text not null,
  tittel text not null,

  -- Hjemmelen punktet svarer på, f.eks. «Internkontrollforskriften § 5 andre
  -- ledd nr. 6». Fritekst med vilje: forskrifter endres, og et system som
  -- låser henvisningen til en kodeliste blir feil ved neste revisjon.
  hjemmel text,

  -- Hva punktet skal sikre. Skilt fra `innhold` fordi formålet sjelden endres
  -- mens rutinen gjør det.
  formal text,
  -- Selve rutinen. Ren tekst.
  innhold text,

  ansvarlig uuid references public.profiles(id),

  status text not null default 'utkast'
    check (status in ('utkast', 'vedtatt', 'utgatt')),

  -- Den levende delen.
  gjennomgang_intervall_mnd integer not null default 12
    check (gjennomgang_intervall_mnd between 1 and 120),
  sist_gjennomgatt date,

  vedtatt_at timestamptz,
  vedtatt_av uuid references public.profiles(id),

  gjeldende_versjon integer not null default 1,
  sort_order integer not null default 0,

  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Ett nummer kan bare brukes én gang om gangen. Slettede punkter frigjør
-- nummeret sitt, så en omnummerering ikke låser seg på et slettet punkt.
create unique index if not exists ik_punkter_nummer_unik
  on public.ik_punkter (company_id, nummer) where deleted_at is null;
create index if not exists ik_punkter_company_idx on public.ik_punkter (company_id);
create index if not exists ik_punkter_status_idx on public.ik_punkter (status);

-- ── Revisjonene ─────────────────────────────────────────────────────────────

create table if not exists public.ik_revisjoner (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id),
  punkt_id uuid not null references public.ik_punkter(id) on delete cascade,

  versjon integer not null,
  -- Hele punktet slik det var. Ikke bare en diff: skal man dokumentere hva
  -- rutinen SA en gitt dag, må teksten stå der hel.
  tittel text not null,
  hjemmel text,
  formal text,
  innhold text,

  -- Hvorfor det ble endret. Påkrevd — en revisjon uten begrunnelse er en
  -- revisjon ingen kan vurdere i ettertid.
  endringsnotat text not null,
  endret_av uuid default auth.uid(),
  endret_av_navn text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists ik_revisjoner_versjon_unik
  on public.ik_revisjoner (punkt_id, versjon);
create index if not exists ik_revisjoner_company_idx on public.ik_revisjoner (company_id);

-- ── Skjemaene som hører til et punkt ────────────────────────────────────────

create table if not exists public.ik_punkt_skjema (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id),
  punkt_id uuid not null references public.ik_punkter(id) on delete cascade,
  template_id uuid not null references public.form_templates(id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists ik_punkt_skjema_unik
  on public.ik_punkt_skjema (punkt_id, template_id) where deleted_at is null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Lesing: hele firmaet. Et IK-system ingen får lese er ikke et IK-system.
-- Skriving: eier, administrator og installatør. Installatøren er den faglig
-- ansvarlige, og det er han som eier de el-faglige rutinene.

alter table public.ik_punkter enable row level security;
alter table public.ik_revisjoner enable row level security;
alter table public.ik_punkt_skjema enable row level security;

create or replace function public.kan_skrive_ik() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role = any (array['owner'::app_role, 'admin'::app_role, 'installator'::app_role])
  );
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_punkter' and policyname='ik_punkter_sel') then
    create policy ik_punkter_sel on public.ik_punkter for select using (company_id = public.current_company_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_punkter' and policyname='ik_punkter_ins') then
    create policy ik_punkter_ins on public.ik_punkter for insert
      with check (company_id = public.current_company_id() and public.kan_skrive_ik());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_punkter' and policyname='ik_punkter_upd') then
    create policy ik_punkter_upd on public.ik_punkter for update
      using (company_id = public.current_company_id() and public.kan_skrive_ik())
      with check (company_id = public.current_company_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_revisjoner' and policyname='ik_revisjoner_sel') then
    create policy ik_revisjoner_sel on public.ik_revisjoner for select using (company_id = public.current_company_id());
  end if;
  -- Ingen update-policy med vilje: revisjonene er append-only. En historikk som
  -- kan redigeres er ingen historikk.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_revisjoner' and policyname='ik_revisjoner_ins') then
    create policy ik_revisjoner_ins on public.ik_revisjoner for insert
      with check (company_id = public.current_company_id() and public.kan_skrive_ik());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_punkt_skjema' and policyname='ik_punkt_skjema_sel') then
    create policy ik_punkt_skjema_sel on public.ik_punkt_skjema for select using (company_id = public.current_company_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_punkt_skjema' and policyname='ik_punkt_skjema_ins') then
    create policy ik_punkt_skjema_ins on public.ik_punkt_skjema for insert
      with check (company_id = public.current_company_id() and public.kan_skrive_ik());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_punkt_skjema' and policyname='ik_punkt_skjema_upd') then
    create policy ik_punkt_skjema_upd on public.ik_punkt_skjema for update
      using (company_id = public.current_company_id() and public.kan_skrive_ik())
      with check (company_id = public.current_company_id());
  end if;
end $$;

-- ── Triggere ────────────────────────────────────────────────────────────────

drop trigger if exists ik_punkter_touch on public.ik_punkter;
create trigger ik_punkter_touch before update on public.ik_punkter
  for each row execute function public.touch_updated_at();

drop trigger if exists ik_punkt_skjema_touch on public.ik_punkt_skjema;
create trigger ik_punkt_skjema_touch before update on public.ik_punkt_skjema
  for each row execute function public.touch_updated_at();

drop trigger if exists ik_punkter_audit on public.ik_punkter;
create trigger ik_punkter_audit after insert or update or delete on public.ik_punkter
  for each row execute function public.audit_row();

drop trigger if exists ik_revisjoner_audit on public.ik_revisjoner;
create trigger ik_revisjoner_audit after insert or update or delete on public.ik_revisjoner
  for each row execute function public.audit_row();

drop trigger if exists ik_punkt_skjema_audit on public.ik_punkt_skjema;
create trigger ik_punkt_skjema_audit after insert or update or delete on public.ik_punkt_skjema
  for each row execute function public.audit_row();

-- Skjemamalene manglet sporing helt. En firmamal er dokumentasjon på linje med
-- resten, og hvem som endret en sluttkontroll er verdt å vite.
drop trigger if exists form_templates_audit on public.form_templates;
create trigger form_templates_audit after insert or update or delete on public.form_templates
  for each row execute function public.audit_row();

drop trigger if exists form_revisions_audit on public.form_template_revisions;
create trigger form_revisions_audit after insert or update or delete on public.form_template_revisions
  for each row execute function public.audit_row();
