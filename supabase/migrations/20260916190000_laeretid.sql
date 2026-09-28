-- Læretid: dokumentasjon, dekning og tilknytninger.
--
-- KJØRT 16.09.2026 mot produksjon, i to trinn: først alt additive, så
-- `watermelon_push`. Skrevet mot den LEVENDE basen (55 tabeller), ikke mot
-- repoets migrasjonsmappe, som ligger bak.
--
-- `npm run verify:e2e` gikk 59/59 etterpå, inkludert samtidighet fra to
-- enheter og soft delete — begge går gjennom den endrede funksjonen.
--
-- ── Hvorfor denne migrasjonen rører synken ──────────────────────────────────
-- `watermelon_push` hadde `company_id = public.current_company_id()` HARDKODET
-- i både oppdateringsvakten og slettevakten. Det er riktig for alle 38 tabeller
-- som finnes i dag, fordi alt der tilhører et firma.
--
-- Læretid gjør ikke det. Koordinatoren i opplæringskontoret følger lærlinger
-- hos flere bedrifter samtidig, og en lærling som kjøper produktet alene har
-- ingen Ampex-bedrift i det hele tatt. Gir vi loggene en `company_id`, kan
-- ingen av dem eksistere, og en lærling som bytter bedrift mister historikken
-- sin i stedet for å ta den med seg.
--
-- Derfor: eierskapet blir en kolonne i `sync_tables` i stedet for en antakelse
-- i funksjonen. `watermelon_pull` trengte ingen endring — den nevner ikke
-- `company_id` og lener seg allerede på RLS.

-- ── 1. Synken lærer at noe eies av en person ────────────────────────────────

alter table public.sync_tables
  add column if not exists eier text not null default 'firma',
  add column if not exists eier_kolonne text not null default 'company_id';

alter table public.sync_tables
  drop constraint if exists sync_tables_eier_sjekk;
alter table public.sync_tables
  add constraint sync_tables_eier_sjekk check (eier in ('firma', 'bruker'));

comment on column public.sync_tables.eier is
  'firma = raden tilhører et company_id (alt som fantes før læretid). '
  'bruker = raden tilhører personen i eier_kolonne, og følger henne på tvers av firmaer.';

create or replace function public.watermelon_push(changes jsonb, last_pulled_at bigint default 0)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  t record; r jsonb; payload jsonb;
  cols text[]; ins_cols text[]; sel_cols text[]; sett text[]; ider text[]; k text;
  truffet int;
  endrede text[];
  vakt text;          -- eierskapsvakten, bygget av sync_tables.eier
  eier_kol text;      -- kolonnen som ikke skal kunne endres av en klient
