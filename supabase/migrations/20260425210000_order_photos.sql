-- Order photos: before/after/general documentation photos per order

CREATE TABLE IF NOT EXISTS order_photos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL REFERENCES orders(id)    ON DELETE CASCADE,
  company_id  uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uploaded_by uuid        REFERENCES profiles(id)           ON DELETE SET NULL,
  file_path   text        NOT NULL,
  caption     text,
  photo_type  text        NOT NULL DEFAULT 'general'
              CHECK (photo_type IN ('before', 'after', 'general')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_photos_select" ON order_photos
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY "order_photos_insert" ON order_photos
  FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY "order_photos_delete" ON order_photos
  FOR DELETE TO authenticated
  USING (
    company_id = (SELECT company_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    AND (
      (SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1) IN ('owner', 'admin')
      OR uploaded_by = auth.uid()
    )
  );

-- Storage bucket (private, max 10 MB per file)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-photos',
  'order-photos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: any authenticated user can read/write (app layer enforces company scoping)
CREATE POLICY "order_photos_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'order-photos');

CREATE POLICY "order_photos_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'order-photos');

CREATE POLICY "order_photos_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'order-photos');
