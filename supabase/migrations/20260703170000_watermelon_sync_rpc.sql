-- WatermelonDB synk-protokoll: pull/push for orders.
-- SECURITY INVOKER med vilje — RLS scoper alt til brukerens firma.
-- Tidsstempler er epoch-millisekunder (WatermelonDB-konvensjon).
-- Konflikt: last-write-wins (lite firma, samtidige redigeringer sjeldne).

create or replace function public.watermelon_pull(last_pulled_at bigint default 0)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  _now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  _cutoff timestamptz := to_timestamp(last_pulled_at / 1000.0);
  _created jsonb;
  _updated jsonb;
  _deleted jsonb;
begin
  select coalesce(jsonb_agg(row_j), '[]'::jsonb) into _created
  from (
    select jsonb_build_object(
      'id', id,
      'order_number', order_number,
      'title', title,
      'description', description,
      'customer_name', customer_name,
      'customer_phone', customer_phone,
      'address', address,
      'status', status::text,
      'assigned_to', assigned_to,
      'scheduled_at', (extract(epoch from scheduled_at) * 1000)::bigint,
      'created_at', (extract(epoch from created_at) * 1000)::bigint,
      'updated_at', (extract(epoch from updated_at) * 1000)::bigint
    ) as row_j
    from orders
    where deleted_at is null and created_at > _cutoff
  ) c;

  select coalesce(jsonb_agg(row_j), '[]'::jsonb) into _updated
  from (
    select jsonb_build_object(
      'id', id,
      'order_number', order_number,
      'title', title,
      'description', description,
      'customer_name', customer_name,
      'customer_phone', customer_phone,
      'address', address,
      'status', status::text,
      'assigned_to', assigned_to,
      'scheduled_at', (extract(epoch from scheduled_at) * 1000)::bigint,
      'created_at', (extract(epoch from created_at) * 1000)::bigint,
      'updated_at', (extract(epoch from updated_at) * 1000)::bigint
    ) as row_j
    from orders
    where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff
  ) u;

  select coalesce(jsonb_agg(id), '[]'::jsonb) into _deleted
  from orders
  where deleted_at is not null and deleted_at > _cutoff;

  return jsonb_build_object(
    'changes', jsonb_build_object(
      'orders', jsonb_build_object(
        'created', _created,
        'updated', _updated,
        'deleted', _deleted
      )
    ),
    'timestamp', _now_ms
  );
end $$;

create or replace function public.watermelon_push(changes jsonb, last_pulled_at bigint default 0)
returns void
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
begin
  -- created + updated behandles likt: upsert (LWW). company_id/created_by settes
  -- server-side — klienten kan ikke skrive seg inn i andre firma (RLS håndhever også).
  for r in
    select * from jsonb_array_elements(
      coalesce(changes -> 'orders' -> 'created', '[]'::jsonb) ||
      coalesce(changes -> 'orders' -> 'updated', '[]'::jsonb)
    )
  loop
    insert into orders (id, company_id, title, description, customer_name,
                        customer_phone, address, status, assigned_to, scheduled_at, created_by)
    values (
      (r ->> 'id')::uuid,
      public.current_company_id(),
      coalesce(r ->> 'title', ''),
      r ->> 'description',
      r ->> 'customer_name',
      r ->> 'customer_phone',
      r ->> 'address',
      coalesce(nullif(r ->> 'status', ''), 'mottatt')::public.order_status,
      nullif(r ->> 'assigned_to', '')::uuid,
      case when (r ->> 'scheduled_at') is null then null
           else to_timestamp((r ->> 'scheduled_at')::bigint / 1000.0) end,
      auth.uid()
    )
    on conflict (id) do update set
      title = excluded.title,
      description = excluded.description,
      customer_name = excluded.customer_name,
      customer_phone = excluded.customer_phone,
      address = excluded.address,
      status = excluded.status,
      assigned_to = excluded.assigned_to,
      scheduled_at = excluded.scheduled_at
    where orders.company_id = public.current_company_id();
  end loop;

  update orders set deleted_at = now()
  where deleted_at is null
    and company_id = public.current_company_id()
    and id in (
      select value::uuid
      from jsonb_array_elements_text(coalesce(changes -> 'orders' -> 'deleted', '[]'::jsonb))
    );
end $$;

revoke execute on function public.watermelon_pull(bigint) from anon;
revoke execute on function public.watermelon_push(jsonb, bigint) from anon;
grant execute on function public.watermelon_pull(bigint) to authenticated;
grant execute on function public.watermelon_push(jsonb, bigint) to authenticated;
