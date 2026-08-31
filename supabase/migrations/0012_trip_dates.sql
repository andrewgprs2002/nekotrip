-- NekoTrip v0.5.2
-- Edit both trip start and end dates while keeping existing trip-day calendar dates aligned.
-- Safe to run after 0008/0009 on the current database.

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

  -- Trip-day dates always follow the selected departure date and itinerary order.
  -- Clearing the departure date makes all day dates date-free again.
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
    'dates_updated',
    jsonb_build_object(
      'old_start_date', old_start,
      'new_start_date', p_start_date,
      'old_end_date', old_end,
      'new_end_date', p_end_date
    )
  );

  return query select p_start_date, p_end_date;
end;
$$;

revoke all on function public.update_trip_dates(uuid,date,date) from public;
grant execute on function public.update_trip_dates(uuid,date,date) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'update_trip_dates';
