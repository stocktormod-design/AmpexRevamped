-- MERK: kjørt mot basen 21. august 2026 som `ampex_public_pool` +
-- `claim_scan_job_uten_lock_paa_vindu`.

-- Ampex public pool + rettferdig kø + versjonssperre + køposisjon
--
-- Bakgrunn: 20260815120000 lot en node KUN ta jobber fra sitt eget firma
-- (claim_scan_job filtrerer på company_id = node.company_id). Det er riktig for
-- firmaer som setter opp egen PC, men lot firmaer UTEN egen maskin stå uten
-- bakekapasitet i det hele tatt. Denne migrasjonen legger til Ampex-driftede
-- noder som fallback, uten å svekke isolasjonen for dem som har egen node.
--
-- Prioriteringsmekanikken er bevisst enkel og krever ingen koordinering mellom
-- noder: en offentlig node ser kun jobber som har ventet lenger enn
-- `public_pool_grace_seconds`. Er firmaets egen node oppe, rekker den alltid
-- først. Er den nede, tar Ampex-poolen over etter nådetiden.

-- ── Poolinnstillinger — én rad, hele installasjonen ─────────────────────────
create table public.pool_settings (
  id boolean primary key default true check (id),
  -- Noder eldre enn dette avvises i claim. Null = ingen sperre.
  -- Nødvendig når kunder kjører sin egen exe: versjonsskjev bake gir stille
  -- forskjellig resultat, ikke en feilmelding.
  min_worker_version text,
  -- Hvor lenge en jobb må ha ventet før Ampex-poolen kan ta den.
  public_pool_grace_seconds int not null default 90,
  updated_at timestamptz not null default now()
);

insert into public.pool_settings (id) values (true);

create trigger pool_settings_touch
  before update on public.pool_settings
  for each row execute function public.touch_updated_at();

alter table public.pool_settings enable row level security;
-- Leses av alle innloggede (appen viser nådetid/versjonskrav), skrives kun av
-- service_role — dette er driftsinnstillinger for Ampex, ikke for kundene.
create policy pool_settings_read on public.pool_settings
  for select using (auth.role() in ('authenticated', 'anon'));

-- ── Offentlige noder ────────────────────────────────────────────────────────
-- En offentlig node eies fortsatt av et firma (Ampex sitt eget), men får lov å
-- ta jobber på tvers av firmaer som har samtykket.
alter table public.worker_nodes
  add column is_public boolean not null default false;

-- ── Samtykke per jobb ───────────────────────────────────────────────────────
-- Settes ved innlegging fra firmaets innstilling. Er den false, forlater aldri
-- skannet firmaets egne maskiner — det er salgsargumentet for kunder som ikke
-- vil ha data utenfor eget hus.
-- ENDRET FRA UTKASTET, MED VILJE: sto `default true`. Et skann er LiDAR av
-- kundens bolig, og at det pakkes ut på en maskin firmaet ikke eier er en
-- utlevering til tredjepart, ikke en lastbalanseringsdetalj. Slikt skal firmaet
-- slå PÅ, ikke oppdage at noen glemte å skru av.
alter table public.scan_jobs
  add column allow_ampex_pool boolean not null default false;

alter table public.company_settings
  add column if not exists ampex_pool boolean not null default false;

comment on column public.company_settings.ampex_pool is
  'Tillat at skann bakes på Ampex sine maskiner. Av som standard: det er en utlevering av kundens bolig til tredjepart, og skal være et aktivt valg.';

-- Håndhevet i basen, ikke i appen: en klient som setter allow_ampex_pool på et
-- firma som ikke har skrudd det på, får en feil — ikke en stille utlevering.
create or replace function public.krev_ampex_pool_samtykke()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if NEW.allow_ampex_pool
     and not coalesce((select s.ampex_pool from company_settings s
                       where s.company_id = NEW.company_id), false) then
    raise exception 'Firmaet har ikke slått på Ampex-poolen.' using errcode = '42501';
  end if;
  return NEW;
end $$;

create trigger scan_jobs_ampex_pool_trg
  before insert or update of allow_ampex_pool on public.scan_jobs
  for each row execute function public.krev_ampex_pool_samtykke();

revoke execute on function public.krev_ampex_pool_samtykke() from anon, authenticated;

-- Køuttrekket for offentlige noder: eldste ventende jobb med samtykke, uansett firma
create index scan_jobs_public_queue_idx
  on public.scan_jobs (created_at)
  where status = 'queued' and deleted_at is null and allow_ampex_pool;

-- ── Versjonssammenligning ───────────────────────────────────────────────────
-- «0.9.0» < «0.10.0» må være sant, så tekstsammenligning duger ikke.
-- int[] sammenlignes elementvis i Postgres, som er akkurat semantikken vi vil ha.
create or replace function public.version_as_ints(v text)
returns int[]
language sql
immutable
as $$
  select case
    when v is null then null
    when v !~ '^[0-9]+(\.[0-9]+)*$' then null
    else string_to_array(v, '.')::int[]
  end
$$;

-- ── Claim, med public pool, rettferdighet og versjonssperre ─────────────────
create or replace function public.claim_scan_job(
  node_token text,
  lease_seconds int default 300
)
returns public.scan_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_node public.worker_nodes;
  v_job public.scan_jobs;
  v_settings public.pool_settings;
  v_min int[];
  v_node_ver int[];
  v_id uuid;
