-- NekoTrip v0.8.0 — Shared Wishlist complete migration
-- Additive and idempotent. Existing personal Wishlist rows stay private.

begin;

create table if not exists public.wishlist_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wishlist_space_members (
  space_id uuid not null references public.wishlist_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (space_id,user_id)
);

alter table public.wishlist_folders add column if not exists space_id uuid references public.wishlist_spaces(id) on delete cascade;
alter table public.wishlist_items add column if not exists space_id uuid references public.wishlist_spaces(id) on delete cascade;

create index if not exists wishlist_folders_space_idx on public.wishlist_folders(space_id);
create index if not exists wishlist_items_space_idx on public.wishlist_items(space_id);
create index if not exists wishlist_space_members_user_idx on public.wishlist_space_members(user_id,space_id);

-- Existing unique(user_id, place_id) prevents the same place from existing in
-- both a personal and shared Wishlist. Replace it with scope-aware uniqueness.
alter table public.wishlist_items drop constraint if exists wishlist_items_user_id_place_id_key;
create unique index if not exists wishlist_items_personal_place_unique
  on public.wishlist_items(user_id,place_id) where space_id is null;
create unique index if not exists wishlist_items_shared_place_unique
  on public.wishlist_items(space_id,place_id) where space_id is not null;

create or replace function public.is_wishlist_space_member(target_space uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.wishlist_space_members m
    where m.space_id = target_space and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_wishlist_space(target_space uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.wishlist_space_members m
    where m.space_id = target_space and m.user_id = auth.uid()
      and m.role in ('owner','editor')
  );
$$;

create or replace function public.can_access_wishlist_item(target_item uuid, require_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.wishlist_items wi
    where wi.id = target_item
      and (
        (wi.space_id is null and wi.user_id = auth.uid())
        or (
          wi.space_id is not null
          and exists (
            select 1 from public.wishlist_space_members wm
            where wm.space_id = wi.space_id and wm.user_id = auth.uid()
              and (not require_edit or wm.role in ('owner','editor'))
          )
        )
      )
  );
$$;

create or replace function public.can_access_wishlist_folder(target_folder uuid, require_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.wishlist_folders wf
    where wf.id = target_folder
      and (
        (wf.space_id is null and wf.user_id = auth.uid())
        or (
          wf.space_id is not null
          and exists (
            select 1 from public.wishlist_space_members wm
            where wm.space_id = wf.space_id and wm.user_id = auth.uid()
              and (not require_edit or wm.role in ('owner','editor'))
          )
        )
      )
  );
$$;

revoke all on function public.is_wishlist_space_member(uuid) from public;
revoke all on function public.can_edit_wishlist_space(uuid) from public;
revoke all on function public.can_access_wishlist_item(uuid,boolean) from public;
revoke all on function public.can_access_wishlist_folder(uuid,boolean) from public;
grant execute on function public.is_wishlist_space_member(uuid) to authenticated;
grant execute on function public.can_edit_wishlist_space(uuid) to authenticated;
grant execute on function public.can_access_wishlist_item(uuid,boolean) to authenticated;
grant execute on function public.can_access_wishlist_folder(uuid,boolean) to authenticated;

alter table public.wishlist_spaces enable row level security;
alter table public.wishlist_space_members enable row level security;

grant select on public.wishlist_spaces, public.wishlist_space_members to authenticated;

drop policy if exists wishlist_spaces_select on public.wishlist_spaces;
create policy wishlist_spaces_select on public.wishlist_spaces
for select to authenticated using (public.is_wishlist_space_member(id));

drop policy if exists wishlist_space_members_select on public.wishlist_space_members;
create policy wishlist_space_members_select on public.wishlist_space_members
for select to authenticated using (public.is_wishlist_space_member(space_id));

drop policy if exists wishlist_folders_shared_select on public.wishlist_folders;
create policy wishlist_folders_shared_select on public.wishlist_folders
for select to authenticated using (space_id is not null and public.is_wishlist_space_member(space_id));

drop policy if exists wishlist_items_shared_select on public.wishlist_items;
create policy wishlist_items_shared_select on public.wishlist_items
for select to authenticated using (space_id is not null and public.is_wishlist_space_member(space_id));

-- Preserve place visibility for BOTH private and shared Wishlist rows.
create or replace function public.can_read_place(target_place_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.trip_places tp
      join public.trip_members tm on tm.trip_id = tp.trip_id and tm.user_id = auth.uid()
      where tp.place_id = target_place_id
    )
    or exists (
      select 1 from public.wishlist_items wi
      where wi.place_id = target_place_id
        and wi.space_id is null
        and wi.user_id = auth.uid()
    )
    or exists (
      select 1 from public.wishlist_items wi
      join public.wishlist_space_members wm
        on wm.space_id = wi.space_id and wm.user_id = auth.uid()
      where wi.place_id = target_place_id and wi.space_id is not null
    )
  );
