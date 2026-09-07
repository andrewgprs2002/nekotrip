-- NekoTrip v0.8.13 — Rating Source Model
--
-- Product rule:
--   My Wishlist -> Shared Wishlist = copy rating by VALUE, then disconnect.
--   My Wishlist -> Trip            = copy rating by VALUE, then disconnect.
--   Shared Wishlist -> Trip        = keep a live link; Trip and Shared Wishlist
--                                    edit the SAME wishlist_item_ratings row.
--   Manual Trip place              = Trip-local rating.
--
-- Existing linked Shared-Wishlist Trip places are backfilled as shared_linked.
-- Existing unlinked Trip places are conservatively classified as manual.

begin;

alter table public.trip_places
  add column if not exists rating_source text not null default 'manual';

alter table public.trip_places
  drop constraint if exists trip_places_rating_source_check;

alter table public.trip_places
  add constraint trip_places_rating_source_check
  check (rating_source in ('shared_linked', 'private_snapshot', 'manual'));

update public.trip_places
set rating_source = case
  when source_wishlist_item_id is not null then 'shared_linked'
  else 'manual'
end
where rating_source is distinct from case
  when source_wishlist_item_id is not null then 'shared_linked'
  else 'manual'
end;

-- After create_shared_wishlist() copies the private Wishlist, call this once.
-- It converts the copied wishlist_items.rating values into the owner's
-- independent Shared Wishlist votes. No source/private item id is retained.
create or replace function public.seed_shared_wishlist_owner_ratings(
  p_space_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  affected integer := 0;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.wishlist_spaces ws
    where ws.id = p_space_id
      and ws.owner_id = uid
  ) then
    raise exception 'Shared Wishlist owner access required';
  end if;

  insert into public.wishlist_item_ratings(
    wishlist_item_id,
    user_id,
    rating,
    created_at,
    updated_at
  )
  select
    wi.id,
    uid,
    wi.rating,
    clock_timestamp(),
    clock_timestamp()
  from public.wishlist_items wi
  where wi.space_id = p_space_id
    and wi.user_id = uid
    and wi.rating between 1 and 5
  on conflict (wishlist_item_id, user_id)
  do update set
    rating = excluded.rating,
    updated_at = clock_timestamp();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Shared Wishlist -> Trip keeps a live source link.
-- Private Wishlist -> Trip deliberately leaves source_wishlist_item_id NULL,
-- stores a private_snapshot marker, and snapshots the private rating into
-- place_preferences for the acting user.
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
  next_rating_source text;
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

  next_rating_source := case
    when item_row.space_id is not null then 'shared_linked'
    else 'private_snapshot'
  end;

  if item_row.space_id is not null then
    -- Correct one-way permission inheritance for this operation.
    perform public.copy_wishlist_space_members_to_trip(
      item_row.space_id,
      p_trip_id
    );
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
      -- A Shared Wishlist link wins over an unlinked/local source.
      update public.trip_places
      set source_wishlist_item_id = coalesce(source_wishlist_item_id, source_item_id),
          rating_source = case
            when source_wishlist_item_id is null then 'shared_linked'
            else rating_source
          end,
          updated_by = uid,
          updated_at = clock_timestamp()
      where id = existing_id;
    elsif not exists (
      select 1 from public.trip_places tp
      where tp.id = existing_id
        and tp.source_wishlist_item_id is not null
    ) then
      update public.trip_places
      set rating_source = 'private_snapshot',
          updated_by = uid,
          updated_at = clock_timestamp()
      where id = existing_id;

      insert into public.place_preferences(
        trip_place_id,
        user_id,
        rating,
        preference,
        updated_at
      )
      values(
        existing_id,
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
      on conflict(trip_place_id, user_id) do update
      set rating = excluded.rating,
          preference = excluded.preference,
          updated_at = excluded.updated_at;
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
    rating_source,
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
    next_rating_source,
    uid,
    uid
  )
  returning id into new_id;

  -- Private ratings are snapshotted into Trip-local preference storage.
  -- Shared-linked ratings stay only in wishlist_item_ratings.
  if item_row.space_id is null then
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
    on conflict(trip_place_id, user_id) do update
    set rating = excluded.rating,
        preference = excluded.preference,
        updated_at = excluded.updated_at;
  end if;

  return new_id;
end;
$$;

