-- NekoTrip v0.8.11 — Trip date management
--
-- Changes:
-- 1) New Trips without a complete date range start with exactly ONE itinerary day.
-- 2) Trip day count follows the inclusive Start/End date range.
-- 3) When a Trip becomes shorter, places assigned to removed days move to Unplanned.
-- 4) Function signatures remain compatible with existing callers.

begin;

create or replace function public.update_trip_dates(
  p_trip_id uuid,
  p_start_date date,
  p_end_date date
)
returns table(start_date date, end_date date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  old_start date;
  old_end date;
  desired_days integer;
  current_days integer;
  i integer;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Editor access required';
  end if;

  if p_start_date is not null
     and p_end_date is not null
     and p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  select t.start_date, t.end_date
  into old_start, old_end
  from public.trips t
  where t.id = p_trip_id
  for update;

  if not found then
    raise exception 'Trip not found';
  end if;

  select count(*)::integer
  into current_days
  from public.trip_days d
  where d.trip_id = p_trip_id;

  -- A complete range controls the itinerary length.
  -- If either boundary is missing, keep the current day count,
  -- but guarantee at least one day exists.
  if p_start_date is not null and p_end_date is not null then
    desired_days := (p_end_date - p_start_date) + 1;
  else
    desired_days := greatest(current_days, 1);
  end if;

  if desired_days < 1 then
    raise exception 'Trip must contain at least one day';
  end if;

  if desired_days > 90 then
    raise exception 'Trips longer than 90 days are not supported yet';
  end if;

  -- Shortening the Trip never deletes itinerary places.
  -- Anything assigned to a day that will disappear goes back to Unplanned.
  if desired_days < current_days then
    update public.trip_places tp
    set day_id = null,
        updated_by = uid,
        updated_at = clock_timestamp()
    where tp.trip_id = p_trip_id
      and tp.day_id in (
        select d.id
        from public.trip_days d
        where d.trip_id = p_trip_id
          and d.order_index > desired_days
      );

    delete from public.trip_days d
    where d.trip_id = p_trip_id
      and d.order_index > desired_days;
  end if;

  -- Grow the itinerary when the date range grows.
  if desired_days > current_days then
    for i in (current_days + 1)..desired_days loop
      insert into public.trip_days(
        trip_id,
        title,
        order_index,
        date
      )
      values(
        p_trip_id,
        'Day ' || i,
        i,
        case
          when p_start_date is null then null
          else p_start_date + (i - 1)
        end
      )
      on conflict (trip_id, order_index) do update
      set title = excluded.title,
          date = excluded.date;
    end loop;
  end if;

  update public.trips t
  set start_date = p_start_date,
      end_date = p_end_date,
      updated_at = clock_timestamp()
  where t.id = p_trip_id;

  -- Normalize visible day labels and calendar dates.
  update public.trip_days d
  set title = 'Day ' || d.order_index,
      date = case
        when p_start_date is null then null
        else p_start_date + (d.order_index - 1)
      end
  where d.trip_id = p_trip_id;

  insert into public.activity_log(
    trip_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    payload
  )
  values(
    p_trip_id,
    uid,
    'trip',
    p_trip_id,
    'dates_updated',
    jsonb_build_object(
      'old_start_date', old_start,
      'new_start_date', p_start_date,
      'old_end_date', old_end,
      'new_end_date', p_end_date,
      'day_count', desired_days
    )
  );

  return query select p_start_date, p_end_date;
end;
$$;

create or replace function public.create_trip(
  p_name text,
  p_timezone text default 'UTC',
  p_start_date date default null,
  p_end_date date default null,
  p_default_days integer default 1
)
returns table(trip_id uuid, trip_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  base_slug text;
  new_trip_id uuid;
  new_slug text;
  i integer;
  day_count integer;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Trip name is required';
  end if;

  if p_end_date is not null
     and p_start_date is not null
     and p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  -- Complete date range determines the number of days.
  -- Otherwise every new Trip begins with exactly one day.
  if p_start_date is not null and p_end_date is not null then
    day_count := (p_end_date - p_start_date) + 1;
  else
    day_count := 1;
  end if;

  if day_count > 90 then
    raise exception 'Trips longer than 90 days are not supported yet';
  end if;

  base_slug := trim(
    both '-'
    from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g')
  );

  if base_slug = '' then
    base_slug := 'trip';
  end if;

  new_slug := base_slug || '-' ||
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.trips(
    slug,
    name,
    timezone,
    start_date,
    end_date,
    created_by
  )
  values(
    new_slug,
    trim(p_name),
    coalesce(nullif(trim(p_timezone), ''), 'UTC'),
    p_start_date,
    p_end_date,
    uid
  )
  returning id into new_trip_id;

  insert into public.trip_members(trip_id, user_id, role)
  values(new_trip_id, uid, 'owner');

  for i in 1..day_count loop
    insert into public.trip_days(
      trip_id,
      title,
      order_index,
      date
    )
    values(
      new_trip_id,
      'Day ' || i,
      i,
      case
        when p_start_date is null then null
        else p_start_date + (i - 1)
      end
    );
  end loop;

  insert into public.activity_log(
    trip_id,
    actor_id,
    entity_type,
    entity_id,
    action
  )
  values(new_trip_id, uid, 'trip', new_trip_id, 'created');

  return query select new_trip_id, new_slug;
end;
$$;

-- Shared Wishlist -> new Trip keeps the existing signature but now defaults to 1.
-- The underlying create_trip() also guarantees one day when dates are incomplete.
create or replace function public.create_trip_from_wishlist_v2(
  p_item_ids uuid[],
  p_name text,
  p_timezone text default 'Asia/Tokyo',
  p_start_date date default null,
  p_end_date date default null,
  p_default_days integer default 1
)
returns table(
  trip_id uuid,
  trip_slug text,
  added_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_trip_id uuid;
  created_trip_slug text;
  item_id uuid;
  processed integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_item_ids is null or coalesce(array_length(p_item_ids, 1), 0) = 0 then
    raise exception 'Select at least one wishlist item';
  end if;

  select created.trip_id, created.trip_slug
  into created_trip_id, created_trip_slug
  from public.create_trip(
    p_name,
    coalesce(nullif(trim(p_timezone), ''), 'Asia/Tokyo'),
    p_start_date,
    p_end_date,
    1
  ) as created;

  foreach item_id in array p_item_ids loop
    if public.can_access_wishlist_item(item_id, false) then
      perform public.add_wishlist_item_to_trip_v2(item_id, created_trip_id);
      processed := processed + 1;
    end if;
  end loop;

  if processed = 0 then
    raise exception 'No selected wishlist items were found';
  end if;

  return query
  select created_trip_id, created_trip_slug, processed;
end;
$$;

revoke all on function public.update_trip_dates(uuid,date,date) from public;
revoke all on function public.create_trip(text,text,date,date,integer) from public;
revoke all on function public.create_trip_from_wishlist_v2(uuid[],text,text,date,date,integer) from public;

grant execute on function public.update_trip_dates(uuid,date,date) to authenticated;
grant execute on function public.create_trip(text,text,date,date,integer) to authenticated;
grant execute on function public.create_trip_from_wishlist_v2(uuid[],text,text,date,date,integer) to authenticated;

commit;

-- Verification
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'update_trip_dates',
    'create_trip',
    'create_trip_from_wishlist_v2'
  )
order by routine_name;