$$;

revoke all on function public.can_read_place(uuid) from public;
grant execute on function public.can_read_place(uuid) to authenticated;

create or replace function public.create_shared_wishlist_for_trip(
  p_trip_id uuid,
  p_name text default 'Shared Wishlist',
  p_move_my_existing boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  new_space uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception 'Trip editor access required'; end if;

  insert into public.wishlist_spaces(name,owner_id)
  values (coalesce(nullif(trim(p_name),''),'Shared Wishlist'),uid)
  returning id into new_space;

  insert into public.wishlist_space_members(space_id,user_id,role)
  select new_space, tm.user_id,
    case
      when tm.user_id = uid then 'owner'
      when tm.role in ('owner','editor') then 'editor'
      else 'viewer'
    end
  from public.trip_members tm
  where tm.trip_id = p_trip_id
  on conflict (space_id,user_id) do nothing;

  -- Defensive: caller must always be a member even if trip membership data is unusual.
  insert into public.wishlist_space_members(space_id,user_id,role)
  values (new_space,uid,'owner')
  on conflict (space_id,user_id) do update set role = 'owner';

  if p_move_my_existing then
    update public.wishlist_folders
      set space_id = new_space, updated_at = clock_timestamp()
    where user_id = uid and space_id is null;
    update public.wishlist_items
      set space_id = new_space, updated_at = clock_timestamp()
    where user_id = uid and space_id is null;
  end if;

  return new_space;
end;
$$;

create or replace function public.create_wishlist_folder_v2(
  p_name text,
  p_parent_id uuid default null,
  p_space_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(p_name,''));
  next_order integer;
  new_id uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 80 then raise exception 'Folder name must be 1-80 characters'; end if;
  if p_space_id is not null and not public.can_edit_wishlist_space(p_space_id) then raise exception 'Wishlist editor access required'; end if;

  if p_parent_id is not null and not exists (
    select 1 from public.wishlist_folders f
    where f.id = p_parent_id
      and f.space_id is not distinct from p_space_id
      and (p_space_id is not null or f.user_id = uid)
  ) then raise exception 'Parent folder not found'; end if;

  select coalesce(max(f.order_index),-1)+1 into next_order
  from public.wishlist_folders f
  where f.space_id is not distinct from p_space_id
    and (p_space_id is not null or f.user_id = uid)
    and f.parent_id is not distinct from p_parent_id;

  insert into public.wishlist_folders(user_id,space_id,parent_id,name,order_index)
  values (uid,p_space_id,p_parent_id,clean_name,next_order)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.rename_wishlist_folder_v2(p_folder_id uuid,p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_name text := trim(coalesce(p_name,''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 80 then raise exception 'Folder name must be 1-80 characters'; end if;
  if not public.can_access_wishlist_folder(p_folder_id,true) then raise exception 'Wishlist folder not found or not editable'; end if;
  update public.wishlist_folders set name=clean_name,updated_at=clock_timestamp() where id=p_folder_id;
end;
$$;

create or replace function public.delete_wishlist_folder_v2(p_folder_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_parent uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_access_wishlist_folder(p_folder_id,true) then raise exception 'Wishlist folder not found or not editable'; end if;
  select parent_id into target_parent from public.wishlist_folders where id=p_folder_id for update;
  update public.wishlist_items set folder_id=target_parent,updated_at=clock_timestamp() where folder_id=p_folder_id;
  update public.wishlist_folders set parent_id=target_parent,updated_at=clock_timestamp() where parent_id=p_folder_id;
  delete from public.wishlist_folders where id=p_folder_id;
end;
$$;

create or replace function public.add_wishlist_place_v2(
  p_name text,
  p_provider text default 'manual',
  p_provider_place_id text default null,
  p_formatted_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_folder_id uuid default null,
  p_category text default 'Sightseeing',
  p_rating smallint default 3,
  p_space_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(p_name,''));
  clean_provider text := coalesce(nullif(trim(p_provider),''),'manual');
  clean_provider_place_id text := nullif(trim(p_provider_place_id),'');
  clean_category text := trim(coalesce(p_category,'Sightseeing'));
  target_place_id uuid;
  existing_item_id uuid;
  new_item_id uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_space_id is not null and not public.can_edit_wishlist_space(p_space_id) then raise exception 'Wishlist editor access required'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 200 then raise exception 'Place name is required'; end if;
  if char_length(clean_category) < 1 or char_length(clean_category) > 40 then raise exception 'Category must be 1-40 characters'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1-5'; end if;

  if p_folder_id is not null and not exists (
    select 1 from public.wishlist_folders f
    where f.id=p_folder_id and f.space_id is not distinct from p_space_id
      and (p_space_id is not null or f.user_id=uid)
  ) then raise exception 'Wishlist folder not found'; end if;

  if clean_provider_place_id is not null then
    select p.id into target_place_id from public.places p
    where p.provider=clean_provider and p.provider_place_id=clean_provider_place_id
    order by p.created_at limit 1;
  end if;

  if target_place_id is null then
    insert into public.places(provider,provider_place_id,name,formatted_address,latitude,longitude,created_by)
    values(clean_provider,clean_provider_place_id,clean_name,nullif(trim(p_formatted_address),''),p_latitude,p_longitude,uid)
    returning id into target_place_id;
  end if;

  select wi.id into existing_item_id
  from public.wishlist_items wi
  where wi.place_id=target_place_id
    and wi.space_id is not distinct from p_space_id
    and (p_space_id is not null or wi.user_id=uid)
  for update;

  if existing_item_id is not null then
    update public.wishlist_items
    set folder_id=p_folder_id,category=clean_category,rating=p_rating,updated_at=clock_timestamp()
    where id=existing_item_id;
    return existing_item_id;
  end if;

  insert into public.wishlist_items(user_id,space_id,place_id,folder_id,category,rating)
  values(uid,p_space_id,target_place_id,p_folder_id,clean_category,p_rating)
  returning id into new_item_id;
  return new_item_id;
end;
$$;

create or replace function public.update_wishlist_item_v2(
  p_item_id uuid,p_folder_id uuid,p_category text,p_rating smallint
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target public.wishlist_items%rowtype;
  clean_category text := trim(coalesce(p_category,''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_access_wishlist_item(p_item_id,true) then raise exception 'Wishlist item not found or not editable'; end if;
  select * into target from public.wishlist_items where id=p_item_id for update;
  if p_folder_id is not null and not exists (
    select 1 from public.wishlist_folders f
    where f.id=p_folder_id and f.space_id is not distinct from target.space_id
      and (target.space_id is not null or f.user_id=auth.uid())
  ) then raise exception 'Wishlist folder not found'; end if;
  if char_length(clean_category)<1 or char_length(clean_category)>40 then raise exception 'Category must be 1-40 characters'; end if;
  if p_rating is null or p_rating<1 or p_rating>5 then raise exception 'Rating must be 1-5'; end if;
  update public.wishlist_items
  set folder_id=p_folder_id,category=clean_category,rating=p_rating,updated_at=clock_timestamp()
  where id=p_item_id;
end;
$$;

create or replace function public.update_wishlist_item_notes_v2(p_item_id uuid,p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_notes text := nullif(trim(coalesce(p_notes,'')),'');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_access_wishlist_item(p_item_id,true) then raise exception 'Wishlist item not found or not editable'; end if;
  if char_length(coalesce(clean_notes,''))>500 then raise exception 'Wishlist note must be 500 characters or fewer'; end if;
  update public.wishlist_items set notes=clean_notes,updated_at=clock_timestamp() where id=p_item_id;
end;
$$;

create or replace function public.delete_wishlist_item_v2(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); target_place_id uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.can_access_wishlist_item(p_item_id,true) then raise exception 'Wishlist item not found or not editable'; end if;
  select place_id into target_place_id from public.wishlist_items where id=p_item_id for update;
  delete from public.wishlist_items where id=p_item_id;
  delete from public.places p
  where p.id=target_place_id and p.created_by=uid
    and not exists(select 1 from public.trip_places tp where tp.place_id=p.id)
    and not exists(select 1 from public.wishlist_items wi where wi.place_id=p.id);
end;
$$;

create or replace function public.add_wishlist_item_to_trip_v2(p_item_id uuid,p_trip_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid:=auth.uid();
  item_row public.wishlist_items%rowtype;
  existing_id uuid;
  next_order integer;
  new_id uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.can_access_wishlist_item(p_item_id,false) then raise exception 'Wishlist item not found'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception 'Editor access required for target trip'; end if;
  select * into item_row from public.wishlist_items where id=p_item_id;
  select id into existing_id from public.trip_places
    where trip_id=p_trip_id and place_id=item_row.place_id order by created_at limit 1;
  if existing_id is not null then return existing_id; end if;
  select coalesce(max(order_index),-1)+1 into next_order from public.trip_places
    where trip_id=p_trip_id and day_id is null;
  insert into public.trip_places(trip_id,place_id,day_id,order_index,category,created_by,updated_by)
  values(p_trip_id,item_row.place_id,null,next_order,item_row.category,uid,uid)
  returning id into new_id;
  insert into public.place_preferences(trip_place_id,user_id,rating,preference,updated_at)
  values(new_id,uid,item_row.rating,
    case when item_row.rating=5 then 'must_go'::public.place_preference
         when item_row.rating>=4 then 'interested'::public.place_preference
         when item_row.rating<=1 then 'skip'::public.place_preference
         else 'neutral'::public.place_preference end,
    clock_timestamp())
  on conflict(trip_place_id,user_id) do update
    set rating=excluded.rating,preference=excluded.preference,updated_at=excluded.updated_at;
  return new_id;
end;
$$;

create or replace function public.add_wishlist_items_to_trip_v2(p_item_ids uuid[],p_trip_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare item_id uuid; processed integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_item_ids is null or coalesce(array_length(p_item_ids,1),0)=0 then raise exception 'Select at least one wishlist item'; end if;
  if coalesce(array_length(p_item_ids,1),0)>200 then raise exception 'A maximum of 200 wishlist items can be added at once'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception 'Editor access required for target trip'; end if;
  foreach item_id in array p_item_ids loop
    if public.can_access_wishlist_item(item_id,false) then
      perform public.add_wishlist_item_to_trip_v2(item_id,p_trip_id);
      processed:=processed+1;
    end if;
  end loop;
  if processed=0 then raise exception 'No selected wishlist items were found'; end if;
  return processed;
end;
$$;

create or replace function public.create_trip_from_wishlist_v2(
  p_item_ids uuid[],p_name text,p_timezone text default 'Asia/Tokyo',
  p_start_date date default null,p_end_date date default null,p_default_days integer default 4
)
returns table(trip_id uuid,trip_slug text,added_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  created_trip_id uuid; created_trip_slug text; item_id uuid; processed integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_item_ids is null or coalesce(array_length(p_item_ids,1),0)=0 then raise exception 'Select at least one wishlist item'; end if;
  select created.trip_id,created.trip_slug into created_trip_id,created_trip_slug
  from public.create_trip(p_name,coalesce(nullif(trim(p_timezone),''),'Asia/Tokyo'),p_start_date,p_end_date,p_default_days) created;
  foreach item_id in array p_item_ids loop
    if public.can_access_wishlist_item(item_id,false) then
      perform public.add_wishlist_item_to_trip_v2(item_id,created_trip_id);
      processed:=processed+1;
    end if;
  end loop;
  if processed=0 then raise exception 'No selected wishlist items were found'; end if;
  return query select created_trip_id,created_trip_slug,processed;
end;
$$;

revoke all on function public.create_shared_wishlist_for_trip(uuid,text,boolean) from public;
revoke all on function public.create_wishlist_folder_v2(text,uuid,uuid) from public;
revoke all on function public.rename_wishlist_folder_v2(uuid,text) from public;
revoke all on function public.delete_wishlist_folder_v2(uuid) from public;
revoke all on function public.add_wishlist_place_v2(text,text,text,text,double precision,double precision,uuid,text,smallint,uuid) from public;
revoke all on function public.update_wishlist_item_v2(uuid,uuid,text,smallint) from public;
revoke all on function public.update_wishlist_item_notes_v2(uuid,text) from public;
revoke all on function public.delete_wishlist_item_v2(uuid) from public;
revoke all on function public.add_wishlist_item_to_trip_v2(uuid,uuid) from public;
revoke all on function public.add_wishlist_items_to_trip_v2(uuid[],uuid) from public;
revoke all on function public.create_trip_from_wishlist_v2(uuid[],text,text,date,date,integer) from public;

grant execute on function public.create_shared_wishlist_for_trip(uuid,text,boolean) to authenticated;
grant execute on function public.create_wishlist_folder_v2(text,uuid,uuid) to authenticated;
grant execute on function public.rename_wishlist_folder_v2(uuid,text) to authenticated;
grant execute on function public.delete_wishlist_folder_v2(uuid) to authenticated;
grant execute on function public.add_wishlist_place_v2(text,text,text,text,double precision,double precision,uuid,text,smallint,uuid) to authenticated;
grant execute on function public.update_wishlist_item_v2(uuid,uuid,text,smallint) to authenticated;
grant execute on function public.update_wishlist_item_notes_v2(uuid,text) to authenticated;
grant execute on function public.delete_wishlist_item_v2(uuid) to authenticated;
grant execute on function public.add_wishlist_item_to_trip_v2(uuid,uuid) to authenticated;
grant execute on function public.add_wishlist_items_to_trip_v2(uuid[],uuid) to authenticated;
grant execute on function public.create_trip_from_wishlist_v2(uuid[],text,text,date,date,integer) to authenticated;

commit;
