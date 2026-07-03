-- Anonymous access: add contributor name/firm fields, extend type to glb, add IP rate-limit index.

ALTER TABLE public.bygg_arkiv_items
  ADD COLUMN IF NOT EXISTS bidragsyter_navn  text,
  ADD COLUMN IF NOT EXISTS bidragsyter_firma text;

-- Extend allowed types to include 'glb'
ALTER TABLE public.bygg_arkiv_items DROP CONSTRAINT IF EXISTS bygg_arkiv_items_type_check;
ALTER TABLE public.bygg_arkiv_items ADD CONSTRAINT bygg_arkiv_items_type_check
  CHECK (type IN ('bilde', 'pdf', 'tekst', 'glb'));

-- Index for efficient per-IP rate-limit queries on audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_ip
  ON public.audit_log(anonymous_ip, created_at DESC)
  WHERE anonymous_ip IS NOT NULL;
