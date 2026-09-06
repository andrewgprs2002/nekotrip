-- NekoTrip v0.8.8 — Bidirectional Shared Wishlist / Trip permission sync
--
-- When a Shared Wishlist place is added to a Trip:
--
-- Shared Wishlist -> Trip
--   wishlist owner/editor -> trip editor
--   wishlist viewer       -> trip viewer
--
-- Trip -> Shared Wishlist
--   trip owner/editor -> wishlist editor
--   trip viewer       -> wishlist viewer
--
-- Important rules:
-- - Shared Wishlist ownership never transfers automatically.
-- - Trip ownership never transfers automatically.
-- - Existing higher permissions are never downgraded.
-- - Membership copied by this sync is persistent.
-- - Removing a place does NOT auto-remove membership.
-- - Owners must explicitly remove access later if desired.

begin;

create or replace function public.copy_wishlist_space_members_to_trip(
  p_space_id uuid,
  p_trip_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  copied_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Trip editor access required';
  end if;

  if not public.is_wishlist_space_member(p_space_id) then
    raise exception 'Shared Wishlist membership required';
  end if;

  insert into public.trip_members(trip_id, user_id, role)
  select
    p_trip_id,
    wsm.user_id,
    case
      when wsm.role in ('owner','editor') then 'editor'::public.trip_role
      else 'viewer'::public.trip_role
    end
  from public.wishlist_space_members wsm
  where wsm.space_id = p_space_id
  on conflict (trip_id, user_id)
  do update set role =
    case
      when public.trip_members.role = 'owner'::public.trip_role
        then 'owner'::public.trip_role
      when public.trip_members.role = 'editor'::public.trip_role
        then 'editor'::public.trip_role
      when excluded.role = 'editor'::public.trip_role
        then 'editor'::public.trip_role
      else public.trip_members.role
    end;

  get diagnostics copied_count = row_count;
  return copied_count;
end;
$$;

create or replace function public.copy_trip_members_to_wishlist_space(
  p_trip_id uuid,
  p_space_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  copied_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Trip editor access required';
  end if;

  if not public.can_edit_wishlist_space(p_space_id) then
    raise exception 'Shared Wishlist editor access required';
  end if;

  insert into public.wishlist_space_members(space_id, user_id, role)
  select
    p_space_id,
    tm.user_id,
    case
      when tm.role in ('owner','editor') then 'editor'
      else 'viewer'
    end
  from public.trip_members tm
  where tm.trip_id = p_trip_id
  on conflict (space_id, user_id)
  do update set role =
    case
      -- Shared Wishlist owner remains owner.
      when public.wishlist_space_members.role = 'owner'
        then 'owner'

      -- Existing editor never gets downgraded to viewer.
      when public.wishlist_space_members.role = 'editor'
        then 'editor'

      -- Promote viewer when Trip grants owner/editor access.
      when excluded.role = 'editor'
        then 'editor'

      else public.wishlist_space_members.role
    end;

  get diagnostics copied_count = row_count;
  return copied_count;
end;
$$;

create or replace function public.add_wishlist_item_to_trip_v2(
  p_item_id uuid,
  p_trip_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  item_row public.wishlist_items%rowtype;
  existing_id uuid;
  next_order integer;
  new_id uuid;
  source_item_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_access_wishlist_item(p_item_id, false) then
    raise exception 'Wishlist item not found';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Editor access required for target trip';
  end if;

  select *
  into item_row
  from public.wishlist_items
  where id = p_item_id;

  source_item_id := case
    when item_row.space_id is not null then item_row.id
    else null
  end;

  if item_row.space_id is not null then
    -- First: Shared Wishlist collaborators become Trip collaborators.
    perform public.copy_wishlist_space_members_to_trip(item_row.space_id, p_trip_id);

    -- Then: any pre-existing Trip collaborators are copied back into the
    -- Shared Wishlist. No automatic owner transfer occurs.
    perform public.copy_trip_members_to_wishlist_space(p_trip_id, item_row.space_id);
  end if;

  select id
  into existing_id
  from public.trip_places
  where trip_id = p_trip_id
    and place_id = item_row.place_id
  order by created_at
  limit 1;

  if existing_id is not null then
    if source_item_id is not null then
      update public.trip_places
      set source_wishlist_item_id = coalesce(source_wishlist_item_id, source_item_id),
          updated_by = uid,
          updated_at = clock_timestamp()
      where id = existing_id;
    end if;

    return existing_id;
  end if;

  select coalesce(max(order_index), -1) + 1
  into next_order
  from public.trip_places
  where trip_id = p_trip_id
    and day_id is null;

  insert into public.trip_places(
    trip_id,
    place_id,
    day_id,
    order_index,
    category,
    source_wishlist_item_id,
    created_by,
    updated_by
  )
  values(
    p_trip_id,
    item_row.place_id,
    null,
    next_order,
    item_row.category,
    source_item_id,
    uid,
    uid
  )
  returning id into new_id;

  insert into public.place_preferences(
    trip_place_id,
    user_id,
    rating,
    preference,
    updated_at
  )
  values(
    new_id,
    uid,
    item_row.rating,
    case
      when item_row.rating = 5 then 'must_go'::public.place_preference
      when item_row.rating >= 4 then 'interested'::public.place_preference
      when item_row.rating <= 1 then 'skip'::public.place_preference
      else 'neutral'::public.place_preference
    end,
    clock_timestamp()
  )
  on conflict(trip_place_id, user_id)
  do update set
    rating = excluded.rating,
    preference = excluded.preference,
    updated_at = excluded.updated_at;

  return new_id;
end;
$$;

revoke all on function public.copy_wishlist_space_members_to_trip(uuid,uuid) from public;
revoke all on function public.copy_trip_members_to_wishlist_space(uuid,uuid) from public;
revoke all on function public.add_wishlist_item_to_trip_v2(uuid,uuid) from public;

grant execute on function public.copy_wishlist_space_members_to_trip(uuid,uuid) to authenticated;
grant execute on function public.copy_trip_members_to_wishlist_space(uuid,uuid) to authenticated;
grant execute on function public.add_wishlist_item_to_trip_v2(uuid,uuid) to authenticated;

commit;

-- Verification
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'copy_wishlist_space_members_to_trip',
    'copy_trip_members_to_wishlist_space',
    'add_wishlist_item_to_trip_v2'
  )
order by routine_name;
