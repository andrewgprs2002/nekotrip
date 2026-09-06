-- NekoTrip v0.8.3 — Multi-user Shared Wishlist ratings + consensus ranking
-- Each owner/editor keeps an independent 1-5 rating per shared Wishlist item.
-- Viewers can read ratings but cannot vote.
-- Removed members' historical rows are retained but excluded from the shared results.

begin;

create table if not exists public.wishlist_item_ratings (
  wishlist_item_id uuid not null references public.wishlist_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (wishlist_item_id, user_id)
);

create index if not exists wishlist_item_ratings_user_idx
  on public.wishlist_item_ratings(user_id, wishlist_item_id);

alter table public.wishlist_item_ratings enable row level security;

-- No direct client DML is needed; writes go through the security-definer RPC.
revoke insert, update, delete on public.wishlist_item_ratings from authenticated;

-- Members may read only ratings belonging to shared Wishlist items they can access.
drop policy if exists wishlist_item_ratings_select on public.wishlist_item_ratings;
create policy wishlist_item_ratings_select
on public.wishlist_item_ratings
for select
to authenticated
using (
  exists (
    select 1
    from public.wishlist_items wi
    join public.wishlist_space_members me
      on me.space_id = wi.space_id
     and me.user_id = auth.uid()
    join public.wishlist_space_members voter
      on voter.space_id = wi.space_id
     and voter.user_id = wishlist_item_ratings.user_id
     and voter.role in ('owner', 'editor')
    where wi.id = wishlist_item_ratings.wishlist_item_id
      and wi.space_id is not null
  )
);

create or replace function public.set_wishlist_item_rating(
  p_item_id uuid,
  p_rating smallint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target_space uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  select wi.space_id
  into target_space
  from public.wishlist_items wi
  where wi.id = p_item_id;

  if target_space is null then
    raise exception 'Shared Wishlist item not found';
  end if;

  if not public.can_edit_wishlist_space(target_space) then
    raise exception 'Wishlist editor access required';
  end if;

  if p_rating is null then
    delete from public.wishlist_item_ratings
    where wishlist_item_id = p_item_id
      and user_id = uid;
    return;
  end if;

  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be 1-5';
  end if;

  insert into public.wishlist_item_ratings(
    wishlist_item_id,
    user_id,
    rating
  )
  values (
    p_item_id,
    uid,
    p_rating
  )
  on conflict (wishlist_item_id, user_id)
  do update set
    rating = excluded.rating,
    updated_at = clock_timestamp();
end;
$$;

create or replace function public.list_wishlist_item_ratings(
  p_space_id uuid
)
returns table(
  item_id uuid,
  user_id uuid,
  email text,
  role text,
  rating smallint
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
    r.wishlist_item_id,
    r.user_id,
    u.email::text,
    m.role,
    r.rating
  from public.wishlist_item_ratings r
  join public.wishlist_items wi
    on wi.id = r.wishlist_item_id
   and wi.space_id = p_space_id
  join public.wishlist_space_members m
    on m.space_id = p_space_id
   and m.user_id = r.user_id
   and m.role in ('owner', 'editor')
  join auth.users u
    on u.id = r.user_id
  order by r.wishlist_item_id, lower(u.email);
end;
$$;

-- Preserve the current shared score as the creator's initial personal vote
-- where that creator is still an owner/editor. This runs only for rows that
-- do not already have an individual rating.
insert into public.wishlist_item_ratings(
  wishlist_item_id,
  user_id,
  rating
)
select
  wi.id,
  wi.user_id,
  wi.rating
from public.wishlist_items wi
join public.wishlist_space_members m
  on m.space_id = wi.space_id
 and m.user_id = wi.user_id
 and m.role in ('owner', 'editor')
where wi.space_id is not null
on conflict (wishlist_item_id, user_id) do nothing;

revoke all on function public.set_wishlist_item_rating(uuid,smallint) from public;
revoke all on function public.list_wishlist_item_ratings(uuid) from public;

grant execute on function public.set_wishlist_item_rating(uuid,smallint) to authenticated;
grant execute on function public.list_wishlist_item_ratings(uuid) to authenticated;

commit;

-- Verification
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'set_wishlist_item_rating',
    'list_wishlist_item_ratings'
  )
order by routine_name;
