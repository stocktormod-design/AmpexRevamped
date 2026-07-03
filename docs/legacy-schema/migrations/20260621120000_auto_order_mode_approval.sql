-- Guardrail for auto-påfyll: per-firma modus (godkjenn daglig vs auto-påfyll)
-- + godkjenningssteg på samlebestillinger (auto_orders_log).

-- 1) Modus per firma. Default 'approve' = trygg (ingen stille pengebruk).
alter table public.company_settings
  add column if not exists auto_order_mode text not null default 'approve';

alter table public.company_settings
  drop constraint if exists company_settings_auto_order_mode_check;
alter table public.company_settings
  add constraint company_settings_auto_order_mode_check
  check (auto_order_mode in ('approve', 'auto'));

comment on column public.company_settings.auto_order_mode is
  'approve: samlebestilling må godkjennes før utsending; auto: sendes automatisk av cron.';

-- 2) Godkjenningssteg på auto_orders_log: ny status 'approved' + hvem/når.
alter table public.auto_orders_log
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null;

alter table public.auto_orders_log
  drop constraint if exists auto_orders_log_status_check;
alter table public.auto_orders_log
  add constraint auto_orders_log_status_check
  check (status in ('pending', 'approved', 'sent', 'cancelled'));

comment on column public.auto_orders_log.approved_at is
  'Tidspunkt for godkjenning (approve-modus).';
comment on column public.auto_orders_log.approved_by is
  'Bruker som godkjente samlebestillingen.';

create index if not exists idx_auto_orders_log_company_status
  on public.auto_orders_log (company_id, status);
