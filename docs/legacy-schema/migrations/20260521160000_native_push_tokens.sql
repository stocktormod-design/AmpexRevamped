-- Native app push tokens (FCM/APNs), separate from web push_subscriptions (VAPID).

create table if not exists public.native_push_tokens (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  platform   text        not null check (platform in ('ios', 'android')),
  token      text        not null,
  device_id  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists idx_native_push_tokens_user_id
  on public.native_push_tokens (user_id);

alter table public.native_push_tokens enable row level security;

drop policy if exists "native_push_tokens_select_own" on public.native_push_tokens;
create policy "native_push_tokens_select_own"
on public.native_push_tokens for select
using (user_id = auth.uid());

drop policy if exists "native_push_tokens_insert_own" on public.native_push_tokens;
create policy "native_push_tokens_insert_own"
on public.native_push_tokens for insert
with check (user_id = auth.uid());

drop policy if exists "native_push_tokens_update_own" on public.native_push_tokens;
create policy "native_push_tokens_update_own"
on public.native_push_tokens for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "native_push_tokens_delete_own" on public.native_push_tokens;
create policy "native_push_tokens_delete_own"
on public.native_push_tokens for delete
using (user_id = auth.uid());

drop trigger if exists trg_native_push_tokens_updated_at on public.native_push_tokens;
create trigger trg_native_push_tokens_updated_at
before update on public.native_push_tokens
for each row execute function public.set_updated_at();
