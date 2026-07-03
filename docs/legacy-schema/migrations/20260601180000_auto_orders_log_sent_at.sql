alter table public.auto_orders_log
  add column if not exists sent_at timestamptz;

comment on column public.auto_orders_log.sent_at is
  'Tidspunkt da samlebestillingen ble sendt (cron / Ahlsell-utsendelse).';

create index if not exists idx_auto_orders_log_pending
  on public.auto_orders_log (company_id, created_at)
  where status = 'pending';
