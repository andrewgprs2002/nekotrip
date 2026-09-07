-- NekoTrip v0.8.16 — Profiles & Member Privacy
-- - unique emoji-capable nicknames
-- - ordinary collaborative RPCs expose nickname, not email
-- - email remains available only in explicit Members detail RPCs

begin;

alter table public.profiles
  add column if not exists nickname_key text;

-- Fill any missing display names from Auth email/local id.
update public.profiles p
set display_name = coalesce(
  nullif(btrim(p.display_name), ''),
  nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
  'Traveler-' || substr(replace(p.id::text, '-', ''), 1, 6)
)
from auth.users u
where u.id = p.id
  and nullif(btrim(p.display_name), '') is null;

-- Normalize current rows.
update public.profiles
set display_name = regexp_replace(btrim(display_name), '\s+', ' ', 'g');

-- De-duplicate existing names deterministically before adding uniqueness.
with ranked as (
  select
    p.id,
    p.display_name,
    row_number() over (
      partition by lower(regexp_replace(btrim(p.display_name), '\s+', ' ', 'g'))
      order by p.created_at nulls last, p.id
    ) as rn
  from public.profiles p
)
update public.profiles p
set display_name = left(r.display_name, 36) || ' · ' || substr(replace(p.id::text, '-', ''), 1, 6)
from ranked r
where p.id = r.id
  and r.rn > 1;

update public.profiles
set nickname_key = lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'));

create unique index if not exists profiles_nickname_key_uidx
  on public.profiles(nickname_key);

create or replace function public.sync_profile_nickname()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  clean_name text;
begin
  clean_name := regexp_replace(btrim(coalesce(new.display_name, '')), '\s+', ' ', 'g');

  if clean_name = '' then
    raise exception 'Nickname is required';
  end if;

  -- Emoji are allowed. Keep a generous codepoint limit for composed emoji.
  if char_length(clean_name) > 48 then
    raise exception 'Nickname must be 48 characters or fewer';
  end if;

  if lower(clean_name) in ('nekotrip', 'admin', 'administrator', 'support') then
    raise exception 'This nickname is reserved';
  end if;

  new.display_name := clean_name;
  new.nickname_key := lower(clean_name);
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists profiles_sync_nickname on public.profiles;
create trigger profiles_sync_nickname
before insert or update of display_name
on public.profiles
for each row
execute function public.sync_profile_nickname();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_name text;
  candidate text;
begin
  base_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Traveler'
  );
  candidate := regexp_replace(base_name, '\s+', ' ', 'g');

  if exists (
    select 1
    from public.profiles p
    where p.nickname_key = lower(candidate)
  ) then
    candidate := left(candidate, 36) || ' · ' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    candidate,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.get_my_profile()
