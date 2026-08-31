-- NekoTrip v0.5.1
-- Wishlist multi-select: batch-add selected wishes to an existing Trip,
-- or create a brand-new Trip directly from the selection.
-- Safe to run on an existing v0.5.0 database.

begin;

create or replace function public.add_wishlist_items_to_trip(
  p_item_ids uuid[],
  p_trip_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  item_id uuid;
  processed integer := 0;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_item_ids is null or coalesce(array_length(p_item_ids, 1), 0) = 0 then
    raise exception 'Select at least one wishlist item';
  end if;
  if coalesce(array_length(p_item_ids, 1), 0) > 200 then
    raise exception 'A maximum of 200 wishlist items can be added at once';
  end if;
  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Editor access required for target trip';
  end if;

  foreach item_id in array p_item_ids loop
    if exists (
      select 1 from public.wishlist_items wi
      where wi.id = item_id and wi.user_id = uid
    ) then
      perform public.add_wishlist_item_to_trip(item_id, p_trip_id);
      processed := processed + 1;
    end if;
  end loop;

  if processed = 0 then raise exception 'No selected wishlist items were found'; end if;
  return processed;
end;
$$;

create or replace function public.create_trip_from_wishlist(
  p_item_ids uuid[],
  p_name text,
  p_timezone text default 'Asia/Tokyo',
  p_start_date date default null,
  p_end_date date default null,
  p_default_days integer default 4
)
returns table(trip_id uuid, trip_slug text, added_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  created_trip_id uuid;
  created_trip_slug text;
  item_id uuid;
  processed integer := 0;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_item_ids is null or coalesce(array_length(p_item_ids, 1), 0) = 0 then
    raise exception 'Select at least one wishlist item';
  end if;
  if coalesce(array_length(p_item_ids, 1), 0) > 200 then
    raise exception 'A maximum of 200 wishlist items can be used at once';
  end if;

  select created.trip_id, created.trip_slug
  into created_trip_id, created_trip_slug
  from public.create_trip(
    p_name,
    coalesce(nullif(trim(p_timezone), ''), 'Asia/Tokyo'),
    p_start_date,
    p_end_date,
    p_default_days
  ) as created;

  foreach item_id in array p_item_ids loop
    if exists (
      select 1 from public.wishlist_items wi
      where wi.id = item_id and wi.user_id = uid
    ) then
      perform public.add_wishlist_item_to_trip(item_id, created_trip_id);
      processed := processed + 1;
    end if;
  end loop;

  if processed = 0 then
    raise exception 'No selected wishlist items were found';
  end if;

  return query select created_trip_id, created_trip_slug, processed;
end;
$$;

revoke all on function public.add_wishlist_items_to_trip(uuid[],uuid) from public;
revoke all on function public.create_trip_from_wishlist(uuid[],text,text,date,date,integer) from public;

grant execute on function public.add_wishlist_items_to_trip(uuid[],uuid) to authenticated;
grant execute on function public.create_trip_from_wishlist(uuid[],text,text,date,date,integer) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('add_wishlist_items_to_trip','create_trip_from_wishlist')
order by routine_name;