begin
  for t in select table_name, no_update, eier, eier_kolonne from public.sync_tables
           order by push_order, table_name loop
    if changes -> t.table_name is null then continue; end if;

    -- Identifikatoren quotes med %I, så kolonnenavnet kan ikke injisere noe.
    if t.eier = 'bruker' then
      vakt := format('%I = auth.uid()', t.eier_kolonne);
      eier_kol := t.eier_kolonne;
    else
      vakt := 'company_id = public.current_company_id()';
      eier_kol := 'company_id';
    end if;

    for r in select * from jsonb_array_elements(
      coalesce(changes -> t.table_name -> 'created', '[]'::jsonb) ||
      coalesce(changes -> t.table_name -> 'updated', '[]'::jsonb)) loop

      payload := public.sync_payload_in(t.table_name, r);

      endrede := case
        when coalesce(r ->> '_changed', '') = '' then null
        else string_to_array(r ->> '_changed', ',')
      end;

      select coalesce(array_agg(c.column_name::text order by c.ordinal_position), '{}')
        into cols from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t.table_name
         and c.column_name in (select jsonb_object_keys(payload));

      ins_cols := '{}'; sel_cols := '{}'; sett := '{}';
      foreach k in array cols loop
        ins_cols := ins_cols || format('%I', k);
        sel_cols := sel_cols || format('r.%I', k);
        -- Eierkolonnen står i denne lista nå, ikke bare 'company_id': en klient
        -- skal aldri kunne flytte en logg til en annen lærling ved å oppdatere.
        if k in ('id', 'created_at', 'created_by') or k = eier_kol then continue; end if;
        if k = any (t.no_update) then continue; end if;
        if endrede is not null and k <> 'updated_at' and not (k = any (endrede)) then continue; end if;
        sett := sett || format('%1$I = r.%1$I', k);
      end loop;

      truffet := 0;
      if array_length(sett, 1) is not null then
        execute format(
          'update public.%1$I dst set %2$s
           from jsonb_populate_record(null::public.%1$I, $1) r
           where dst.id = r.id and dst.%3$s',
          t.table_name, array_to_string(sett, ', '), vakt) using payload;
        get diagnostics truffet = row_count;
      end if;

      if truffet = 0 then
        -- Innsetting vernes av RLS (with check), som før.
        execute format(
          'insert into public.%1$I (%2$s) select %3$s
           from jsonb_populate_record(null::public.%1$I, $1) r
           on conflict (id) do nothing',
          t.table_name, array_to_string(ins_cols, ', '), array_to_string(sel_cols, ', '))
        using payload;
      end if;
    end loop;

    select coalesce(array_agg(value), '{}') into ider
      from jsonb_array_elements_text(coalesce(changes -> t.table_name -> 'deleted', '[]'::jsonb));

    if array_length(ider, 1) > 0 then
      execute format(
        'update public.%I set deleted_at = now()
         where deleted_at is null and %s
           and id = any ($1::uuid[])', t.table_name, vakt) using ider;
    end if;
  end loop;
end $function$;

-- ── 2. Tilknytninger ────────────────────────────────────────────────────────
-- Én rad per par av lærling og person, med rollen personen har FOR NETTOPP
-- den lærlingen. Krysser firmagrenser med vilje.

create table if not exists public.laeretid_tilknytning (
  id uuid primary key default gen_random_uuid(),
  laerling_id uuid not null references public.profiles(id),
  person_id uuid not null references public.profiles(id),
  rolle text not null check (rolle in ('faglig_leder', 'instruktor', 'koordinator', 'ansatt')),
  gyldig_fra date not null default current_date,
  gyldig_til date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists laeretid_tilknytning_laerling on public.laeretid_tilknytning(laerling_id) where deleted_at is null;
create index if not exists laeretid_tilknytning_person on public.laeretid_tilknytning(person_id) where deleted_at is null;

-- Sannheten om hvem som ser hva. Speiler `lib/laeretid/tilgang.ts`.
create or replace function public.kan_se_laerling(maal_laerling uuid, hva text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select maal_laerling = auth.uid()
      or exists (
        select 1 from public.laeretid_tilknytning t
         where t.laerling_id = maal_laerling
           and t.person_id = auth.uid()
           and t.deleted_at is null
           and current_date >= t.gyldig_fra
           and (t.gyldig_til is null or current_date <= t.gyldig_til)
           -- Kladd, quizsvar og profil deles ALDRI. Loggen og dekningen deles
           -- med faglig leder, instruktør og koordinator. En ansatt ser intet.
           and hva in ('dekning', 'logg')
           and t.rolle in ('faglig_leder', 'instruktor', 'koordinator')
      );
$$;

-- ── 2b. Invitasjon ──────────────────────────────────────────────────────────
-- Ingen kobles på en lærling uten at han har sagt ja. Samtykket ligger enten i
-- at han sendte invitasjonen, eller i at han tok imot den.
--
-- Adressen, ikke bruker-id: den inviterte har ofte ikke konto ennå. Samme
-- grunn som `inviter-ansatt`.

create table if not exists public.laeretid_invitasjon (
  id uuid primary key default gen_random_uuid(),
  laerling_id uuid not null references public.profiles(id),
  epost text not null,
  rolle text not null check (rolle in ('faglig_leder', 'instruktor', 'koordinator', 'ansatt')),
  fra_person_id uuid not null references public.profiles(id),
  token text not null unique,
  sendt_at timestamptz not null default now(),
  utloper_at timestamptz not null default (now() + interval '30 days'),
  status text not null default 'sendt' check (status in ('sendt', 'akseptert', 'avslatt', 'utlopt')),
  avgjort_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists laeretid_invitasjon_epost on public.laeretid_invitasjon(lower(epost)) where deleted_at is null;

alter table public.laeretid_invitasjon enable row level security;

-- Lærlingen ser invitasjoner om sin egen læretid; avsenderen ser sine egne.
-- Tokenet leses ALDRI av en klient — innløsning går gjennom Edge Function.
drop policy if exists laeretid_invitasjon_les on public.laeretid_invitasjon;
create policy laeretid_invitasjon_les on public.laeretid_invitasjon for select
  using (laerling_id = auth.uid() or fra_person_id = auth.uid());

-- Speiler `kanInvitere()` i lib/laeretid/tilgang.ts.
drop policy if exists laeretid_invitasjon_send on public.laeretid_invitasjon;
create policy laeretid_invitasjon_send on public.laeretid_invitasjon for insert
  with check (
    fra_person_id = auth.uid()
    and (
      laerling_id = auth.uid()
      or exists (
        select 1 from public.laeretid_tilknytning t
         where t.laerling_id = laeretid_invitasjon.laerling_id
           and t.person_id = auth.uid()
           and t.deleted_at is null
           and current_date >= t.gyldig_fra
           and (t.gyldig_til is null or current_date <= t.gyldig_til)
           and (
             (t.rolle = 'koordinator' and laeretid_invitasjon.rolle <> 'koordinator')
             or (t.rolle = 'faglig_leder' and laeretid_invitasjon.rolle in ('instruktor', 'ansatt'))
           )
      )
    )
  );

-- ── 3. Lærlingen, loggen, bildene og belegget ───────────────────────────────

create table if not exists public.laeretid_laerling (
  id uuid primary key references public.profiles(id),
  laereplan_kode text not null check (laereplan_kode in ('ELE03-03', 'ELE03-04')),
  opplaeringskontor text,
  laerebedrift text,
  kontrakt_fra date,
  kontrakt_til date,
  oppmelding_planlagt date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.laeretid_logg (
  id uuid primary key default gen_random_uuid(),
  laerling_id uuid not null references public.profiles(id),
  tittel text,
  arbeidsdato date,
  -- Speiler livsløpet i fagbrev.io, så eksporten lander i riktig tilstand.
  status text not null default 'kladd' check (status in ('kladd', 'sendt', 'godkjent', 'maa_rettes')),
  innhold text,
  sendt_at timestamptz,
  vurdert_at timestamptz,
  vurdert_av uuid references public.profiles(id),
  tilbakemelding text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists laeretid_logg_laerling on public.laeretid_logg(laerling_id) where deleted_at is null;

create table if not exists public.laeretid_bilde (
  id uuid primary key default gen_random_uuid(),
  laerling_id uuid not null references public.profiles(id),
  logg_id uuid references public.laeretid_logg(id),
  -- EXIF der den finnes, ellers opplastingsrekkefølgen. Kan dras på plass.
  tatt_at timestamptz,
  rekkefolge integer not null default 0,
  -- Skrives i samme øyeblikk som bildet tas, og lagres ORDRETT. Ingen modell
  -- pusser på den ved fangst: råheten er det som gjør den til bevis senere.
  notat text,
  -- Beskrivelsen modellen lager, ÉN gang. Da slipper vi å sende bildet på nytt
  -- i hver melding, som er der kostnaden faktisk ligger.
  modellbeskrivelse text,
  r2_nokkel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists laeretid_bilde_logg on public.laeretid_bilde(logg_id) where deleted_at is null;

-- Selve produktet: ett belegg per del av et kompetansemål, med hvor det står
-- og hvordan det ble til. Vurderes av `lib/laeretid/dekning.ts`.
create table if not exists public.laeretid_belegg (
  id uuid primary key default gen_random_uuid(),
  laerling_id uuid not null references public.profiles(id),
  logg_id uuid not null references public.laeretid_logg(id),
  maal_nr integer not null check (maal_nr between 1 and 20),
  del_id text not null,
  kilde text not null check (kilde in ('brodtekst', 'risikotabell', 'egenvurdering', 'bisetning', 'naerhet')),
  generert boolean not null default false,
  utfort_selv boolean not null default true,
  utspurt text check (utspurt in ('bestatt', 'stroket')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (logg_id, maal_nr, del_id)
);

create index if not exists laeretid_belegg_laerling on public.laeretid_belegg(laerling_id) where deleted_at is null;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────

alter table public.laeretid_tilknytning enable row level security;
alter table public.laeretid_laerling enable row level security;
alter table public.laeretid_logg enable row level security;
alter table public.laeretid_bilde enable row level security;
alter table public.laeretid_belegg enable row level security;

drop policy if exists laeretid_tilknytning_les on public.laeretid_tilknytning;
create policy laeretid_tilknytning_les on public.laeretid_tilknytning for select
  using (laerling_id = auth.uid() or person_id = auth.uid());

-- Lærlingen kan opprette og avslutte tilknytninger selv. Det dekker den ene
-- retningen helt uten `service_role`: kontoret inviterer ham, han aksepterer.
--
-- Den ANDRE retningen — han inviterer sin faglige leder, som aksepterer — kan
-- ikke gjøres her, fordi den som trykker ikke er lærlingen og ofte ikke har
-- konto ennå. Den innløsningen må gå gjennom en Edge Function som verifiserer
-- tokenet, på samme vis som `inviter-ansatt`.
drop policy if exists laeretid_tilknytning_skriv on public.laeretid_tilknytning;
create policy laeretid_tilknytning_skriv on public.laeretid_tilknytning for all
  using (laerling_id = auth.uid()) with check (laerling_id = auth.uid());

drop policy if exists laeretid_laerling_les on public.laeretid_laerling;
create policy laeretid_laerling_les on public.laeretid_laerling for select
  using (public.kan_se_laerling(id, 'dekning'));
drop policy if exists laeretid_laerling_skriv on public.laeretid_laerling;
create policy laeretid_laerling_skriv on public.laeretid_laerling for all
  using (id = auth.uid()) with check (id = auth.uid());

-- Kladden er hans alene. De andre ser loggen først når den er sendt inn.
drop policy if exists laeretid_logg_les on public.laeretid_logg;
create policy laeretid_logg_les on public.laeretid_logg for select
  using (
    laerling_id = auth.uid()
    or (status <> 'kladd' and public.kan_se_laerling(laerling_id, 'logg'))
  );
drop policy if exists laeretid_logg_skriv on public.laeretid_logg;
create policy laeretid_logg_skriv on public.laeretid_logg for all
  using (laerling_id = auth.uid()) with check (laerling_id = auth.uid());

drop policy if exists laeretid_bilde_les on public.laeretid_bilde;
create policy laeretid_bilde_les on public.laeretid_bilde for select
  using (
    laerling_id = auth.uid()
    or exists (
      select 1 from public.laeretid_logg l
       where l.id = laeretid_bilde.logg_id
         and l.status <> 'kladd'
         and public.kan_se_laerling(l.laerling_id, 'logg')
    )
  );
drop policy if exists laeretid_bilde_skriv on public.laeretid_bilde;
create policy laeretid_bilde_skriv on public.laeretid_bilde for all
  using (laerling_id = auth.uid()) with check (laerling_id = auth.uid());

drop policy if exists laeretid_belegg_les on public.laeretid_belegg;
create policy laeretid_belegg_les on public.laeretid_belegg for select
  using (laerling_id = auth.uid() or public.kan_se_laerling(laerling_id, 'dekning'));
drop policy if exists laeretid_belegg_skriv on public.laeretid_belegg;
create policy laeretid_belegg_skriv on public.laeretid_belegg for all
  using (laerling_id = auth.uid()) with check (laerling_id = auth.uid());

-- ── 5. Meld tabellene inn i synken ──────────────────────────────────────────
-- Høy push_order: de er avhengige av profiles, og av hverandre.

insert into public.sync_tables (table_name, push_order, no_update, eier, eier_kolonne) values
  ('laeretid_laerling',    95, '{}', 'bruker', 'id'),
  ('laeretid_tilknytning', 96, '{}', 'bruker', 'laerling_id'),
  ('laeretid_logg',        97, '{}', 'bruker', 'laerling_id'),
  ('laeretid_bilde',       98, '{}', 'bruker', 'laerling_id'),
  ('laeretid_belegg',      99, '{}', 'bruker', 'laerling_id'),
  ('laeretid_invitasjon', 100, '{}', 'bruker', 'laerling_id')
on conflict (table_name) do update
  set push_order = excluded.push_order,
      eier = excluded.eier,
      eier_kolonne = excluded.eier_kolonne;

-- ── 6. Lærlingens stemme, hans instruks, og grensen på omskrivinger ─────────
-- Lagt til 16.09.2026, kjørt som egen migrasjon `laeretid_tone_og_instruks`.

alter table public.laeretid_laerling
  add column if not exists tone text;

alter table public.laeretid_logg
  add column if not exists instruks text,
  -- To omskrivinger per logg. Grunnen er ikke kostnad: kan man trykke «skriv
  -- om» i det uendelige, slutter man å lese teksten og triller terning til noe
  -- ser bra ut. Da eier ingen det som står der. Grensen gjelder MODELLEN —
  -- lærlingens egen redigering sperres aldri.
  add column if not exists ai_endringer_brukt integer not null default 0;
