-- NekoTrip v0.8.10 — Fix Shared Wishlist / Trip permission sync direction
--
-- Root cause fixed:
-- add_wishlist_item_to_trip_v2() previously performed BOTH:
--   Shared Wishlist -> Trip
--   Trip -> Shared Wishlist
-- during a Shared Wishlist -> Trip action.
--
-- That allowed unrelated pre-existing Trip members to be copied back into
-- the Shared Wishlist, and then later propagated into other Trips.
--
-- Correct behavior for this operation:
--   Shared Wishlist -> Trip ONLY
--
-- The reverse helper copy_trip_members_to_wishlist_space() is intentionally
-- kept available for a future/explicit "Trip -> Shared Wishlist" action, but
-- is no longer called by add_wishlist_item_to_trip_v2().

begin;

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
    -- Correct one-way inheritance for this action:
    -- Shared Wishlist members become Trip members.
    perform public.copy_wishlist_space_members_to_trip(
      item_row.space_id,
      p_trip_id
    );

    -- IMPORTANT:
    -- Do NOT copy Trip members back into the Shared Wishlist here.
    -- Reverse inheritance belongs only to an explicit Trip -> Shared Wishlist action.
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

  -- Legacy preference data remains for compatibility only.
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

revoke all on function public.add_wishlist_item_to_trip_v2(uuid,uuid) from public;
grant execute on function public.add_wishlist_item_to_trip_v2(uuid,uuid) to authenticated;

commit;

-- Verification: should return exactly one row.
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'add_wishlist_item_to_trip_v2';
