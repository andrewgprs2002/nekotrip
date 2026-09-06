-- NekoTrip v0.8.1 — Standalone Shared Wishlist
-- Adds Shared Wishlist creation independent of Trips.
-- A Shared Wishlist can optionally COPY the current private Wishlist.
-- Existing v0.8.0 functions remain available for backward compatibility.

begin;

create or replace function public.create_shared_wishlist(
  p_name text default 'Shared Wishlist',
  p_copy_my_existing boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_space uuid;
  src_folder record;
  mapped_parent uuid;
  new_folder_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 1
     or char_length(trim(coalesce(p_name, ''))) > 120 then
    raise exception 'Wishlist name must be 1-120 characters';
  end if;

  insert into public.wishlist_spaces(name, owner_id)
  values (trim(p_name), uid)
  returning id into new_space;

  insert into public.wishlist_space_members(space_id, user_id, role)
  values (new_space, uid, 'owner');

  if p_copy_my_existing then
    drop table if exists pg_temp.nekotrip_wishlist_folder_copy_map;
    create temporary table pg_temp.nekotrip_wishlist_folder_copy_map (
      old_id uuid primary key,
      new_id uuid not null
    ) on commit drop;

    for src_folder in
      with recursive folder_tree as (
        select
          f.id,
          f.parent_id,
          f.name,
          f.order_index,
          0 as depth
        from public.wishlist_folders f
        where f.user_id = uid
          and f.space_id is null
          and f.parent_id is null

        union all

        select
          child.id,
          child.parent_id,
          child.name,
          child.order_index,
          parent.depth + 1
        from public.wishlist_folders child
        join folder_tree parent on parent.id = child.parent_id
        where child.user_id = uid
          and child.space_id is null
      )
      select *
      from folder_tree
      order by depth, order_index, name
    loop
      mapped_parent := null;

      if src_folder.parent_id is not null then
        select m.new_id
        into mapped_parent
        from pg_temp.nekotrip_wishlist_folder_copy_map m
        where m.old_id = src_folder.parent_id;
      end if;

      insert into public.wishlist_folders(
        user_id,
        space_id,
        parent_id,
        name,
        order_index
      )
      values (
        uid,
        new_space,
        mapped_parent,
        src_folder.name,
        src_folder.order_index
      )
      returning id into new_folder_id;

      insert into pg_temp.nekotrip_wishlist_folder_copy_map(old_id, new_id)
      values (src_folder.id, new_folder_id);
    end loop;

    insert into public.wishlist_items(
      user_id,
      space_id,
      place_id,
      folder_id,
      category,
      rating,
      notes
    )
    select
      uid,
      new_space,
      wi.place_id,
      folder_map.new_id,
      wi.category,
      wi.rating,
      wi.notes
    from public.wishlist_items wi
    left join pg_temp.nekotrip_wishlist_folder_copy_map folder_map
      on folder_map.old_id = wi.folder_id
    where wi.user_id = uid
      and wi.space_id is null;
  end if;

  return new_space;
end;
$$;

create or replace function public.add_wishlist_space_member_by_email(
  p_space_id uuid,
  p_email text,
  p_role text default 'editor'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean_email text := lower(trim(coalesce(p_email, '')));
  clean_role text := lower(trim(coalesce(p_role, 'editor')));
  target_user_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.wishlist_spaces s
    where s.id = p_space_id
      and s.owner_id = uid
  ) then
    raise exception 'Wishlist owner access required';
  end if;

  if clean_email = '' then
    raise exception 'Email is required';
  end if;

  if clean_role not in ('editor', 'viewer') then
    raise exception 'Role must be editor or viewer';
  end if;

  select u.id
  into target_user_id
  from auth.users u
  where lower(u.email) = clean_email
  order by u.created_at
  limit 1;

  if target_user_id is null then
    raise exception 'No NekoTrip account found for this email. Ask them to sign in once first.';
  end if;

  if target_user_id = uid then
    raise exception 'You are already the owner of this Wishlist';
  end if;

  insert into public.wishlist_space_members(space_id, user_id, role)
  values (p_space_id, target_user_id, clean_role)
  on conflict (space_id, user_id)
  do update set role = excluded.role;

  return target_user_id;
end;
$$;

revoke all on function public.create_shared_wishlist(text,boolean) from public;
revoke all on function public.add_wishlist_space_member_by_email(uuid,text,text) from public;

grant execute on function public.create_shared_wishlist(text,boolean) to authenticated;
grant execute on function public.add_wishlist_space_member_by_email(uuid,text,text) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'create_shared_wishlist',
    'add_wishlist_space_member_by_email'
  )
order by routine_name;
