-- NekoTrip v0.8.2 — Explicit Shared Wishlist membership
-- Shared Wishlist access is STRICTLY membership-based.
-- No Trip membership, no site-wide access, no implicit tester access.

begin;

create or replace function public.list_wishlist_space_members(
  p_space_id uuid
)
returns table(
  user_id uuid,
  email text,
  role text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_wishlist_space_member(p_space_id) then
    raise exception 'Wishlist membership required';
  end if;

  return query
  select
    m.user_id,
    u.email::text,
    m.role
  from public.wishlist_space_members m
  join auth.users u on u.id = m.user_id
  where m.space_id = p_space_id
  order by
    case m.role when 'owner' then 0 when 'editor' then 1 else 2 end,
    lower(u.email);
end;
$$;

create or replace function public.remove_wishlist_space_member(
  p_space_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  owner_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  select s.owner_id
  into owner_id
  from public.wishlist_spaces s
  where s.id = p_space_id;

  if owner_id is null then
    raise exception 'Shared Wishlist not found';
  end if;

  if owner_id <> uid then
    raise exception 'Wishlist owner access required';
  end if;

  if p_user_id = owner_id then
    raise exception 'The Wishlist owner cannot be removed';
  end if;

  delete from public.wishlist_space_members
  where space_id = p_space_id
    and user_id = p_user_id;
end;
$$;

-- Reassert strict member-based helpers.
create or replace function public.is_wishlist_space_member(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.wishlist_space_members m
      where m.space_id = target_space
        and m.user_id = auth.uid()
    );
$$;

create or replace function public.can_edit_wishlist_space(target_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.wishlist_space_members m
      where m.space_id = target_space
        and m.user_id = auth.uid()
        and m.role in ('owner','editor')
    );
$$;

-- Ensure Shared Wishlist table reads are membership only.
drop policy if exists wishlist_spaces_select on public.wishlist_spaces;
create policy wishlist_spaces_select
on public.wishlist_spaces
for select
to authenticated
using (public.is_wishlist_space_member(id));

drop policy if exists wishlist_space_members_select on public.wishlist_space_members;
create policy wishlist_space_members_select
on public.wishlist_space_members
for select
to authenticated
using (public.is_wishlist_space_member(space_id));

drop policy if exists wishlist_folders_shared_select on public.wishlist_folders;
create policy wishlist_folders_shared_select
on public.wishlist_folders
for select
to authenticated
using (
  space_id is not null
  and public.is_wishlist_space_member(space_id)
);

drop policy if exists wishlist_items_shared_select on public.wishlist_items;
create policy wishlist_items_shared_select
on public.wishlist_items
for select
to authenticated
using (
  space_id is not null
  and public.is_wishlist_space_member(space_id)
);

revoke all on function public.list_wishlist_space_members(uuid) from public;
revoke all on function public.remove_wishlist_space_member(uuid,uuid) from public;

grant execute on function public.list_wishlist_space_members(uuid) to authenticated;
grant execute on function public.remove_wishlist_space_member(uuid,uuid) to authenticated;

commit;

-- Verification: should return both functions.
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'list_wishlist_space_members',
    'remove_wishlist_space_member'
  )
order by routine_name;
