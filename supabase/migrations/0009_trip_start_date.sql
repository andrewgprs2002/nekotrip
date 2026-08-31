-- NekoTrip v0.4.1
-- Editable trip departure date.
-- Safe to run on an existing v0.4.0 database after 0008.

begin;

create or replace function public.update_trip_start_date(
  p_trip_id uuid,
  p_start_date date
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  old_start date;
  old_end date;
  next_end date;
  day_count integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception 'Editor access required'; end if;

  select t.start_date, t.end_date
  into old_start, old_end
  from public.trips t
  where t.id = p_trip_id
  for update;

  if not found then raise exception 'Trip not found'; end if;

  select count(*)::integer
  into day_count
  from public.trip_days d
  where d.trip_id = p_trip_id;

  -- If the trip already had both dates, preserve the original trip duration
  -- when its departure date moves. If only an end date existed and the new
  -- start would pass it, extend the end to cover the current itinerary days.
  next_end := old_end;
  if p_start_date is not null and old_end is not null then
    if old_start is not null then
      next_end := p_start_date + (old_end - old_start);
    elsif p_start_date > old_end then
      next_end := p_start_date + greatest(day_count - 1, 0);
    end if;
  end if;

  update public.trips t
  set start_date = p_start_date,
      end_date = next_end,
      updated_at = clock_timestamp()
  where t.id = p_trip_id;

  -- Day dates follow itinerary order rather than assuming order_index is
  -- gapless. This remains correct if day reordering is added later.
  with ordered_days as (
    select
      d.id,
      row_number() over (order by d.order_index, d.id) - 1 as day_offset
    from public.trip_days d
    where d.trip_id = p_trip_id
  )
  update public.trip_days d
  set date = case
        when p_start_date is null then null
        else p_start_date + ordered_days.day_offset::integer
      end
  from ordered_days
  where d.id = ordered_days.id;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_trip_id,
    uid,
    'trip',
    p_trip_id,
    'start_date_updated',
    jsonb_build_object(
      'old_start_date', old_start,
      'new_start_date', p_start_date,
      'old_end_date', old_end,
      'new_end_date', next_end
    )
  );

  return p_start_date;
end;
$$;

revoke all on function public.update_trip_start_date(uuid,date) from public;
grant execute on function public.update_trip_start_date(uuid,date) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'update_trip_start_date';
