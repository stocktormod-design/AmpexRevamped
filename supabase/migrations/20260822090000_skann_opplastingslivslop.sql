-- Opplastingslivsløpet for et skann, og taket som hindrer at noen ripper R2.
--
-- ── Hvorfor jobben opprettes FØR filene er lastet opp ───────────────────────
--
-- Montøren skanner i en kjeller uten dekning, og laster opp når han er tilbake
-- på wifi. Opprettes jobben først ved opplasting, finnes skannet ikke for noen
-- andre i mellomtiden: kontoret ser ingenting, og montøren er den eneste som
-- vet at det ligger der. Derfor legges raden inn med én gang, i status
-- `venter`, og `venter_paa` sier hvorfor. Da kan kontoret se «tre skann ligger
-- på telefonen til Ola og venter på wifi» — som er informasjon, ikke støy.
--
-- ── Hvorfor bytes telles her og ikke i klienten ─────────────────────────────
--
-- Et skann er inntil 600 keyframes (MeshScanPresenter.maxKeyframes): rå
-- float32-dybde er 192 KiB per ramme, og RGB på 1920 er et par hundre KB. Det
-- blir fort noen hundre megabyte. Uten et tak i BASEN er en presignert URL en
-- åpen dør så lenge den lever.

-- ── 1. Livsløpet ────────────────────────────────────────────────────────────

alter table public.scan_jobs drop constraint if exists scan_jobs_status_check;
alter table public.scan_jobs add constraint scan_jobs_status_check check (
  status in ('venter', 'queued', 'claimed', 'running', 'done', 'failed', 'canceled')
);

alter table public.scan_jobs
  -- Hvorfor den ikke er lastet opp ennå. Vises til kontoret.
  add column if not exists venter_paa text
    check (venter_paa is null or venter_paa in ('wifi', 'lading', 'plass', 'bruker')),
  -- Størrelsen klienten SIER den skal laste opp. Sjekkes mot taket før den får
  -- en eneste presignert URL.
  add column if not exists bundle_bytes bigint,
  -- Det som faktisk kom fram. Avvik mot bundle_bytes er enten en feil eller et
  -- forsøk, og begge deler vil man vite om.
  add column if not exists uploaded_bytes bigint,
  add column if not exists frame_count int,
  add column if not exists uploaded_at timestamptz,
  -- Telefonen bekrefter at den har slettet sine lokale kopier. Skannet er
  -- LiDAR av kundens bolig; at det ikke blir liggende i to eksemplarer er både
  -- lagringsplass og personvern (se docs/PERSONVERN.md).
  add column if not exists frames_deleted_at timestamptz,
  -- Hva som skal bakes. Splatten er utseendet, meshet er det man måler mot og
  -- fester stikk til — de deler poser og koordinatsystem, så de bakes sammen.
  add column if not exists kind text not null default 'begge'
    check (kind in ('mesh', 'splat', 'begge')),
  add column if not exists splat_key text,
  -- Inndataene i R2 er ikke en leveranse. De slettes når baken er i havn.
  add column if not exists input_slettes_etter timestamptz;

create index if not exists scan_jobs_venter_idx
  on public.scan_jobs (company_id, created_at)
  where status = 'venter' and deleted_at is null;

-- ── 2. Takene ───────────────────────────────────────────────────────────────

alter table public.pool_settings
  add column if not exists maks_bytes_per_jobb bigint not null default 1073741824,
  add column if not exists maks_bytes_per_firma_mnd bigint not null default 107374182400,
  -- Hvor mye faktisk opplasting kan avvike fra det som ble oppgitt. Litt slakk
  -- må det være — klienten anslår før den har komprimert ferdig — men ikke så
  -- mye at anslaget blir meningsløst.
  add column if not exists bytes_slakk_prosent int not null default 10,
  add column if not exists input_oppbevaring_timer int not null default 72;

comment on column public.pool_settings.maks_bytes_per_jobb is
  '1 GiB som standard. Et ekte romskann er noen hundre MB; taket er der for å stoppe misbruk, ikke normal bruk.';

-- ── 3. Forbruk ──────────────────────────────────────────────────────────────
-- Rullerende 30 dager, ikke kalendermåned: en kvote som nullstilles den 1. gir
-- en topp den 1. og en tom pool den 31.
create or replace function public.scan_forbruk_bytes(firma uuid)
returns bigint
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(sum(coalesce(uploaded_bytes, bundle_bytes, 0)), 0)::bigint
  from scan_jobs
  where company_id = firma
    and created_at > now() - interval '30 days'
    and status <> 'canceled'
$$;

revoke execute on function public.scan_forbruk_bytes(uuid) from anon;

-- ── 4. Opprett jobb — her sjekkes taket ─────────────────────────────────────
create or replace function public.scan_job_opprett(
  p_input_prefix text,
  p_bundle_bytes bigint,
  p_frame_count int default null,
  p_room_id uuid default null,
  p_order_scan_id uuid default null,
  p_kind text default 'begge',
  p_venter_paa text default 'wifi',
  p_allow_ampex_pool boolean default false
)
returns public.scan_jobs
language plpgsql security definer set search_path to 'public'
as $$
declare
  firma uuid := public.current_company_id();
  s public.pool_settings;
  brukt bigint;
  jobb public.scan_jobs;
