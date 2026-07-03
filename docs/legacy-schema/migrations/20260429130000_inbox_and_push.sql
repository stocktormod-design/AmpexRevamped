-- Sprint 2: inbox_messages + push_subscriptions

-- inbox_messages --------------------------------------------------------
create table if not exists public.inbox_messages (
  id           uuid        primary key default gen_random_uuid(),
  recipient_id uuid        not null references public.profiles  (id) on delete cascade,
  sender_id    uuid                 references public.profiles  (id) on delete set null,
  company_id   uuid        not null references public.companies (id) on delete cascade,
  kind         text        not null default 'general',
  title        text        not null,
  body         text,
  link_url     text,
  payload      jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_inbox_messages_recipient_id
  on public.inbox_messages (recipient_id);

create index if not exists idx_inbox_messages_company_id
  on public.inbox_messages (company_id);

-- Partial index for fast unread-count queries
create index if not exists idx_inbox_messages_unread
  on public.inbox_messages (recipient_id)
  where read_at is null;

alter table public.inbox_messages enable row level security;

-- Users can read their own messages
drop policy if exists "inbox_messages_select_own" on public.inbox_messages;
create policy "inbox_messages_select_own"
on public.inbox_messages for select
using (recipient_id = auth.uid());

-- Users can mark their own messages as read (update read_at only)
drop policy if exists "inbox_messages_update_own" on public.inbox_messages;
create policy "inbox_messages_update_own"
on public.inbox_messages for update
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- Insertion is server-side only (admin client bypasses RLS; no user-insert policy)

-- push_subscriptions ----------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  endpoint   text        not null,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
on public.push_subscriptions for select
using (user_id = auth.uid());

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
on public.push_subscriptions for insert
with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
on public.push_subscriptions for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
on public.push_subscriptions for delete
using (user_id = auth.uid());

drop trigger if exists trg_push_subscriptions_updated_at on public.push_subscriptions;
create trigger trg_push_subscriptions_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();
