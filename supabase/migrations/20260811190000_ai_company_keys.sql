-- Per-firma AI-nøkler (Fase 0b/2: Gemini) — Ampex er tenkt som ekte multi-firma SaaS,
-- ikke bare ett internt verktøy, så AI-kostnaden må kunne isoleres per firma etter hvert.
--
-- Nøkler lagres i Supabase Vault (kryptert på disk), ALDRI i en vanlig kolonne —
-- en API-nøkkel skal aldri være lesbar via en RLS-scopet spørring, uansett hvor
-- stram policyen er. Navnekonvensjon: 'ai_<provider>_key_<company_id>'.
--
-- Modell: har firmaet satt sin egen nøkkel → bruk den (egen Gemini-fakturering/kvote).
-- Har de ikke det → Edge Function faller tilbake til Ampex' egen delte nøkkel
-- (GEMINI_API_KEY som secret på funksjonen) — nye firma kan bruke AI-assistenten
-- fra dag én uten å måtte skaffe en Google-konto først.
--
-- set_company_ai_key() kalles i dag kun manuelt (Supabase SQL-editor) — en
-- selvbetjent admin-innstillinger-skjerm er ikke bygget ennå, se Ampex-planen.

create extension if not exists supabase_vault;

create or replace function public.get_company_ai_key(p_company_id uuid, p_provider text default 'gemini')
returns text
language sql stable security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'ai_' || p_provider || '_key_' || p_company_id::text
  limit 1
$$;

-- Kun service-role (Edge Function via ctx.supabaseAdmin) skal kunne kalle denne —
-- aldri anon/authenticated, som ville latt en klient sonde etter om en nøkkel finnes.
revoke execute on function public.get_company_ai_key(uuid, text) from public, anon, authenticated;
grant execute on function public.get_company_ai_key(uuid, text) to service_role;

create or replace function public.set_company_ai_key(p_company_id uuid, p_key text, p_provider text default 'gemini')
returns void
language plpgsql security definer
set search_path = public, vault
as $$
declare
  _name text := 'ai_' || p_provider || '_key_' || p_company_id::text;
  _existing uuid;
begin
  select id into _existing from vault.secrets where name = _name;
  if _existing is not null then
    perform vault.update_secret(_existing, p_key);
  else
    perform vault.create_secret(p_key, _name);
  end if;
end $$;

revoke execute on function public.set_company_ai_key(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_company_ai_key(uuid, text, text) to service_role;
