-- QR Archive: public visibility flag on drawings, append-only audit log.

ALTER TABLE public.drawings
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- Append-only audit log (no UPDATE/DELETE RLS → effectively immutable once inserted).
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  anonymous_ip  text,
  action        text        NOT NULL,
  resource_type text        NOT NULL,
  resource_id   uuid,
  company_id    uuid,
  project_id    uuid,
  meta          jsonb       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON public.audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_project  ON public.audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created  ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can insert (server enforces what gets logged).
CREATE POLICY "audit_log_insert"
  ON public.audit_log FOR INSERT
  WITH CHECK (true);

-- Authenticated users can read their own company's log.
CREATE POLICY "audit_log_select_company"
  ON public.audit_log FOR SELECT
  USING (company_id = public.get_user_company_id());
