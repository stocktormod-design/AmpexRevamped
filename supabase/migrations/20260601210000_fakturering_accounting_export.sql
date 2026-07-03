-- Fakturering: ordrestatus «klar til fakturering» + ERP-eksportsporing på master log.

do $$
begin
  alter type public.order_status add value if not exists 'ready_for_invoicing';
exception
  when duplicate_object then null;
end $$;

alter table public.order_master_log
  add column if not exists exported_to_accounting_at timestamptz,
  add column if not exists exported_accounting_provider text;

comment on column public.order_master_log.exported_to_accounting_at is
  'Tidspunkt da fakturagrunnlag ble sendt til Fiken/Tripletex.';

comment on column public.order_master_log.exported_accounting_provider is
  'fiken | tripletex — hvilken ERP-integrasjon som mottok eksporten.';

alter table public.company_settings
  add column if not exists default_hourly_rate_nok numeric(10, 2),
  add column if not exists fiken_api_token text,
  add column if not exists tripletex_session_token text;

comment on column public.company_settings.default_hourly_rate_nok is
  'Standard timepris (NOK) for visning av timer på fakturagrunnlag — faktisk ERP bruker company_integrations + Vault.';

comment on column public.company_settings.fiken_api_token is
  'Valgfritt legacy-felt; anbefalt: company_integrations + Vault (regnskap-siden).';

comment on column public.company_settings.tripletex_session_token is
  'Valgfritt legacy-felt; anbefalt: company_integrations + Vault.';
