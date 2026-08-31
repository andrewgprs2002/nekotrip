-- NekoTrip v0.6.0
-- Per-day route-planning preferences + safe application of suggested waypoint order.

begin;

alter table public.trip_days
  add column if not exists route_start_trip_place_id uuid references public.trip_places(id) on delete set null,
  add column if not exists route_end_trip_place_id uuid references public.trip_places(id) on delete set null,
  add column if not exists route_departure_time time,
  add column if not exists route_arrival_time time,
  add column if not exists route_time_anchor text not null default 'departure'
    check (route_time_anchor in ('departure','arrival')),
  add column if not exists avoid_tolls boolean not null default false,
  add column if not exists avoid_highways boolean not null default false;

create or replace function public.update_trip_day_route_settings(
  p_day_id uuid,
  p_start_trip_place_id uuid default null,
  p_end_trip_place_id uuid default null,
  p_departure_time time default null,
  p_arrival_time time default null,
  p_time_anchor text default 'departure',
  p_avoid_tolls boolean default false,
  p_avoid_highways boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  tid uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select d.trip_id into tid
  from public.trip_days d
  where d.id = p_day_id;

  if tid is null then raise exception 'Trip day not found'; end if;
  if not public.can_edit_trip(tid) then raise exception 'Editor access required'; end if;
  if p_time_anchor not in ('departure','arrival') then raise exception 'Invalid time anchor'; end if;

  if p_start_trip_place_id is not null and not exists (
    select 1 from public.trip_places tp
    where tp.id = p_start_trip_place_id and tp.trip_id = tid
  ) then
    raise exception 'Start point must belong to this trip';
  end if;

  if p_end_trip_place_id is not null and not exists (
    select 1 from public.trip_places tp
    where tp.id = p_end_trip_place_id and tp.trip_id = tid
  ) then
    raise exception 'End point must belong to this trip';
  end if;

  update public.trip_days d
  set route_start_trip_place_id = p_start_trip_place_id,
      route_end_trip_place_id = p_end_trip_place_id,
      route_departure_time = p_departure_time,
      route_arrival_time = p_arrival_time,
      route_time_anchor = p_time_anchor,
      avoid_tolls = coalesce(p_avoid_tolls, false),
      avoid_highways = coalesce(p_avoid_highways, false)
  where d.id = p_day_id;

  update public.trips
  set updated_at = clock_timestamp()
  where id = tid;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
    tid, uid, 'trip_day', p_day_id, 'route_settings_updated',
    jsonb_build_object(
      'start_trip_place_id', p_start_trip_place_id,
      'end_trip_place_id', p_end_trip_place_id,
      'departure_time', p_departure_time,
      'arrival_time', p_arrival_time,
      'time_anchor', p_time_anchor,
      'avoid_tolls', coalesce(p_avoid_tolls, false),
      'avoid_highways', coalesce(p_avoid_highways, false)
    )
  );
end;
$$;

create or replace function public.apply_day_place_order(
  p_day_id uuid,
  p_trip_place_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  tid uuid;
  expected_count integer;
  supplied_count integer;
  i integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select d.trip_id into tid
  from public.trip_days d
  where d.id = p_day_id;

  if tid is null then raise exception 'Trip day not found'; end if;
  if not public.can_edit_trip(tid) then raise exception 'Editor access required'; end if;

  select count(*)::integer into expected_count
  from public.trip_places tp
  where tp.trip_id = tid and tp.day_id = p_day_id;

  supplied_count := coalesce(array_length(p_trip_place_ids, 1), 0);
  if supplied_count <> expected_count then
    raise exception 'Suggested order must include every place assigned to this day exactly once';
  end if;

  if supplied_count <> (
    select count(distinct x)::integer from unnest(coalesce(p_trip_place_ids, '{}'::uuid[])) x
  ) then
    raise exception 'Suggested order contains duplicate places';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_trip_place_ids, '{}'::uuid[])) x
    where not exists (
      select 1 from public.trip_places tp
      where tp.id = x and tp.trip_id = tid and tp.day_id = p_day_id
    )
  ) then
    raise exception 'Suggested order contains a place outside this day';
  end if;

  for i in 1..supplied_count loop
    update public.trip_places tp
    set order_index = i,
        updated_by = uid,
        updated_at = clock_timestamp()
    where tp.id = p_trip_place_ids[i];
  end loop;

  update public.trips
  set updated_at = clock_timestamp()
  where id = tid;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
    tid, uid, 'trip_day', p_day_id, 'route_order_optimized',
    jsonb_build_object('trip_place_ids', to_jsonb(p_trip_place_ids))
  );
end;
$$;

revoke all on function public.update_trip_day_route_settings(uuid,uuid,uuid,time,time,text,boolean,boolean) from public;
grant execute on function public.update_trip_day_route_settings(uuid,uuid,uuid,time,time,text,boolean,boolean) to authenticated;
revoke all on function public.apply_day_place_order(uuid,uuid[]) from public;
grant execute on function public.apply_day_place_order(uuid,uuid[]) to authenticated;

commit;

-- Verification
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'trip_days'
  and column_name in (
    'route_start_trip_place_id','route_end_trip_place_id','route_departure_time','route_arrival_time',
    'route_time_anchor','avoid_tolls','avoid_highways'
  )
order by column_name;
