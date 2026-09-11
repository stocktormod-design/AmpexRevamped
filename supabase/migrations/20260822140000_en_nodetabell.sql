-- Én nodetabell, ikke to.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Funnet: kontoret leste en tabell ingenting skriver til
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `docs/STATUS.md` punkt 12 sa at poolen «måtte avklares»: `scan_workers` og
-- `worker_nodes` overlappet, og migrasjonene var angivelig aldri kjørt. Det
-- første stemte. Det andre gjorde det ikke — begge tabellene har stått i basen
-- siden 21. august.
--
-- Målt på basen 22. august:
--
--   scan_workers   0 rader,  0 funksjoner rører den
--   worker_nodes   0 rader,  7 funksjoner rører den
--
-- De sju er hele kjeden: `enroll_worker_node`, `worker_node_for_token`,
-- `claim_scan_job`, `heartbeat_scan_job`, `complete_scan_job`,
-- `fail_scan_job`, `scan_job_queue_position`. Altså alt en PC gjør fra den
-- melder seg inn til den leverer en ferdig bake.
--
-- Men `desktop/src/lib/kontor-lager.ts` leste `scan_workers` til Firma-flata,
-- og `desktop/src/lib/skann-lager.ts` leste `worker_nodes` til Skann-flata.
-- Samme app, samme begrep, to tabeller.
--
-- Konsekvensen var stille og total: **en PC som melder seg inn ville aldri
-- dukket opp under «Bake-noder».** Kortet ville sagt «Ingen maskiner meldt
-- inn» for alltid, uansett hvor mange maskiner som faktisk sto og bakte. Ingen
-- feilmelding, ingen tom spørring som klaget — bare en liste som var tom fordi
-- den så feil vei.
--
-- Det er ikke funnet ennå fordi ingen har meldt inn en PC. `worker_nodes` har
-- null rader. Den første som prøver ville brukt en kveld på å lure på hvorfor
-- maskinen ikke vises.
--
-- `worker_nodes` vinner, og det er ikke et myntkast: den har `token_hash`
-- (nodens autentisering) og `is_public` (Ampex-poolen). Uten de to finnes det
-- verken innlogging for en worker eller et skille mellom firmaets egne maskiner
-- og overflow-poolen. `scan_workers` hadde bare beskrivende felt.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Ta med det `scan_workers` faktisk hadde som var verdt noe
-- ═══════════════════════════════════════════════════════════════════════════
--
-- VRAM er ikke pynt i en bake-pool. Det er tallet som avgjør om en jobb i det
-- hele tatt får plass på kortet, og det første man ser etter når en bake feiler
-- på en maskin men går på en annen. Firma-kortet viste det allerede — det var
-- bare ingen som fylte det ut.
--
-- `compute_capability` blir med av samme grunn: CUDA-versjonen bestemmer hvilke
-- kjerner som kan kjøre, og «virker ikke på den PC-en» er et spørsmål med et
-- tall som svar.

alter table public.worker_nodes add column if not exists vram_mb integer;
alter table public.worker_nodes add column if not exists compute_capability text;

comment on column public.worker_nodes.vram_mb is
  'Minne på skjermkortet, avlest av nvidia-smi ved innmelding. Null når driveren ikke svarte.';
comment on column public.worker_nodes.compute_capability is
  'CUDA compute capability, f.eks. 8.9. Null når driveren ikke svarte.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Innmeldingen tar imot dem
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `drop` og ikke `create or replace`: nye parametere gir en NY signatur, og da
-- ville vi stått igjen med to overlaster som PostgREST måtte gjette mellom.
--
-- De nye står med `default null`, så en worker som ikke er oppdatert ennå
-- melder seg inn akkurat som før — den får bare tomme felt i nodelista. En
-- eldre exe ute i et verksted skal ikke slutte å virke fordi kontoret fikk en
-- ny kolonne.

drop function if exists public.enroll_worker_node(text, text, text, text);

create or replace function public.enroll_worker_node(
  enrollment_code text,
  p_hostname text default null,
  p_gpu_name text default null,
  p_worker_version text default null,
  p_vram_mb integer default null,
  p_compute_capability text default null
)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_enroll public.worker_enrollments%rowtype; v_token text; v_node uuid;
begin
  select * into v_enroll from public.worker_enrollments
  where code_hash = encode(digest(enrollment_code, 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  for update;
  if not found then raise exception 'ugyldig eller brukt innmeldingskode'; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.worker_nodes
    (company_id, hostname, gpu_name, worker_version, vram_mb, compute_capability,
     token_hash, enrolled_by, name)
  values (v_enroll.company_id, p_hostname, p_gpu_name, p_worker_version,
          p_vram_mb, p_compute_capability,
          encode(digest(v_token, 'sha256'), 'hex'), v_enroll.created_by,
          coalesce(p_hostname, 'worker'))
  returning id into v_node;

  update public.worker_enrollments set used_at = now(), used_by_node = v_node
   where id = v_enroll.id;
  return v_token;
end $function$;

-- Koden kalles av worker-en med anon-nøkkelen, FØR den har et node-token — den
-- har ingen brukersesjon og kan ikke ha en. Innmeldingskoden er hemmeligheten,
-- og den er engangs og utløper. Se `worker/ampex_worker/api.py`.
revoke execute on function public.enroll_worker_node(text, text, text, text, integer, text) from public;
grant execute on function public.enroll_worker_node(text, text, text, text, integer, text) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Bort med den døde
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Regel 5 sier soft delete på alt, og den gjelder DATA. Dette er skjema: en tom
-- tabell ingen kode leser etter denne migrasjonen. Å la den stå ville vært å la
-- neste person velge feil av to like tabeller en gang til — som er nøyaktig det
-- som skjedde her.
--
-- `restrict` og ikke `cascade`: finnes det en fremmednøkkel vi ikke vet om,
-- skal migrasjonen stoppe og fortelle det, ikke rive med seg noe.

drop table if exists public.scan_workers restrict;
