alter table public.project_messages
  add column if not exists notify_team boolean not null default false;

comment on column public.project_messages.notify_team is
  'True når avsender valgte å varsle prosjektteamet via innboks/push.';
