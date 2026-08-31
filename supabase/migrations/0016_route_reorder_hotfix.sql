-- NekoTrip v0.6.1
-- Robust reorder compatibility function.
-- Keeps the same RPC signature used by the client.

begin;

create or replace function public.reorder_trip_place(
  p_trip_place_id uuid,
  p_direction text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target_trip_id uuid;
  target_day_id uuid;
  target_order integer;
  neighbor_id uuid;
  neighbor_order integer;
  dir text := lower(trim(coalesce(p_direction, '')));
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if dir not in ('up', 'down') then
    raise exception 'Direction must be up or down';
  end if;

  select tp.trip_id, tp.day_id, tp.order_index
    into target_trip_id, target_day_id, target_order
  from public.trip_places tp
  where tp.id = p_trip_place_id
  for update;

  if target_trip_id is null then
    raise exception 'Trip place not found';
  end if;

  if not public.can_edit_trip(target_trip_id) then
    raise exception 'Editor access required';
  end if;

  -- Find the immediate visual neighbor. This intentionally does not assume
  -- contiguous order_index values, so legacy gaps/duplicates do not break it.
  if dir = 'up' then
    select tp.id, tp.order_index
      into neighbor_id, neighbor_order
    from public.trip_places tp
    where tp.trip_id = target_trip_id
      and tp.day_id is not distinct from target_day_id
      and (tp.order_index < target_order
           or (tp.order_index = target_order and tp.id < p_trip_place_id))
      and tp.id <> p_trip_place_id
    order by tp.order_index desc, tp.created_at desc, tp.id desc
    limit 1
    for update;
  else
    select tp.id, tp.order_index
      into neighbor_id, neighbor_order
    from public.trip_places tp
    where tp.trip_id = target_trip_id
      and tp.day_id is not distinct from target_day_id
      and (tp.order_index > target_order
           or (tp.order_index = target_order and tp.id > p_trip_place_id))
      and tp.id <> p_trip_place_id
    order by tp.order_index asc, tp.created_at asc, tp.id asc
    limit 1
    for update;
  end if;

  -- Already first/last in the group: friendly no-op.
  if neighbor_id is null then
    return;
  end if;

  -- Swap in one statement. There is no uniqueness constraint on order_index,
  -- so this is safe even for legacy duplicate values.
  update public.trip_places tp
  set order_index = case
      when tp.id = p_trip_place_id then neighbor_order
      when tp.id = neighbor_id then target_order
      else tp.order_index
    end,
    updated_by = uid,
    updated_at = clock_timestamp()
  where tp.id in (p_trip_place_id, neighbor_id);

  -- Normalize the whole day/list to stable 0..N-1 order after the swap.
  with ranked as (
    select tp.id,
           row_number() over (order by tp.order_index, tp.updated_at, tp.created_at, tp.id) - 1 as new_order
    from public.trip_places tp
    where tp.trip_id = target_trip_id
      and tp.day_id is not distinct from target_day_id
  )
  update public.trip_places tp
  set order_index = ranked.new_order,
      updated_by = uid,
      updated_at = clock_timestamp()
  from ranked
  where tp.id = ranked.id
    and tp.order_index is distinct from ranked.new_order;

  update public.trips
  set updated_at = clock_timestamp()
  where id = target_trip_id;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
    target_trip_id,
    uid,
    'trip_place',
    p_trip_place_id,
    'reordered',
    jsonb_build_object('direction', dir)
  );
end;
$$;

revoke all on function public.reorder_trip_place(uuid,text) from public;
grant execute on function public.reorder_trip_place(uuid,text) to authenticated;

commit;

-- Verification
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'reorder_trip_place';
