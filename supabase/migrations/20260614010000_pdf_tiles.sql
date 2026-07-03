-- Deep-zoom tile metadata for PDF drawings/layers (OpenSeadragon viewer migration).
-- Keyed by storage file_path so it covers both `drawings.file_path` and
-- `drawing_layers.file_path` (PDF subjects). Written by the tiling pipeline
-- (scripts/tile-drawing.mjs) via the service role; read by the app to build the
-- OpenSeadragon tile source. See docs/PDF_TILING_MIGRATION.md.

create table if not exists public.pdf_tiles (
  file_path  text primary key,
  base_url   text    not null,   -- e.g. https://pub-xxx.r2.dev/tiles/<id>/<rev>/page_files/
  width      integer not null,
  height     integer not null,
  tile_size  integer not null default 256,
  overlap    integer not null default 1,
  format     text    not null default 'jpg',
  rev        text    not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_pdf_tiles_set_updated_at on public.pdf_tiles;
create trigger trg_pdf_tiles_set_updated_at
before update on public.pdf_tiles
for each row execute function public.set_updated_at();

alter table public.pdf_tiles enable row level security;

-- Tile metadata (URLs + dimensions) is readable by any authenticated user; writes
-- happen only via the service role (tiling pipeline), which bypasses RLS.
drop policy if exists "pdf_tiles_select_authenticated" on public.pdf_tiles;
create policy "pdf_tiles_select_authenticated" on public.pdf_tiles
  for select to authenticated using (true);
