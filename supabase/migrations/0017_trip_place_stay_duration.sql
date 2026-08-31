-- NekoTrip v0.7.1 — per-stop stay duration
-- Uses the existing trip_places.planned_duration_minutes column.

begin;

create or replace function public.update_trip_place_duration(
  p_trip_place_id uuid,
  p_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target public.trip_places%rowtype;
  clean_minutes integer := greatest(0, least(coalesce(p_minutes, 0), 1440));
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select * into target
  from public.trip_places tp
  where tp.id = p_trip_place_id
  for update;

  if target.id is null then raise exception 'Trip place not found'; end if;
  if not public.can_edit_trip(target.trip_id) then raise exception 'Editor access required'; end if;

  update public.trip_places tp
  set planned_duration_minutes = clean_minutes,
      updated_by = uid,
      updated_at = clock_timestamp()
  where tp.id = p_trip_place_id;

  update public.trips t
  set updated_at = clock_timestamp()
  where t.id = target.trip_id;
end;
$$;

revoke all on function public.update_trip_place_duration(uuid,integer) from public;
grant execute on function public.update_trip_place_duration(uuid,integer) to authenticated;

commit;

select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'update_trip_place_duration';