begin
  if firma is null then raise exception 'ingen firmakontekst'; end if;
  if p_bundle_bytes is null or p_bundle_bytes <= 0 then
    raise exception 'bundle_bytes må oppgis før opplasting' using errcode = '22023';
  end if;

  select * into s from pool_settings where id;

  if p_bundle_bytes > s.maks_bytes_per_jobb then
    raise exception 'Skannet er % MB. Taket per jobb er % MB.',
      round(p_bundle_bytes / 1048576.0), round(s.maks_bytes_per_jobb / 1048576.0)
      using errcode = '53100';
  end if;

  brukt := public.scan_forbruk_bytes(firma);
  if brukt + p_bundle_bytes > s.maks_bytes_per_firma_mnd then
    raise exception 'Firmaet har brukt % GB av % GB siste 30 dager.',
      round(brukt / 1073741824.0, 1), round(s.maks_bytes_per_firma_mnd / 1073741824.0, 1)
      using errcode = '53100';
  end if;

  insert into scan_jobs (company_id, room_id, order_scan_id, requested_by,
                         status, venter_paa, input_prefix, bundle_bytes,
                         frame_count, kind, allow_ampex_pool)
  values (firma, p_room_id, p_order_scan_id, auth.uid(),
          'venter', p_venter_paa, p_input_prefix, p_bundle_bytes,
          p_frame_count, p_kind, p_allow_ampex_pool)
  returning * into jobb;

  return jobb;
end $$;

-- ── 5. Opplasting ferdig → jobben går i kø ──────────────────────────────────
create or replace function public.scan_job_opplastet(
  p_job_id uuid,
  p_uploaded_bytes bigint
)
returns public.scan_jobs
language plpgsql security definer set search_path to 'public'
as $$
declare
  s public.pool_settings;
  jobb public.scan_jobs;
  tak bigint;
begin
  select * into jobb from scan_jobs
  where id = p_job_id and company_id = public.current_company_id() and deleted_at is null;
  if not found then raise exception 'ukjent jobb'; end if;

  -- Idempotent: samme kall to ganger skal ikke kaste. Nettverk gjentar seg.
  if jobb.status <> 'venter' then return jobb; end if;

  select * into s from pool_settings where id;
  tak := (jobb.bundle_bytes * (100 + s.bytes_slakk_prosent)) / 100;

  if p_uploaded_bytes > tak then
    raise exception 'Lastet opp % MB, men oppga % MB. Avviket er for stort.',
      round(p_uploaded_bytes / 1048576.0), round(jobb.bundle_bytes / 1048576.0)
      using errcode = '53100';
  end if;

  update scan_jobs
     set status = 'queued',
         venter_paa = null,
         uploaded_bytes = p_uploaded_bytes,
         uploaded_at = now()
   where id = p_job_id
  returning * into jobb;

  return jobb;
end $$;

-- Telefonen sier fra at den har slettet sine egne kopier.
create or replace function public.scan_job_lokalt_slettet(p_job_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  update scan_jobs
     set frames_deleted_at = coalesce(frames_deleted_at, now())
   where id = p_job_id
     and company_id = public.current_company_id()
     and uploaded_at is not null;
end $$;

-- ── 6. Inndata ryddes etter en vellykket bake ───────────────────────────────
create or replace function public.complete_scan_job(
  node_token text, job_id uuid, p_output_key text,
  p_gpu_ms bigint default null, p_filled_fraction real default null)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_node public.worker_nodes;
  v_timer int;
begin
  v_node := public.worker_node_for_token(node_token);
  if v_node.id is null then raise exception 'ukjent eller trukket node-token'; end if;

  select input_oppbevaring_timer into v_timer from public.pool_settings where id;

  update public.scan_jobs
     set status = 'done', output_key = p_output_key, gpu_ms = p_gpu_ms,
         filled_fraction = p_filled_fraction, progress = 1, lease_expires_at = null,
         -- Rammene er inndata, ikke leveranse. Litt slakk før sletting, slik at
         -- en mislykket bake kan kjøres om uten at telefonen må laste opp igjen.
         input_slettes_etter = now() + make_interval(hours => coalesce(v_timer, 72))
   where id = job_id and claimed_by = v_node.id;

  update public.worker_nodes set status = 'idle', last_heartbeat_at = now()
   where id = v_node.id;
end $$;

grant execute on function public.scan_job_opprett(text, bigint, int, uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.scan_job_opplastet(uuid, bigint) to authenticated;
grant execute on function public.scan_job_lokalt_slettet(uuid) to authenticated;
revoke execute on function public.scan_job_opprett(text, bigint, int, uuid, uuid, text, text, boolean) from anon;
revoke execute on function public.scan_job_opplastet(uuid, bigint) from anon;
revoke execute on function public.scan_job_lokalt_slettet(uuid) from anon;
