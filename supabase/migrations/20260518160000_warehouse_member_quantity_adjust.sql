-- Montør: justere antall på hovedlager (standard) og egen tilordnet bil-rad.

create or replace function public.can_adjust_warehouse_item(p_warehouse_id uuid, p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.warehouse_items wi
    join public.warehouses w on w.id = wi.warehouse_id
    where wi.id = p_item_id
      and wi.warehouse_id = p_warehouse_id
      and w.company_id = public.get_user_company_id()
      and (
        public.is_company_admin()
        or coalesce(w.kind, 'standard') = 'standard'
        or (
          w.kind = 'vehicle'
          and auth.uid() is not null
          and auth.uid() = any (wi.assigned_user_ids)
        )
      )
  );
$$;

create or replace function public.adjust_warehouse_item_quantity(
  p_warehouse_id uuid,
  p_item_id uuid,
  p_delta integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric;
  v_new numeric;
begin
  if p_delta is null or p_delta = 0 then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig endring');
  end if;

  if not public.can_adjust_warehouse_item(p_warehouse_id, p_item_id) then
    return jsonb_build_object('ok', false, 'error', 'Ingen tilgang til denne varen');
  end if;

  select wi.quantity
  into v_qty
  from public.warehouse_items wi
  where wi.id = p_item_id
    and wi.warehouse_id = p_warehouse_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Vare ikke funnet');
  end if;

  v_new := greatest(0::numeric, v_qty + p_delta::numeric);

  update public.warehouse_items
  set quantity = v_new
  where id = p_item_id
    and warehouse_id = p_warehouse_id;

  return jsonb_build_object('ok', true, 'new_quantity', v_new);
end;
$$;

revoke all on function public.can_adjust_warehouse_item(uuid, uuid) from public;
revoke all on function public.adjust_warehouse_item_quantity(uuid, uuid, integer) from public;
grant execute on function public.can_adjust_warehouse_item(uuid, uuid) to authenticated;
grant execute on function public.adjust_warehouse_item_quantity(uuid, uuid, integer) to authenticated;
