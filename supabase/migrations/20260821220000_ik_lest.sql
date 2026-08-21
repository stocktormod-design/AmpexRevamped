-- Lesebekreftelse på et internkontrollpunkt.
--
-- Internkontrollforskriften § 5 andre ledd nr. 2 krever at arbeidstakerne har
-- tilstrekkelig kunnskap om HMS-arbeidet, «herunder informasjon om endringer».
-- Det er den siste halvdelen som er vanskelig å dokumentere: at folk har lest
-- rutinen ÉN gang sier ingenting om at de har lest den etter at den ble endret.
--
-- ── Derfor er versjonen med i nøkkelen ─────────────────────────────────────
--
-- En bekreftelse gjelder ÉN versjon av ett punkt. Endres rutinen til v3, står
-- alle som bare har bekreftet v2 som uleste igjen — automatisk, uten at noen
-- må huske å nullstille noe. Det er hele mekanismen: en ny revisjon ber om ny
-- bekreftelse fordi den er en ny versjon, ikke fordi et menneske sa fra.
--
-- ── Derfor kan man bare krysse av for seg selv ─────────────────────────────
--
-- `insert`-policyen krever `user_id = auth.uid()`. En bekreftelse noen andre
-- kan sette på dine vegne er ikke et bevis på at du har lest noe, den er et
-- bevis på at noen ville at det skulle se sånn ut.
--
-- Det finnes heller INGEN update- eller delete-policy. En avkrysning som kan
-- redigeres bort i ettertid er ingen dokumentasjon.
--
-- Tilbakerulling: `drop table ik_lest;`

create table if not exists public.ik_lest (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id),
  punkt_id uuid not null references public.ik_punkter(id) on delete cascade,

  -- Versjonen som faktisk ble lest.
  versjon integer not null,

  user_id uuid not null default auth.uid() references public.profiles(id),
  -- Navnet slik det var da. Bytter noen etternavn, skal historikken stå.
  user_navn text,

  lest_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ik_lest_unik on public.ik_lest (punkt_id, user_id, versjon);
create index if not exists ik_lest_company_idx on public.ik_lest (company_id);
create index if not exists ik_lest_punkt_idx on public.ik_lest (punkt_id);

alter table public.ik_lest enable row level security;

do $$
begin
  -- Hele firmaet ser hvem som har lest hva. Det er poenget: faglig ansvarlig
  -- skal kunne se hvem som mangler, og den enkelte skal se sin egen status.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_lest' and policyname='ik_lest_sel') then
    create policy ik_lest_sel on public.ik_lest for select
      using (company_id = public.current_company_id());
  end if;

  -- Kun for seg selv.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_lest' and policyname='ik_lest_ins') then
    create policy ik_lest_ins on public.ik_lest for insert
      with check (company_id = public.current_company_id() and user_id = auth.uid());
  end if;
end $$;

drop trigger if exists ik_lest_touch on public.ik_lest;
create trigger ik_lest_touch before update on public.ik_lest
  for each row execute function public.touch_updated_at();

drop trigger if exists ik_lest_audit on public.ik_lest;
create trigger ik_lest_audit after insert or update or delete on public.ik_lest
  for each row execute function public.audit_row();
