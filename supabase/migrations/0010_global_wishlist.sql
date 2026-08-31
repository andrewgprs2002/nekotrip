-- NekoTrip v0.5.0
-- Global per-user wishlist with nested folders, map-ready places, and add-to-trip workflow.
-- Safe to run on an existing v0.4.2 database.

begin;

create table if not exists public.wishlist_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.wishlist_folders(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  order_index integer not null default 0 check (order_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, user_id)
);

create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references public.places(id),
  folder_id uuid references public.wishlist_folders(id) on delete set null,
  category text not null default 'Sightseeing' check (char_length(trim(category)) between 1 and 40),
  rating smallint not null default 3 check (rating between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, place_id)
);

create index if not exists wishlist_folders_user_parent_idx
  on public.wishlist_folders(user_id, parent_id, order_index, name);
create index if not exists wishlist_items_user_folder_idx
  on public.wishlist_items(user_id, folder_id, created_at desc);
create index if not exists wishlist_items_place_idx
  on public.wishlist_items(place_id);

alter table public.wishlist_folders enable row level security;
alter table public.wishlist_items enable row level security;

revoke all on table public.wishlist_folders, public.wishlist_items from anon, authenticated;
grant select on table public.wishlist_folders, public.wishlist_items to authenticated;

create policy wishlist_folders_select on public.wishlist_folders
for select to authenticated
using (user_id = (select auth.uid()));

