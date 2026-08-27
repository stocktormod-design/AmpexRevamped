-- Fakturanummer som Ampex eier, til CSV-eksport mot regnskapssystemet.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvorfor en fil og ikke API-et
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tripletex' utviklervilkår gjelder API-TILGANG. Lager vi en fil som
-- regnskapsføreren importerer, rører vi aldri API-et — og da finnes hverken
-- §2.2.13 (skriftlig AI-samtykke før produksjonstilgang), §2.2.9 (de kan
-- pålegge priser og sperre endepunkter etter eget skjønn) eller den løpende
-- innsikten en konkurrent ellers får i kundetallet vårt.
--
-- Se `docs/REGNSKAPSINTEGRASJON.md`: Tripletex Elektro/VVS er konkurrenten,
-- ikke bare leverandøren.
--
-- Fila virker dessuten overalt. Fiken, PowerOffice, eller en regnskapsfører
-- som bytter system neste år — CSV er CSV. `Regnskapsadapter` (API-veien)
-- beholdes uendret ved siden av; dette er en vei til, ikke en erstatning.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Hvorfor serien starter på 10001
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tripletex' egen dokumentasjon advarer eksplisitt:
--
--   «Når du lager en faktura i Tripletex, så tas det ikke hensyn til
--   importerte fakturaer. Skill mellom nummerseriene for importerte fakturaer
--   og fakturaer som er laget manuelt i systemet.»
--
-- Lager regnskapsføreren faktura 11 manuelt mens vi har importert 11, får hun
-- «fakturanummeret er allerede i bruk» — og da er det VÅR import som har
-- forgiftet hennes nummerserie. Deres eget råd er å legge importerte langt
-- unna; 10001 gir ~10 000 manuelle fakturaer før noen kollisjon er mulig.
--
-- Startpunktet er en DEFAULT, ikke en lov: firmaer som allerede har fakturert
-- mange tusen manuelt setter sitt eget med `set_fakturaserie_start()`.
--
-- Tilbakerulling: se nederst.

alter table public.nummerserier drop constraint if exists nummerserier_serie_check;

alter table public.nummerserier add constraint nummerserier_serie_check
  check (serie in ('ordre', 'tilbud', 'faktura'));

comment on table public.nummerserier is
  'Lopenummer per firma per serie. Leser aldri fra radtabellene, saa et nummer '
  'kan ikke gjenbrukes selv om raden forsvinner. Serie ''faktura'' starter hoyt '
  '(10001) med vilje — se migrasjonen 20260827100000.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Startpunktet, satt én gang per firma
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Kun `service_role` (Edge Function), som resten av tellerne. En klient som
-- kunne flytte startpunktet kunne flytte det NEDOVER, og da er «aldri
-- gjenbrukt» ikke sant lenger.

create or replace function public.set_fakturaserie_start(p_company uuid, p_start integer)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_start < 1 then
    raise exception 'Startpunktet maa vaere minst 1';
  end if;

  insert into public.nummerserier (company_id, serie, neste)
  values (p_company, 'faktura', p_start)
  on conflict (company_id, serie) do update
    -- Aldri NEDOVER. Et startpunkt som senkes ville delt ut et nummer som
    -- allerede staar paa en sendt faktura.
    set neste = greatest(public.nummerserier.neste, excluded.neste);
end $fn$;

revoke execute on function public.set_fakturaserie_start(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_fakturaserie_start(uuid, integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tilbakerulling
-- ═══════════════════════════════════════════════════════════════════════════
--
--   drop function public.set_fakturaserie_start(uuid, integer);
--   delete from public.nummerserier where serie = 'faktura';
--   alter table public.nummerserier drop constraint nummerserier_serie_check;
--   alter table public.nummerserier add constraint nummerserier_serie_check
--     check (serie in ('ordre', 'tilbud'));
