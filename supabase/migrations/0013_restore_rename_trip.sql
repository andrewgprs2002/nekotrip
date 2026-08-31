-- NekoTrip v0.5.2.1
-- Compatibility migration: restore the rename_trip RPC without touching
-- newer wishlist-safe delete_trip/delete_trip_place implementations.

begin;

create or replace function public.rename_trip(
  p_trip_id uuid,
  p_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  clean_name text := trim(coalesce(p_name, ''));
  old_name text;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Editor access required';
  end if;

  if char_length(clean_name) < 1 or char_length(clean_name) > 120 then
    raise exception 'Trip name must be 1-120 characters';
  end if;

  select t.name
  into old_name
  from public.trips t
  where t.id = p_trip_id
  for update;

  if old_name is null then
    raise exception 'Trip not found';
  end if;

  update public.trips
  set name = clean_name,
      updated_at = clock_timestamp()
  where id = p_trip_id;

  insert into public.activity_log (
    trip_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    payload
  )
  values (
    p_trip_id,
    uid,
    'trip',
    p_trip_id,
    'renamed',
    jsonb_build_object(
      'old_name', old_name,
      'new_name', clean_name
    )
  );

  return clean_name;
end;
$$;

revoke all on function public.rename_trip(uuid,text) from public;
grant execute on function public.rename_trip(uuid,text) to authenticated;

commit;

-- Verification
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rename_trip';
