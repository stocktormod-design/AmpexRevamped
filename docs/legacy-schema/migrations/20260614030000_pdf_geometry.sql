-- Persisted PdfDrawingGeometry per PDF (drawing base or layer subject), keyed by storage file_path.
-- The OSD viewer needs this geometry (content crop / docOffset / stage / renderScale) to place
-- overlays + rooms, but recomputing it via pdf.js on open is slow (~8s) and memory-heavy on iOS.
-- The first client to open a drawing computes it once and upserts here; everyone else (any device)
-- then gets it instantly as JSON. Non-sensitive layout math. See docs/PDF_TILING_MIGRATION.md.

create table if not exists public.pdf_geometry (
  file_path  text primary key,
  geometry   jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.pdf_geometry enable row level security;

-- Readable + writable by any authenticated user (it is derived from a PDF they can already view).
drop policy if exists "pdf_geometry_select_authenticated" on public.pdf_geometry;
create policy "pdf_geometry_select_authenticated" on public.pdf_geometry
  for select to authenticated using (true);

drop policy if exists "pdf_geometry_write_authenticated" on public.pdf_geometry;
create policy "pdf_geometry_write_authenticated" on public.pdf_geometry
  for all to authenticated using (true) with check (true);