-- Read the current user's rating source and rating for every Trip place.
create or replace function public.list_trip_rating_context(
  p_trip_id uuid
)
returns table(
  trip_place_id uuid,
  rating_source text,
  source_wishlist_item_id uuid,
  source_wishlist_name text,
  your_rating smallint,
  can_rate boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tp.id as trip_place_id,
    tp.rating_source,
    tp.source_wishlist_item_id,
    ws.name as source_wishlist_name,
    case
      when tp.rating_source = 'shared_linked'
        then wir.rating
      else pp.rating
    end as your_rating,
    case
      when tp.rating_source = 'shared_linked'
        then coalesce(public.can_edit_wishlist_space(wi.space_id), false)
      else public.can_edit_trip(tp.trip_id)
    end as can_rate
  from public.trip_places tp
  left join public.wishlist_items wi
    on wi.id = tp.source_wishlist_item_id
   and tp.rating_source = 'shared_linked'
  left join public.wishlist_spaces ws
    on ws.id = wi.space_id
   and public.is_wishlist_space_member(ws.id)
  left join public.wishlist_item_ratings wir
    on wir.wishlist_item_id = wi.id
   and wir.user_id = auth.uid()
   and public.is_wishlist_space_member(wi.space_id)
  left join public.place_preferences pp
    on pp.trip_place_id = tp.id
   and pp.user_id = auth.uid()
  where tp.trip_id = p_trip_id
    and public.is_trip_member(p_trip_id)
  order by tp.created_at, tp.id;
$$;

-- One Trip UI write API.
-- Shared-linked -> wishlist_item_ratings (live bidirectional source of truth).
-- Private snapshot/manual -> place_preferences (Trip-local only).
create or replace function public.set_trip_place_rating(
  p_trip_place_id uuid,
  p_rating smallint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target_trip uuid;
  target_source text;
  target_wishlist_item uuid;
  target_space uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  select
    tp.trip_id,
    tp.rating_source,
    tp.source_wishlist_item_id
  into
    target_trip,
    target_source,
    target_wishlist_item
  from public.trip_places tp
  where tp.id = p_trip_place_id;

  if target_trip is null then
    raise exception 'Trip place not found';
  end if;

  if not public.can_edit_trip(target_trip) then
    raise exception 'Trip editor access required';
  end if;

  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Rating must be 1-5';
  end if;

  if target_source = 'shared_linked' and target_wishlist_item is not null then
    select wi.space_id
    into target_space
    from public.wishlist_items wi
    where wi.id = target_wishlist_item;

    if target_space is null or not public.can_edit_wishlist_space(target_space) then
      raise exception 'Shared Wishlist editor access required';
    end if;

    if p_rating is null then
      delete from public.wishlist_item_ratings
      where wishlist_item_id = target_wishlist_item
        and user_id = uid;
    else
      insert into public.wishlist_item_ratings(
        wishlist_item_id,
        user_id,
        rating,
        updated_at
      )
      values(
        target_wishlist_item,
        uid,
        p_rating,
        clock_timestamp()
      )
      on conflict (wishlist_item_id, user_id)
      do update set
        rating = excluded.rating,
        updated_at = excluded.updated_at;
    end if;
  else
    if p_rating is null then
      delete from public.place_preferences
      where trip_place_id = p_trip_place_id
        and user_id = uid;
    else
      insert into public.place_preferences(
        trip_place_id,
        user_id,
        rating,
        preference,
        updated_at
      )
      values(
        p_trip_place_id,
        uid,
        p_rating,
        case
          when p_rating = 5 then 'must_go'::public.place_preference
          when p_rating >= 4 then 'interested'::public.place_preference
          when p_rating <= 1 then 'skip'::public.place_preference
          else 'neutral'::public.place_preference
        end,
        clock_timestamp()
      )
      on conflict(trip_place_id, user_id) do update
      set rating = excluded.rating,
          preference = excluded.preference,
          updated_at = excluded.updated_at;
    end if;
  end if;

  update public.trips
  set updated_at = clock_timestamp()
  where id = target_trip;
end;
$$;

revoke all on function public.seed_shared_wishlist_owner_ratings(uuid) from public;
revoke all on function public.add_wishlist_item_to_trip_v2(uuid,uuid) from public;
revoke all on function public.list_trip_rating_context(uuid) from public;
revoke all on function public.set_trip_place_rating(uuid,smallint) from public;

grant execute on function public.seed_shared_wishlist_owner_ratings(uuid) to authenticated;
grant execute on function public.add_wishlist_item_to_trip_v2(uuid,uuid) to authenticated;
grant execute on function public.list_trip_rating_context(uuid) to authenticated;
grant execute on function public.set_trip_place_rating(uuid,smallint) to authenticated;

commit;

-- Verification
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trip_places'
  and column_name = 'rating_source';

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'seed_shared_wishlist_owner_ratings',
    'add_wishlist_item_to_trip_v2',
    'list_trip_rating_context',
    'set_trip_place_rating'
  )
order by routine_name;