create policy wishlist_items_select on public.wishlist_items
for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.create_wishlist_folder(
  p_name text,
  p_parent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  clean_name text := trim(coalesce(p_name, ''));
  next_order integer;
  new_id uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 80 then
    raise exception 'Folder name must be 1-80 characters';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.wishlist_folders f where f.id = p_parent_id and f.user_id = uid
  ) then
    raise exception 'Parent folder not found';
  end if;

  select coalesce(max(f.order_index), -1) + 1 into next_order
  from public.wishlist_folders f
  where f.user_id = uid and f.parent_id is not distinct from p_parent_id;

  insert into public.wishlist_folders(user_id, parent_id, name, order_index)
  values (uid, p_parent_id, clean_name, next_order)
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.rename_wishlist_folder(
  p_folder_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  clean_name text := trim(coalesce(p_name, ''));
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 80 then
    raise exception 'Folder name must be 1-80 characters';
  end if;

  update public.wishlist_folders f
  set name = clean_name, updated_at = clock_timestamp()
  where f.id = p_folder_id and f.user_id = uid;

  if not found then raise exception 'Folder not found'; end if;
end;
$$;

create or replace function public.delete_wishlist_folder(
  p_folder_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target_parent uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select f.parent_id into target_parent
  from public.wishlist_folders f
  where f.id = p_folder_id and f.user_id = uid
  for update;

  if not found then raise exception 'Folder not found'; end if;

  -- Deleting a folder is non-destructive: its items and child folders move up one level.
  update public.wishlist_items wi
  set folder_id = target_parent, updated_at = clock_timestamp()
  where wi.user_id = uid and wi.folder_id = p_folder_id;

  update public.wishlist_folders f
  set parent_id = target_parent, updated_at = clock_timestamp()
  where f.user_id = uid and f.parent_id = p_folder_id;

  delete from public.wishlist_folders f
  where f.id = p_folder_id and f.user_id = uid;
end;
$$;

create or replace function public.add_wishlist_place(
  p_name text,
  p_provider text default 'manual',
  p_provider_place_id text default null,
  p_formatted_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_folder_id uuid default null,
  p_category text default 'Sightseeing',
  p_rating smallint default 3
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  clean_name text := trim(coalesce(p_name, ''));
  clean_provider text := coalesce(nullif(trim(p_provider), ''), 'manual');
  clean_provider_place_id text := nullif(trim(p_provider_place_id), '');
  clean_category text := trim(coalesce(p_category, 'Sightseeing'));
  target_place_id uuid;
  existing_item_id uuid;
  new_item_id uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 200 then raise exception 'Place name is required'; end if;
  if char_length(clean_category) < 1 or char_length(clean_category) > 40 then raise exception 'Category must be 1-40 characters'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1-5'; end if;
  if p_folder_id is not null and not exists (
    select 1 from public.wishlist_folders f where f.id = p_folder_id and f.user_id = uid
  ) then
    raise exception 'Wishlist folder not found';
  end if;

  if clean_provider_place_id is not null then
    select p.id into target_place_id
    from public.places p
    where p.created_by = uid
      and p.provider = clean_provider
      and p.provider_place_id = clean_provider_place_id
    order by p.created_at
    limit 1;
  end if;

  if target_place_id is null then
    insert into public.places(
      provider, provider_place_id, name, formatted_address, latitude, longitude, created_by
    ) values (
      clean_provider,
      clean_provider_place_id,
      clean_name,
      nullif(trim(p_formatted_address), ''),
      p_latitude,
      p_longitude,
      uid
    ) returning id into target_place_id;
  end if;

  select wi.id into existing_item_id
  from public.wishlist_items wi
  where wi.user_id = uid and wi.place_id = target_place_id
  for update;

  if existing_item_id is not null then
    update public.wishlist_items wi
    set folder_id = p_folder_id,
        category = clean_category,
        rating = p_rating,
        updated_at = clock_timestamp()
    where wi.id = existing_item_id;
    return existing_item_id;
  end if;

  insert into public.wishlist_items(user_id, place_id, folder_id, category, rating)
  values (uid, target_place_id, p_folder_id, clean_category, p_rating)
  returning id into new_item_id;

  return new_item_id;
end;
$$;

create or replace function public.update_wishlist_item(
  p_item_id uuid,
  p_folder_id uuid,
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
  clean_category text := trim(coalesce(p_category, ''));
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(clean_category) < 1 or char_length(clean_category) > 40 then raise exception 'Category must be 1-40 characters'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1-5'; end if;
  if p_folder_id is not null and not exists (
    select 1 from public.wishlist_folders f where f.id = p_folder_id and f.user_id = uid
  ) then
    raise exception 'Wishlist folder not found';
  end if;

  update public.wishlist_items wi
  set folder_id = p_folder_id,
      category = clean_category,
      rating = p_rating,
      updated_at = clock_timestamp()
  where wi.id = p_item_id and wi.user_id = uid;

  if not found then raise exception 'Wishlist item not found'; end if;
end;
$$;

create or replace function public.delete_wishlist_item(
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target_place_id uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select wi.place_id into target_place_id
  from public.wishlist_items wi
  where wi.id = p_item_id and wi.user_id = uid
  for update;

  if target_place_id is null then return; end if;

  delete from public.wishlist_items wi
  where wi.id = p_item_id and wi.user_id = uid;

  delete from public.places p
  where p.id = target_place_id
    and p.created_by = uid
    and not exists (select 1 from public.trip_places tp where tp.place_id = p.id)
    and not exists (select 1 from public.wishlist_items wi where wi.place_id = p.id);
end;
$$;

create or replace function public.add_wishlist_item_to_trip(
  p_item_id uuid,
  p_trip_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  item_row public.wishlist_items%rowtype;
  existing_trip_place_id uuid;
  next_order integer;
  new_trip_place_id uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception 'Editor access required for target trip'; end if;

  select * into item_row
  from public.wishlist_items wi
  where wi.id = p_item_id and wi.user_id = uid;

  if item_row.id is null then raise exception 'Wishlist item not found'; end if;

  select tp.id into existing_trip_place_id
  from public.trip_places tp
  where tp.trip_id = p_trip_id and tp.place_id = item_row.place_id
  order by tp.created_at
  limit 1;

  if existing_trip_place_id is not null then
    return existing_trip_place_id;
  end if;

  select coalesce(max(tp.order_index), -1) + 1 into next_order
  from public.trip_places tp
  where tp.trip_id = p_trip_id and tp.day_id is null;

  insert into public.trip_places(
    trip_id, place_id, day_id, order_index, category, created_by, updated_by
  ) values (
    p_trip_id, item_row.place_id, null, next_order, item_row.category, uid, uid
  ) returning id into new_trip_place_id;

  insert into public.place_preferences(trip_place_id, user_id, rating, preference, updated_at)
  values (
    new_trip_place_id,
    uid,
    item_row.rating,
    case
      when item_row.rating = 5 then 'must_go'::public.place_preference
      when item_row.rating >= 4 then 'interested'::public.place_preference
      when item_row.rating <= 1 then 'skip'::public.place_preference
      else 'neutral'::public.place_preference
    end,
    clock_timestamp()
  )
  on conflict (trip_place_id, user_id)
  do update set rating = excluded.rating, preference = excluded.preference, updated_at = excluded.updated_at;

  insert into public.activity_log(trip_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_trip_id,
    uid,
    'trip_place',
    new_trip_place_id,
    'added_from_wishlist',
    jsonb_build_object('wishlist_item_id', item_row.id)
  );

  return new_trip_place_id;
end;
$$;

-- Preserve a place row when it is still referenced by the global wishlist.
create or replace function public.delete_trip_place(p_trip_place_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target_trip uuid;
  target_place uuid;
begin
  select tp.trip_id, tp.place_id into target_trip, target_place
  from public.trip_places tp where tp.id = p_trip_place_id;

  if target_trip is null then return; end if;
  if not public.can_edit_trip(target_trip) then raise exception 'Editor access required'; end if;

  delete from public.trip_places where id = p_trip_place_id;
  delete from public.places p where p.id = target_place
    and not exists (select 1 from public.trip_places tp where tp.place_id = p.id)
    and not exists (select 1 from public.wishlist_items wi where wi.place_id = p.id);

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action)
  values (target_trip, uid, 'trip_place', p_trip_place_id, 'deleted');
end;
$$;

-- Same preservation rule when an entire trip is deleted.
create or replace function public.delete_trip(p_trip_id uuid)
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
      and not exists (select 1 from public.trip_places tp where tp.place_id = p.id)
      and not exists (select 1 from public.wishlist_items wi where wi.place_id = p.id);
  end if;
end;
$$;

revoke all on function public.create_wishlist_folder(text,uuid) from public;
revoke all on function public.rename_wishlist_folder(uuid,text) from public;
revoke all on function public.delete_wishlist_folder(uuid) from public;
revoke all on function public.add_wishlist_place(text,text,text,text,double precision,double precision,uuid,text,smallint) from public;
revoke all on function public.update_wishlist_item(uuid,uuid,text,smallint) from public;
revoke all on function public.delete_wishlist_item(uuid) from public;
revoke all on function public.add_wishlist_item_to_trip(uuid,uuid) from public;

grant execute on function public.create_wishlist_folder(text,uuid) to authenticated;
grant execute on function public.rename_wishlist_folder(uuid,text) to authenticated;
grant execute on function public.delete_wishlist_folder(uuid) to authenticated;
grant execute on function public.add_wishlist_place(text,text,text,text,double precision,double precision,uuid,text,smallint) to authenticated;
grant execute on function public.update_wishlist_item(uuid,uuid,text,smallint) to authenticated;
grant execute on function public.delete_wishlist_item(uuid) to authenticated;
grant execute on function public.add_wishlist_item_to_trip(uuid,uuid) to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('wishlist_folders','wishlist_items')
order by table_name;
