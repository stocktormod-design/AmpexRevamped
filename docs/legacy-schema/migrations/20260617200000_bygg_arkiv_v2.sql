-- Bygg-arkiv: per-order QR archives (v2 — order-level, replaces project-level is_public approach)

CREATE TABLE IF NOT EXISTS public.bygg_arkiv (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  company_id  uuid        NOT NULL,
  tittel      text        NOT NULL DEFAULT '',
  created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bygg_arkiv_order    ON public.bygg_arkiv(order_id);
CREATE INDEX IF NOT EXISTS idx_bygg_arkiv_company  ON public.bygg_arkiv(company_id);

ALTER TABLE public.bygg_arkiv ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bygg_arkiv_public_read" ON public.bygg_arkiv FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.bygg_arkiv_items (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  arkiv_id       uuid        NOT NULL REFERENCES public.bygg_arkiv(id) ON DELETE CASCADE,
  type           text        NOT NULL CHECK (type IN ('bilde', 'pdf', 'tekst')),
  tittel         text,
  beskrivelse    text,
  fag            text        CHECK (fag IN ('elektrisk', 'vvs', 'brann', 'bygg')),
  fil_sti        text,
  tekst_innhold  text,
  created_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted        boolean     NOT NULL DEFAULT false,
  deleted_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bygg_arkiv_items_arkiv   ON public.bygg_arkiv_items(arkiv_id);
CREATE INDEX IF NOT EXISTS idx_bygg_arkiv_items_created ON public.bygg_arkiv_items(created_at DESC);

ALTER TABLE public.bygg_arkiv_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bygg_arkiv_items_public_read" ON public.bygg_arkiv_items FOR SELECT USING (true);

-- Public storage bucket for archive content (QR-accessible by design)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bygg-arkiv', 'bygg-arkiv', true)
ON CONFLICT (id) DO NOTHING;
