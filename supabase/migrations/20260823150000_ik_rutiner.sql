-- Flere rutiner under samme punkt.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvorfor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `ik_punkter` fra 20260821180000 har ÉN `innhold`-kolonne, altså én rutine per
-- punkt. Men punktene er hentet fra internkontrollforskriften § 5, og de er
-- generelle med vilje. «Kartlegging av farer og risikovurdering» er ikke én
-- rutine — det er rutinen for arbeid i tavle, rutinen for arbeid i høyden,
-- rutinen for AUS, og rutinen for gravearbeid. Presset ned i ett tekstfelt blir
-- de fire til ett veggteppe ingen leser, og gjennomgang av én av dem betyr at
-- man har «gjennomgått» alle fire.
--
-- Punktet blir derfor et KAPITTEL: formål, hjemmel og frist. Rutinene lever
-- under det, med hver sin tittel, hver sin versjon og hvert sitt vedtak.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hva som IKKE endres
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `ik_lest` står urørt, og bekreftelsen blir liggende på PUNKTET. Det er ikke
-- latskap: «jeg har lest kapittelet om risikovurdering» er det utsagnet som
-- betyr noe, og hadde bekreftelsen ligget på hver enkelt rutine ville en montør
-- måttet kvittere fire ganger for det samme kapittelet.
--
-- Til gjengjeld MÅ punktets `gjeldende_versjon` telle opp når en rutine under
-- det endres — ellers står gamle bekreftelser igjen som gyldige for et kapittel
-- som har endret seg. Det gjøres av triggeren nederst, ikke av klienten.
--
-- `ik_punkter.innhold` beholdes, men leses ikke lenger av kontoret. Teksten som
-- lå der er kopiert til en rutine av denne migrasjonen; kolonnen står igjen
-- fordi regel 5 sier at data ikke kastes, og fordi revisjonene fra før peker på
-- den.
--
-- Tilbakerulling: se nederst.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Rutinene
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ik_rutiner (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id),
  punkt_id uuid not null references public.ik_punkter(id) on delete cascade,

  -- Hva rutinen heter. «Arbeid i tavle», ikke «Rutine 3».
  tittel text not null,
  -- Selve rutinen. Ren tekst, som på punktet.
  innhold text,

  -- Egen ansvarlig. Faglig ansvarlig eier de el-faglige rutinene selv om
  -- kapittelet står på daglig leder.
  ansvarlig uuid references public.profiles(id),

  status text not null default 'utkast'
    check (status in ('utkast', 'vedtatt', 'utgatt')),

  -- Egen versjon. To rutiner under samme punkt endres i hver sin takt, og en
  -- felles teller ville gjort «versjon 4» til et tall uten betydning.
  gjeldende_versjon integer not null default 1,
  sort_order integer not null default 0,

  vedtatt_at timestamptz,
  vedtatt_av uuid references public.profiles(id),

  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ik_rutiner_punkt_idx on public.ik_rutiner (punkt_id);
