-- Floorplan data generated from RoomPlan scans.
-- One floorplan per room; the structured JSON is the source of truth and is editable from the web.

create table if not exists room_floorplans (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references drawing_rooms(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  floorplan     jsonb not null,          -- walls, doors, windows, objects (from RoomPlanFloorplanExporter)
  edited        jsonb,                   -- user edits layer (overrides on top of floorplan)
  glb_path      text,                    -- R2/Supabase path of the source mesh GLB
  captured_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index room_floorplans_room_id_idx on room_floorplans(room_id);

alter table room_floorplans enable row level security;

create policy "company members can read floorplans"
  on room_floorplans for select
  using (company_id = (select company_id from profiles where id = auth.uid()));

create policy "company members can insert floorplans"
  on room_floorplans for insert
  with check (company_id = (select company_id from profiles where id = auth.uid()));

create policy "company members can update floorplans"
  on room_floorplans for update
  using (company_id = (select company_id from profiles where id = auth.uid()));