returns table(
  user_id uuid,
  nickname text,
  email text
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

  return query
  select
    u.id,
    coalesce(p.display_name, 'Traveler')::text,
    coalesce(u.email::text, '')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = auth.uid();
end;
$$;

create or replace function public.set_my_nickname(p_nickname text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean_name text := regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g');
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if clean_name = '' then
    raise exception 'Nickname is required';
  end if;

  begin
    insert into public.profiles(id, display_name)
    values(uid, clean_name)
    on conflict (id)
    do update set display_name = excluded.display_name;
  exception
    when unique_violation then
      raise exception 'That nickname is already taken';
  end;

  return clean_name;
end;
$$;

-- Trip Members is an explicit member-detail surface, so nickname + email is allowed.
drop function if exists public.list_trip_members(uuid);
create function public.list_trip_members(p_trip_id uuid)
returns table(
  user_id uuid,
  nickname text,
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

  if not public.is_trip_member(p_trip_id) then
    raise exception 'Trip membership required';
  end if;

  return query
  select
    tm.user_id,
    coalesce(p.display_name, 'Traveler')::text,
    coalesce(u.email::text, 'Unknown member'),
    tm.role::text,
    tm.joined_at
  from public.trip_members tm
  left join public.profiles p on p.id = tm.user_id
  left join auth.users u on u.id = tm.user_id
  where tm.trip_id = p_trip_id
  order by
    case tm.role::text when 'owner' then 0 when 'editor' then 1 else 2 end,
    lower(coalesce(p.display_name, u.email::text, ''));
end;
$$;

-- Ordinary expense UI gets nickname only.
drop function if exists public.list_trip_expense_members(uuid);
create function public.list_trip_expense_members(p_trip_id uuid)
returns table(
  user_id uuid,
  nickname text,
  role text
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

  if not public.is_trip_member(p_trip_id) then
    raise exception 'Trip membership required';
  end if;

  return query
  select
    tm.user_id,
    coalesce(p.display_name, 'Traveler')::text,
    tm.role::text
  from public.trip_members tm
  left join public.profiles p on p.id = tm.user_id
  where tm.trip_id = p_trip_id
  order by
    case tm.role::text when 'owner' then 0 when 'editor' then 1 else 2 end,
    lower(coalesce(p.display_name, ''));
end;
$$;

-- Ordinary Message Board gets nickname only.
drop function if exists public.list_trip_messages(uuid);
create function public.list_trip_messages(p_trip_id uuid)
returns table(
  id uuid,
  user_id uuid,
  nickname text,
  message text,
  created_at timestamptz
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

  if not public.is_trip_member(p_trip_id) then
    raise exception 'Trip membership required';
  end if;

  return query
  select
    tm.id,
    tm.user_id,
    coalesce(p.display_name, 'Traveler')::text,
    tm.message,
    tm.created_at
  from public.trip_messages tm
  left join public.profiles p on p.id = tm.user_id
  where tm.trip_id = p_trip_id
  order by tm.created_at asc, tm.id asc;
end;
$$;

-- Ordinary Shared Wishlist member data gets nickname only.
drop function if exists public.list_wishlist_space_members(uuid);
create function public.list_wishlist_space_members(p_space_id uuid)
returns table(
  user_id uuid,
  nickname text,
  role text
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

  if not public.is_wishlist_space_member(p_space_id) then
    raise exception 'Wishlist membership required';
  end if;

  return query
  select
    m.user_id,
    coalesce(p.display_name, 'Traveler')::text,
    m.role::text
  from public.wishlist_space_members m
  left join public.profiles p on p.id = m.user_id
  where m.space_id = p_space_id
  order by
    case m.role::text when 'owner' then 0 when 'editor' then 1 else 2 end,
    lower(coalesce(p.display_name, ''));
end;
$$;

-- Explicit Wishlist Members detail surface: nickname + email + role.
create or replace function public.list_wishlist_space_member_details(p_space_id uuid)
returns table(
  user_id uuid,
  nickname text,
  email text,
  role text
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

  if not public.is_wishlist_space_member(p_space_id) then
    raise exception 'Wishlist membership required';
  end if;

  return query
  select
    m.user_id,
    coalesce(p.display_name, 'Traveler')::text,
    coalesce(u.email::text, 'Unknown member'),
    m.role::text
  from public.wishlist_space_members m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.space_id = p_space_id
  order by
    case m.role::text when 'owner' then 0 when 'editor' then 1 else 2 end,
    lower(coalesce(p.display_name, u.email::text, ''));
end;
$$;

-- Shared Wishlist rating chips expose nickname, never email.
drop function if exists public.list_wishlist_item_ratings(uuid);
create function public.list_wishlist_item_ratings(p_space_id uuid)
returns table(
  item_id uuid,
  user_id uuid,
  nickname text,
  role text,
  rating smallint
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

  if not public.is_wishlist_space_member(p_space_id) then
    raise exception 'Wishlist membership required';
  end if;

  return query
  select
    r.wishlist_item_id,
    r.user_id,
    coalesce(p.display_name, 'Traveler')::text,
    m.role::text,
    r.rating
  from public.wishlist_item_ratings r
  join public.wishlist_items wi
    on wi.id = r.wishlist_item_id
   and wi.space_id = p_space_id
  join public.wishlist_space_members m
    on m.space_id = p_space_id
   and m.user_id = r.user_id
   and m.role in ('owner', 'editor')
  left join public.profiles p on p.id = r.user_id
  order by r.wishlist_item_id, lower(coalesce(p.display_name, ''));
end;
$$;

revoke all on function public.get_my_profile() from public;
revoke all on function public.set_my_nickname(text) from public;
revoke all on function public.list_trip_members(uuid) from public;
revoke all on function public.list_trip_expense_members(uuid) from public;
revoke all on function public.list_trip_messages(uuid) from public;
revoke all on function public.list_wishlist_space_members(uuid) from public;
revoke all on function public.list_wishlist_space_member_details(uuid) from public;
revoke all on function public.list_wishlist_item_ratings(uuid) from public;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.set_my_nickname(text) to authenticated;
grant execute on function public.list_trip_members(uuid) to authenticated;
grant execute on function public.list_trip_expense_members(uuid) to authenticated;
grant execute on function public.list_trip_messages(uuid) to authenticated;
grant execute on function public.list_wishlist_space_members(uuid) to authenticated;
grant execute on function public.list_wishlist_space_member_details(uuid) to authenticated;
grant execute on function public.list_wishlist_item_ratings(uuid) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_my_profile',
    'set_my_nickname',
    'list_trip_members',
    'list_trip_expense_members',
    'list_trip_messages',
    'list_wishlist_space_members',
    'list_wishlist_space_member_details',
    'list_wishlist_item_ratings'
  )
order by routine_name;
