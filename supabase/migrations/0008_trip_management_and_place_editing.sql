-- NekoTrip v0.4.0
-- Trip management + itinerary editing.
-- Safe to run on an existing v0.3.8 database.

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
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception 'Editor access required'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 120 then
    raise exception 'Trip name must be 1-120 characters';
  end if;

  select t.name into old_name
  from public.trips t
  where t.id = p_trip_id
  for update;

  if old_name is null then raise exception 'Trip not found'; end if;

  update public.trips
  set name = clean_name,
      updated_at = clock_timestamp()
  where id = p_trip_id;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_trip_id,
    uid,
    'trip',
    p_trip_id,
    'renamed',
    jsonb_build_object('old_name', old_name, 'new_name', clean_name)
  );

  return clean_name;
end;
$$;

create or replace function public.delete_trip(
  p_trip_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  orphan_candidates uuid[];
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.is_trip_owner(p_trip_id) then raise exception 'Owner access required'; end if;

  select array_agg(distinct tp.place_id)
  into orphan_candidates
  from public.trip_places tp
  where tp.trip_id = p_trip_id;

  delete from public.trips t where t.id = p_trip_id;

  if orphan_candidates is not null then
    delete from public.places p
    where p.id = any(orphan_candidates)
      and not exists (
        select 1 from public.trip_places tp where tp.place_id = p.id
      );
  end if;
end;
$$;

create or replace function public.update_trip_place_details(
  p_trip_place_id uuid,
  p_day_id uuid,
  p_category text,
  p_rating smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target public.trip_places%rowtype;
  clean_category text := trim(coalesce(p_category, ''));
  new_order integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select * into target
  from public.trip_places tp
  where tp.id = p_trip_place_id
  for update;

  if target.id is null then raise exception 'Trip place not found'; end if;
  if not public.can_edit_trip(target.trip_id) then raise exception 'Editor access required'; end if;
  if char_length(clean_category) < 1 or char_length(clean_category) > 40 then
    raise exception 'Category must be 1-40 characters';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be 1-5';
  end if;
  if p_day_id is not null and not exists (
    select 1 from public.trip_days d
    where d.id = p_day_id and d.trip_id = target.trip_id
  ) then
    raise exception 'Day does not belong to this trip';
  end if;

  if target.day_id is distinct from p_day_id then
    -- Close the gap in the old day/list.
    update public.trip_places tp
    set order_index = tp.order_index - 1,
        updated_at = clock_timestamp()
    where tp.trip_id = target.trip_id
      and tp.day_id is not distinct from target.day_id
      and tp.id <> target.id
      and tp.order_index > target.order_index;

    -- Moving to a different day always appends to the end of that day/list.
    select coalesce(max(tp.order_index), -1) + 1
    into new_order
    from public.trip_places tp
    where tp.trip_id = target.trip_id
      and tp.day_id is not distinct from p_day_id
      and tp.id <> target.id;
  else
    new_order := target.order_index;
  end if;

  update public.trip_places tp
  set day_id = p_day_id,
      order_index = new_order,
      category = clean_category,
      updated_by = uid,
      updated_at = clock_timestamp()
  where tp.id = target.id;

  insert into public.place_preferences (trip_place_id, user_id, rating, preference, updated_at)
  values (
    target.id,
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
  on conflict (trip_place_id, user_id)
  do update set
    rating = excluded.rating,
    preference = excluded.preference,
    updated_at = excluded.updated_at;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
    target.trip_id,
    uid,
    'trip_place',
    target.id,
    'updated',
    jsonb_build_object(
      'day_id', p_day_id,
      'category', clean_category,
      'rating', p_rating
    )
  );
end;
$$;

create or replace function public.reorder_trip_place(
  p_trip_place_id uuid,
  p_direction text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target public.trip_places%rowtype;
  neighbor public.trip_places%rowtype;
  direction text := lower(trim(coalesce(p_direction, '')));
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if direction not in ('up', 'down') then raise exception 'Direction must be up or down'; end if;

  select * into target
  from public.trip_places tp
  where tp.id = p_trip_place_id
  for update;

  if target.id is null then raise exception 'Trip place not found'; end if;
  if not public.can_edit_trip(target.trip_id) then raise exception 'Editor access required'; end if;

  -- Normalize this day/list first so old duplicate/gapped order indexes cannot
  -- make the arrow controls behave unpredictably.
  with ranked as (
    select
      tp.id,
      row_number() over (order by tp.order_index, tp.created_at, tp.id) - 1 as normalized_order
    from public.trip_places tp
    where tp.trip_id = target.trip_id
      and tp.day_id is not distinct from target.day_id
  )
  update public.trip_places tp
  set order_index = ranked.normalized_order,
      updated_at = case
        when tp.order_index is distinct from ranked.normalized_order then clock_timestamp()
        else tp.updated_at
      end
  from ranked
  where tp.id = ranked.id
    and tp.order_index is distinct from ranked.normalized_order;

  select * into target
  from public.trip_places tp
  where tp.id = p_trip_place_id
  for update;

  if direction = 'up' then
    select * into neighbor
    from public.trip_places tp
    where tp.trip_id = target.trip_id
      and tp.day_id is not distinct from target.day_id
      and tp.order_index = target.order_index - 1
    limit 1
    for update;
  else
    select * into neighbor
    from public.trip_places tp
    where tp.trip_id = target.trip_id
      and tp.day_id is not distinct from target.day_id
      and tp.order_index = target.order_index + 1
    limit 1
    for update;
  end if;

  -- Already at the beginning/end: a no-op is friendlier than an error.
  if neighbor.id is null then return; end if;

  update public.trip_places tp
  set order_index = case
        when tp.id = target.id then neighbor.order_index
        when tp.id = neighbor.id then target.order_index
        else tp.order_index
      end,
      updated_by = uid,
      updated_at = clock_timestamp()
  where tp.id in (target.id, neighbor.id);

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
    target.trip_id,
    uid,
    'trip_place',
    target.id,
    'reordered',
    jsonb_build_object('direction', direction)
  );
end;
$$;

revoke all on function public.rename_trip(uuid,text) from public;
revoke all on function public.delete_trip(uuid) from public;
revoke all on function public.update_trip_place_details(uuid,uuid,text,smallint) from public;
revoke all on function public.reorder_trip_place(uuid,text) from public;

grant execute on function public.rename_trip(uuid,text) to authenticated;
grant execute on function public.delete_trip(uuid) to authenticated;
grant execute on function public.update_trip_place_details(uuid,uuid,text,smallint) to authenticated;
grant execute on function public.reorder_trip_place(uuid,text) to authenticated;

commit;

-- Verification output.
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'rename_trip',
    'delete_trip',
    'update_trip_place_details',
    'reorder_trip_place'
  )
order by routine_name;
