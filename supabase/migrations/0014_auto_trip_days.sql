-- NekoTrip v0.5.4
-- Keep trip_days automatically synchronized with the inclusive trip date range.
-- Example: 2026-11-28 -> 2026-12-06 = 9 itinerary days.
-- When a trip is shortened, places assigned to removed days are moved to Unplanned.

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
  uid uuid := (select auth.uid());
  old_start date;
  old_end date;
  desired_days integer;
  current_days integer;
  i integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception 'Editor access required'; end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  select t.start_date, t.end_date
  into old_start, old_end
  from public.trips t
  where t.id = p_trip_id
  for update;

  if not found then raise exception 'Trip not found'; end if;

  update public.trips t
  set start_date = p_start_date,
      end_date = p_end_date,
      updated_at = clock_timestamp()
  where t.id = p_trip_id;

  select count(*)::integer
  into current_days
  from public.trip_days d
  where d.trip_id = p_trip_id;

  -- Only derive the itinerary length when both boundaries are known.
  -- If one side is blank, preserve the existing number of itinerary days.
  if p_start_date is not null and p_end_date is not null then
    desired_days := (p_end_date - p_start_date) + 1;

    if desired_days < 1 then
      raise exception 'Trip must contain at least one day';
    end if;
    if desired_days > 90 then
      raise exception 'Trips longer than 90 days are not supported yet';
    end if;

    -- If the trip is shorter now, do not delete its places. Move them back to Unplanned first.
    if desired_days < current_days then
      update public.trip_places tp
      set day_id = null
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

    -- Grow the itinerary when the date range becomes longer.
    if desired_days > current_days then
      for i in (current_days + 1)..desired_days loop
        insert into public.trip_days (trip_id, title, order_index, date)
        values (
          p_trip_id,
          'Day ' || i,
          i,
          p_start_date + (i - 1)
        )
        on conflict (trip_id, order_index) do update
          set title = excluded.title,
              date = excluded.date;
      end loop;
    end if;
  end if;

  -- Normalize the visible day labels and calendar dates.
  -- Existing itinerary rows use 1-based order_index values.
  update public.trip_days d
  set title = 'Day ' || d.order_index,
      date = case
        when p_start_date is null then null
        else p_start_date + (d.order_index - 1)
      end
  where d.trip_id = p_trip_id;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
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
      'day_count', case
        when p_start_date is not null and p_end_date is not null then (p_end_date - p_start_date) + 1
        else current_days
      end
    )
  );

  return query select p_start_date, p_end_date;
end;
$$;

-- New trips also derive their initial Day count from Start/End dates when both are set.
create or replace function public.create_trip(
  p_name text,
  p_timezone text default 'UTC',
  p_start_date date default null,
  p_end_date date default null,
  p_default_days integer default 4
)
returns table(trip_id uuid, trip_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  base_slug text;
  new_trip_id uuid;
  new_slug text;
  i integer;
  day_count integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_name is null or char_length(trim(p_name)) = 0 then raise exception 'Trip name is required'; end if;
  if p_end_date is not null and p_start_date is not null and p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if p_start_date is not null and p_end_date is not null then
    day_count := (p_end_date - p_start_date) + 1;
  else
    day_count := least(greatest(coalesce(p_default_days, 4), 1), 90);
  end if;

  if day_count > 90 then raise exception 'Trips longer than 90 days are not supported yet'; end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'trip'; end if;
  new_slug := base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.trips (slug, name, timezone, start_date, end_date, created_by)
  values (new_slug, trim(p_name), coalesce(nullif(trim(p_timezone), ''), 'UTC'), p_start_date, p_end_date, uid)
  returning id into new_trip_id;

  insert into public.trip_members (trip_id, user_id, role)
  values (new_trip_id, uid, 'owner');

  for i in 1..day_count loop
    insert into public.trip_days (trip_id, title, order_index, date)
    values (
      new_trip_id,
      'Day ' || i,
      i,
      case when p_start_date is null then null else p_start_date + (i - 1) end
    );
  end loop;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action)
  values (new_trip_id, uid, 'trip', new_trip_id, 'created');

  return query select new_trip_id, new_slug;
end;
$$;

revoke all on function public.update_trip_dates(uuid,date,date) from public;
grant execute on function public.update_trip_dates(uuid,date,date) to authenticated;
revoke all on function public.create_trip(text,text,date,date,integer) from public;
grant execute on function public.create_trip(text,text,date,date,integer) to authenticated;

commit;

-- Verification
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('update_trip_dates','create_trip')
order by routine_name;
