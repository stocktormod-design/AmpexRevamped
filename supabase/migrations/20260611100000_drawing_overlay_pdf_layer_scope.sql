-- Scope published overlays to a specific drawing discipline (PDF layer).
-- null = visible on all subjects (legacy behaviour / global items).

alter table public.drawing_overlays
  add column if not exists pdf_layer_id uuid references public.drawing_layers(id) on delete set null;

create index if not exists idx_drawing_overlays_pdf_layer
  on public.drawing_overlays (drawing_id, pdf_layer_id)
  where pdf_layer_id is not null;