create index if not exists ik_rutiner_company_idx on public.ik_rutiner (company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Revisjonene deles med punktene
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Én historikktabell, ikke to. Spørsmålet folk stiller er «hva sa dette den
-- dagen», og svaret skal ikke ligge to steder avhengig av om teksten tilfeldigvis
-- er et kapittel eller en rutine.
--
-- `punkt_id` fylles fortsatt for en rutinerevisjon — den forteller hvilket
-- kapittel rutinen hørte til, og gjør «hele historikken for punkt 3» til én
-- spørring.

alter table public.ik_revisjoner
  add column if not exists rutine_id uuid references public.ik_rutiner(id) on delete cascade;

-- Den gamle indeksen var `(punkt_id, versjon)`. Med to rutiner under samme punkt
-- ville begge kollidert på versjon 2. Erstattes av to partielle indekser —
-- tydeligere enn `nulls not distinct`, og virker uansett Postgres-versjon.
drop index if exists public.ik_revisjoner_versjon_unik;

create unique index if not exists ik_revisjoner_punkt_versjon_unik
  on public.ik_revisjoner (punkt_id, versjon) where rutine_id is null;

create unique index if not exists ik_revisjoner_rutine_versjon_unik
  on public.ik_revisjoner (rutine_id, versjon) where rutine_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RLS — samme regel som punktene
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Lesing: hele firmaet. Skriving: `kan_skrive_ik()` — eier, administrator og
-- installatør. En rutine som er lettere å endre enn kapittelet den ligger i
-- ville vært en bakvei rundt den regelen.

alter table public.ik_rutiner enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_rutiner' and policyname='ik_rutiner_sel') then
    create policy ik_rutiner_sel on public.ik_rutiner for select
      using (company_id = public.current_company_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_rutiner' and policyname='ik_rutiner_ins') then
    create policy ik_rutiner_ins on public.ik_rutiner for insert
      with check (company_id = public.current_company_id() and public.kan_skrive_ik());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ik_rutiner' and policyname='ik_rutiner_upd') then
    create policy ik_rutiner_upd on public.ik_rutiner for update
      using (company_id = public.current_company_id() and public.kan_skrive_ik())
      with check (company_id = public.current_company_id());
  end if;
  -- Ingen delete-policy. Soft delete, regel 5.
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Triggere
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists ik_rutiner_touch on public.ik_rutiner;
create trigger ik_rutiner_touch before update on public.ik_rutiner
  for each row execute function public.touch_updated_at();

drop trigger if exists ik_rutiner_audit on public.ik_rutiner;
create trigger ik_rutiner_audit after insert or update or delete on public.ik_rutiner
  for each row execute function public.audit_row();

-- ── Kapittelversjonen følger rutinene ──────────────────────────────────────
--
-- Uten denne står en lesebekreftelse på punkt 3 versjon 2 igjen som gyldig
-- etter at rutinen «Arbeid i tavle» ble skrevet om. Den ansatte har da bekreftet
-- å ha lest noe som ikke lenger står der.
--
-- Teller opp ved ny rutine, ved endret tekst eller tittel, og ved soft delete.
-- IKKE ved `sort_order` eller `ansvarlig`: å flytte en rutine opp i lista eller
-- bytte hvem som eier den endrer ikke hva folk skal ha lest, og en ny
-- lesekvittering for det er en kvittering som lærer folk å klikke uten å lese.

-- `security definer` fordi oppdateringen av punktet skal skje uansett hvem som
-- rørte rutinen — også når det er `service_role` eller en import. En
-- kapittelversjon som bare telles opp når RLS tilfeldigvis slipper gjennom, er
-- en versjon man ikke kan stole på.
create or replace function public.ik_punkt_versjon_folger_rutine()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  maalpunkt uuid;
begin
  maalpunkt := coalesce(new.punkt_id, old.punkt_id);

  if tg_op = 'UPDATE'
     and new.innhold is not distinct from old.innhold
     and new.tittel is not distinct from old.tittel
     and new.deleted_at is not distinct from old.deleted_at then
    return null;
  end if;

  update public.ik_punkter
     set gjeldende_versjon = gjeldende_versjon + 1
   where id = maalpunkt;

  return null;
end $fn$;

drop trigger if exists ik_rutiner_bumper_punkt on public.ik_rutiner;
create trigger ik_rutiner_bumper_punkt
  after insert or update on public.ik_rutiner
  for each row execute function public.ik_punkt_versjon_folger_rutine();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Flytt teksten som allerede er skrevet
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ett punkt med tekst blir ett punkt med én rutine. Tittelen blir punktets egen
-- — den som skrev teksten skrev den som «rutinen for dette punktet», og det er
-- det navnet hun kjenner den igjen på.
--
-- `gjeldende_versjon` arves, så historikken fra før ikke ser ut til å begynne på
-- nytt. Triggeren over er slått av under flyttingen: dette er ikke en endring
-- folk skal måtte kvittere for på nytt, det er den samme teksten på et nytt sted.

alter table public.ik_rutiner disable trigger ik_rutiner_bumper_punkt;

insert into public.ik_rutiner
  (company_id, punkt_id, tittel, innhold, ansvarlig, status,
   gjeldende_versjon, sort_order, vedtatt_at, vedtatt_av, created_by, created_at)
select
  p.company_id, p.id, p.tittel, p.innhold, p.ansvarlig, p.status,
  p.gjeldende_versjon, 0, p.vedtatt_at, p.vedtatt_av, p.created_by, p.created_at
from public.ik_punkter p
where p.deleted_at is null
  and coalesce(p.innhold, '') <> ''
  and not exists (select 1 from public.ik_rutiner r where r.punkt_id = p.id);

alter table public.ik_rutiner enable trigger ik_rutiner_bumper_punkt;

-- Revisjonene fra før peker på punktet og blir liggende der. De ER kapittelets
-- historikk fram til nå, og å skrive dem om til rutinerevisjoner ville vært å
-- endre historikk for å få den til å passe en ny modell.

-- ═══════════════════════════════════════════════════════════════════════════
-- Tilbakerulling
-- ═══════════════════════════════════════════════════════════════════════════
--
--   drop trigger ik_rutiner_bumper_punkt on public.ik_rutiner;
--   drop function public.ik_punkt_versjon_folger_rutine();
--   drop index public.ik_revisjoner_rutine_versjon_unik;
--   drop index public.ik_revisjoner_punkt_versjon_unik;
--   create unique index ik_revisjoner_versjon_unik on public.ik_revisjoner (punkt_id, versjon);
--   alter table public.ik_revisjoner drop column rutine_id;
--   drop table public.ik_rutiner;
--   -- `ik_punkter.innhold` står urørt hele veien.
