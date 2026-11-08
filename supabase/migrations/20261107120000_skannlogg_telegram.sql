-- Ny skannlogg → Telegram-melding til Tormod (07.11). Testerne sender loggen automatisk
-- etter hvert skann (lib/skannlogg.ts); dette sier fra med en gang i stedet for at vi må
-- spørre basen. Token og chat-id ligger i Vault (telegram_bot_token, telegram_chat_id),
-- ikke her. Mangler en av dem, sendes ingenting — innsettingen feiler aldri av dette.

create extension if not exists pg_net with schema extensions;

create or replace function public.skannlogg_telegram()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text;
  chat text;
  navn text;
  linje text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'telegram_chat_id';
  if token is null or chat is null then return new; end if;

  select coalesce(p.full_name, u.email, 'ukjent') into navn
    from auth.users u left join profiles p on p.id = u.id where u.id = new.user_id;
  linje := split_part(coalesce(new.logg, ''), E'\n', 1);

  perform net.http_post(
    url := 'https://api.telegram.org/bot' || token || '/sendMessage',
    body := jsonb_build_object(
      'chat_id', chat,
      'text', 'Skannlogg fra ' || coalesce(navn, 'ukjent') || ' · ' || coalesce(new.modell, '?') || ' · iOS ' || coalesce(new.ios, '?')
        || E'\n' || linje || E'\nøkt ' || coalesce(new.okt, '–') || ' · id ' || new.id
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  return new; -- loggen skal lagres uansett
end;
$$;

revoke all on function public.skannlogg_telegram() from public, anon, authenticated;

drop trigger if exists skannlogg_telegram on public.skannlogg;
create trigger skannlogg_telegram after insert on public.skannlogg
  for each row execute function public.skannlogg_telegram();
