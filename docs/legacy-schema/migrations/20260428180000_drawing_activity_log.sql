-- Aktivitetslogg per tegning (publisering/sletting/oppdatering av overlays) + Realtime for andre brukere.

create table if not exists public.drawing_activity_log (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  overlay_id uuid references public.drawing_overlays (id) on delete set null,
  tool_type text,
  summary text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_drawing_activity_log_drawing_created
  on public.drawing_activity_log (drawing_id, created_at desc);

alter table public.drawing_activity_log enable row level security;

-- Les: samme tilgang som tegning (offisiell + blueprint + allowlist / admin / opplaster)
create policy "drawing_activity_log_select"
on public.drawing_activity_log for select
using (
  exists (
    select 1
    from public.drawings d
    join public.projects p on p.id = d.project_id
    where d.id = drawing_activity_log.drawing_id
      and p.company_id = public.get_user_company_id()
      and (
        public.is_company_admin()
        or d.uploaded_by = auth.uid()
        or (
          d.is_published = true
          and public.can_view_project_blueprints(d.project_id)
          and (
            d.visible_to_user_ids is null
            or coalesce(cardinality(d.visible_to_user_ids), 0) = 0
            or auth.uid() = any(d.visible_to_user_ids)
          )
        )
      )
  )
);

-- Inserter kun via service role (server actions med admin-klient)
do $$
begin
  alter publication supabase_realtime add table public.drawing_activity_log;
exception
  when duplicate_object then null;
end $$;

grant select on public.drawing_activity_log to authenticated;
