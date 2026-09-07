-- NekoTrip v0.8.14 — Performance + Shared Wishlist lifecycle

begin;

alter table public.trip_places
  drop constraint if exists trip_places_rating_source_check;

alter table public.trip_places
  add constraint trip_places_rating_source_check
  check (rating_source in (
    'shared_linked',
    'private_snapshot',
    'manual',
    'detached_snapshot'
  ));

create or replace function public.delete_shared_wishlist(
  p_space_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.wishlist_spaces ws
    where ws.id = p_space_id
      and ws.owner_id = uid
  ) then
    raise exception 'Shared Wishlist owner access required';
  end if;

  insert into public.place_preferences(
    trip_place_id,
    user_id,
    rating,
    preference,
    updated_at
  )
  select
    tp.id,
    wir.user_id,
    wir.rating,
    case
      when wir.rating = 5 then 'must_go'::public.place_preference
      when wir.rating >= 4 then 'interested'::public.place_preference
      when wir.rating <= 1 then 'skip'::public.place_preference
      else 'neutral'::public.place_preference
    end,
    clock_timestamp()
  from public.trip_places tp
  join public.wishlist_items wi
    on wi.id = tp.source_wishlist_item_id
   and wi.space_id = p_space_id
  join public.wishlist_item_ratings wir
    on wir.wishlist_item_id = wi.id
  join public.trip_members tm
    on tm.trip_id = tp.trip_id
   and tm.user_id = wir.user_id
  on conflict (trip_place_id, user_id)
  do update set
    rating = excluded.rating,
    preference = excluded.preference,
    updated_at = excluded.updated_at;

  update public.trip_places tp
  set source_wishlist_item_id = null,
      rating_source = 'detached_snapshot',
      updated_by = uid,
      updated_at = clock_timestamp()
  where tp.source_wishlist_item_id in (
    select wi.id
    from public.wishlist_items wi
    where wi.space_id = p_space_id
  );

  delete from public.wishlist_spaces
  where id = p_space_id
    and owner_id = uid;
end;
$$;

revoke all on function public.delete_shared_wishlist(uuid) from public;
grant execute on function public.delete_shared_wishlist(uuid) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'delete_shared_wishlist';

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.trip_places'::regclass
  and conname = 'trip_places_rating_source_check';
