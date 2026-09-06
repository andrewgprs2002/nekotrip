-- NekoTrip v0.8.9 — Trip member management

begin;

create or replace function public.list_trip_members(
  p_trip_id uuid
)
returns table(
  user_id uuid,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.trip_members tm
    where tm.trip_id = p_trip_id
      and tm.user_id = auth.uid()
  ) then
    raise exception 'Trip membership required';
  end if;

  return query
  select
    tm.user_id,
    coalesce(u.email::text, 'Unknown member') as email,
    tm.role::text,
    tm.joined_at
  from public.trip_members tm
  left join auth.users u on u.id = tm.user_id
  where tm.trip_id = p_trip_id
  order by
    case tm.role::text
      when 'owner' then 0
      when 'editor' then 1
      else 2
    end,
    lower(coalesce(u.email::text, ''));
end;
$$;

create or replace function public.remove_trip_member(
  p_trip_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.trip_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_trip_owner(p_trip_id) then
    raise exception 'Owner access required';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Trip owner cannot remove themselves';
  end if;

  select tm.role
  into target_role
  from public.trip_members tm
  where tm.trip_id = p_trip_id
    and tm.user_id = p_user_id;

  if target_role is null then
    raise exception 'Trip member not found';
  end if;

  if target_role = 'owner'::public.trip_role then
    raise exception 'Trip owner cannot be removed';
  end if;

  delete from public.trip_members
  where trip_id = p_trip_id
    and user_id = p_user_id;

  update public.trips
  set updated_at = clock_timestamp()
  where id = p_trip_id;

  insert into public.activity_log(
    trip_id,
    actor_id,
    entity_type,
    entity_id,
    action
  )
  values(
    p_trip_id,
    auth.uid(),
    'member',
    p_user_id,
    'removed'
  );
end;
$$;

revoke all on function public.list_trip_members(uuid) from public;
revoke all on function public.remove_trip_member(uuid,uuid) from public;

grant execute on function public.list_trip_members(uuid) to authenticated;
grant execute on function public.remove_trip_member(uuid,uuid) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('list_trip_members', 'remove_trip_member')
order by routine_name;