begin
  v_node := public.worker_node_for_token(node_token);
  if v_node.id is null then
    raise exception 'ukjent eller trukket node-token';
  end if;

  select * into v_settings from public.pool_settings where id;

  -- Versjonssperre: en node med for gammel exe skal ikke produsere bake som
  -- avviker stille fra resten av poolen.
  v_min := public.version_as_ints(v_settings.min_worker_version);
  if v_min is not null then
    v_node_ver := public.version_as_ints(v_node.worker_version);
    if v_node_ver is null then
      raise exception 'node mangler tolkbar worker_version (fikk «%»), minst % kreves',
        coalesce(v_node.worker_version, '<null>'), v_settings.min_worker_version;
    end if;
    if v_node_ver < v_min then
      raise exception 'worker_version % er for gammel, minst % kreves',
        v_node.worker_version, v_settings.min_worker_version;
    end if;
  end if;

  -- Rettferdighet innad i køen: `rang` er hvor mange jobber samme bruker
  -- allerede har foran seg. Én montør som køer tjue skann låser dermed ikke
  -- alle andre bak seg — alles første jobb går før noens andre.
  -- Postgres tillater ikke `for update` sammen med en vindusfunksjon
  -- (0A000). Rangeringen TRENGER row_number(), så låsen skjer i eget steg:
  -- finn id-en uten lås, lås akkurat den raden, og bekreft at den fortsatt er
  -- `queued`. Taper vi et kappløp mot en annen node, blir det en tom runde --
  -- ikke en dobbel bake.
  select j.id into v_id
  from (
    select s.id, s.created_at,
           row_number() over (
             partition by s.company_id, coalesce(s.requested_by, s.id)
             order by s.created_at
           ) as rang
    from public.scan_jobs s
    where s.status = 'queued'
      and s.deleted_at is null
      and s.attempt_count < 3
      and (
        -- Egen node: kun eget firma, ingen ventetid.
        (not v_node.is_public and s.company_id = v_node.company_id)
        -- Offentlig node: kun jobber med samtykke, og først etter nådetiden,
        -- slik at firmaets egen node alltid får første sjanse.
        or (
          v_node.is_public
          and s.allow_ampex_pool
          and s.created_at < now() - make_interval(secs => v_settings.public_pool_grace_seconds)
        )
      )
  ) j
  order by j.rang, j.created_at
  limit 1;

  if v_id is null then return null; end if;

  select * into v_job from public.scan_jobs
  where id = v_id and status = 'queued'
  for update skip locked;

  if not found then return null; end if;

  update public.scan_jobs
     set status = 'claimed',
         claimed_by = v_node.id,
         claimed_at = now(),
         lease_expires_at = now() + make_interval(secs => lease_seconds),
         attempt_count = attempt_count + 1,
         -- Sannheten om hvem som faktisk tok jobben — grunnlag for fakturering
         -- og for å svare kunden på hvor skannet ble baket.
         pool = case when v_node.is_public then 'ampex' else 'firm' end
   where id = v_job.id
  returning * into v_job;

  update public.worker_nodes
     set status = 'busy', last_heartbeat_at = now()
   where id = v_node.id;

  return v_job;
end;
$$;

-- ── Køposisjon til appen ────────────────────────────────────────────────────
-- «Du er nummer fire, cirka åtte minutter» er forskjellen på å vente og å lure
-- på om det henger. Snittet regnes fra faktisk brukt tid på fullførte jobber i
-- samme firma, med et forsiktig fallback før det finnes historikk.
create or replace function public.scan_job_queue_position(job_id uuid)
returns table (
  posisjon int,
  foran int,
  anslag_sekunder int
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.scan_jobs;
  v_foran int;
  v_snitt numeric;
  v_noder int;
begin
  select * into v_job
  from public.scan_jobs
  where id = job_id
    and company_id = public.current_company_id()
    and deleted_at is null;

  if not found then
    raise exception 'ukjent jobb';
  end if;

  if v_job.status <> 'queued' then
    return query select 0, 0, 0;
    return;
  end if;

  select count(*) into v_foran
  from public.scan_jobs
  where company_id = v_job.company_id
    and status = 'queued'
    and deleted_at is null
    and created_at < v_job.created_at;

  -- Median hadde vært riktigere enn snitt, men snitt over de siste 20 er nær nok
  -- for et anslag som uansett vises som «cirka».
  select avg(extract(epoch from (updated_at - claimed_at)))
    into v_snitt
  from (
    select updated_at, claimed_at
    from public.scan_jobs
    where company_id = v_job.company_id
      and status = 'done'
      and claimed_at is not null
    order by updated_at desc
    limit 20
  ) s;

  select greatest(count(*), 1) into v_noder
  from public.worker_nodes
  where company_id = v_job.company_id
    and revoked_at is null
    and deleted_at is null
    and last_heartbeat_at > now() - interval '2 minutes';

  return query select
    (v_foran + 1)::int,
    v_foran::int,
    -- 240 s som fallback: bevisst pessimistisk, så første gangs anslag ikke
    -- lover raskere enn poolen leverer.
    ceil(((v_foran + 1) * coalesce(v_snitt, 240)) / v_noder)::int;
end;
$$;

grant execute on function public.scan_job_queue_position(uuid) to authenticated;
revoke execute on function public.version_as_ints(text) from anon, authenticated;
