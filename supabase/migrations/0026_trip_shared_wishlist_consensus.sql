-- NekoTrip v0.8.5 — Trip consensus sourced from Shared Wishlist
-- Shared Wishlist remains the rating source of truth.
-- Trip places store a live source link and only display consensus to users
-- who are also members of the source Shared Wishlist.

begin;

alter table public.trip_places
  add column if not exists source_wishlist_item_id uuid
  references public.wishlist_items(id) on delete set null;

create index if not exists trip_places_source_wishlist_item_idx
  on public.trip_places(source_wishlist_item_id)
  where source_wishlist_item_id is not null;

-- Re-link older Trip stops conservatively when there is exactly one matching
-- Shared Wishlist item connected to at least one member of the Trip.
with candidates as (
  select
    tp.id as trip_place_id,
    min(wi.id::text)::uuid as wishlist_item_id
  from public.trip_places tp
  join public.wishlist_items wi
    on wi.place_id = tp.place_id
   and wi.space_id is not null
  join public.wishlist_space_members wsm
    on wsm.space_id = wi.space_id
  join public.trip_members tm
    on tm.trip_id = tp.trip_id
   and tm.user_id = wsm.user_id
  where tp.source_wishlist_item_id is null
  group by tp.id
  having count(distinct wi.id) = 1
)
update public.trip_places tp
set source_wishlist_item_id = c.wishlist_item_id
from candidates c
where tp.id = c.trip_place_id;

-- Preserve the existing API, but now retain a live Shared Wishlist source link.
create or replace function public.add_wishlist_item_to_trip_v2(
  p_item_id uuid,
  p_trip_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  item_row public.wishlist_items%rowtype;
  existing_id uuid;
  next_order integer;
  new_id uuid;
  source_item_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_access_wishlist_item(p_item_id, false) then
    raise exception 'Wishlist item not found';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Editor access required for target trip';
  end if;

  select *
  into item_row
  from public.wishlist_items
  where id = p_item_id;

  -- Only Shared Wishlist items become consensus sources.
  source_item_id := case when item_row.space_id is not null then item_row.id else null end;

  select id
  into existing_id
  from public.trip_places
  where trip_id = p_trip_id
    and place_id = item_row.place_id
  order by created_at
  limit 1;

  if existing_id is not null then
    if source_item_id is not null then
      update public.trip_places
      set source_wishlist_item_id = coalesce(source_wishlist_item_id, source_item_id),
          updated_by = uid,
          updated_at = clock_timestamp()
      where id = existing_id;
    end if;
    return existing_id;
  end if;

  select coalesce(max(order_index), -1) + 1
  into next_order
  from public.trip_places
  where trip_id = p_trip_id
    and day_id is null;

  insert into public.trip_places(
    trip_id,
    place_id,
    day_id,
    order_index,
    category,
    source_wishlist_item_id,
    created_by,
    updated_by
  )
  values(
    p_trip_id,
    item_row.place_id,
    null,
    next_order,
    item_row.category,
    source_item_id,
    uid,
    uid
  )
  returning id into new_id;

  -- Keep legacy place preference data for compatibility, but Trip UI no longer
  -- treats it as the Shared Wishlist consensus score.
  insert into public.place_preferences(
    trip_place_id,
    user_id,
    rating,
    preference,
    updated_at
  )
  values(
    new_id,
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
  on conflict(trip_place_id, user_id)
  do update set
    rating = excluded.rating,
    preference = excluded.preference,
    updated_at = excluded.updated_at;

  return new_id;
end;
$$;

create or replace function public.list_trip_wishlist_consensus(
  p_trip_id uuid
)
returns table(
  trip_place_id uuid,
  source_wishlist_item_id uuid,
  source_wishlist_name text,
  average_rating numeric,
  rating_count integer,
  eligible_count integer,
  spread numeric,
  coverage numeric,
  agreement numeric,
  consensus_score numeric,
  trip_rank bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed_places as (
    select
      tp.id as trip_place_id,
      wi.id as source_wishlist_item_id,
      wi.space_id,
      ws.name as source_wishlist_name
    from public.trip_places tp
    join public.wishlist_items wi
      on wi.id = tp.source_wishlist_item_id
     and wi.space_id is not null
    join public.wishlist_spaces ws
      on ws.id = wi.space_id
    where tp.trip_id = p_trip_id
      and exists (
        select 1
        from public.trip_members tm
        where tm.trip_id = p_trip_id
          and tm.user_id = auth.uid()
      )
      -- Preserve explicit Shared Wishlist privacy. A Trip member who was not
      -- explicitly added to the Shared Wishlist does not receive its ratings.
      and exists (
        select 1
        from public.wishlist_space_members viewer_membership
        where viewer_membership.space_id = wi.space_id
          and viewer_membership.user_id = auth.uid()
      )
  ),
  eligible as (
    select
      ap.trip_place_id,
      ap.source_wishlist_item_id,
      ap.space_id,
      ap.source_wishlist_name,
      count(*) filter (where m.role in ('owner','editor'))::integer as eligible_count
    from allowed_places ap
    join public.wishlist_space_members m
      on m.space_id = ap.space_id
    group by
      ap.trip_place_id,
      ap.source_wishlist_item_id,
      ap.space_id,
      ap.source_wishlist_name
  ),
  stats as (
    select
      e.trip_place_id,
      e.source_wishlist_item_id,
      e.source_wishlist_name,
      e.eligible_count,
      avg(r.rating::numeric) as average_rating,
      count(r.rating)::integer as rating_count,
      coalesce(stddev_pop(r.rating::numeric), 0)::numeric as spread
    from eligible e
    left join public.wishlist_item_ratings r
      on r.wishlist_item_id = e.source_wishlist_item_id
     and exists (
       select 1
       from public.wishlist_space_members voter
       join public.wishlist_items voter_item
         on voter_item.id = e.source_wishlist_item_id
        and voter_item.space_id = voter.space_id
       where voter.user_id = r.user_id
         and voter.role in ('owner','editor')
     )
    group by
      e.trip_place_id,
      e.source_wishlist_item_id,
      e.source_wishlist_name,
      e.eligible_count
  ),
  scored as (
    select
      s.*,
      case
        when s.eligible_count <= 0 then 0::numeric
        else least(1::numeric, s.rating_count::numeric / s.eligible_count::numeric)
      end as coverage,
      case
        when s.rating_count = 0 then 0::numeric
        when s.rating_count = 1 then
          case
            when s.eligible_count <= 0 then 0::numeric
            else least(1::numeric, s.rating_count::numeric / s.eligible_count::numeric)
          end
        else greatest(
          0::numeric,
          1::numeric - least(s.spread / 2::numeric, 1::numeric)
        )
      end as agreement
    from stats s
  ),
  final_scores as (
    select
      s.*,
      case
        when s.average_rating is null then null::numeric
        else round(
          100::numeric * (
            0.70::numeric * (s.average_rating / 5::numeric) +
            0.20::numeric * s.coverage +
            0.10::numeric * s.agreement
          ),
          1
        )
      end as consensus_score
    from scored s
  )
  select
    f.trip_place_id,
    f.source_wishlist_item_id,
    f.source_wishlist_name,
    round(f.average_rating, 2) as average_rating,
    f.rating_count,
    f.eligible_count,
    round(f.spread, 2) as spread,
    round(f.coverage, 3) as coverage,
    round(f.agreement, 3) as agreement,
    f.consensus_score,
    case
      when f.consensus_score is null then null
      else dense_rank() over (
        order by
          f.consensus_score desc nulls last,
          f.average_rating desc nulls last,
          f.rating_count desc,
          f.spread asc,
          f.trip_place_id
      )
    end as trip_rank
  from final_scores f
  order by trip_rank nulls last, f.trip_place_id;
$$;

revoke all on function public.list_trip_wishlist_consensus(uuid) from public;
grant execute on function public.list_trip_wishlist_consensus(uuid) to authenticated;

commit;

-- Verification
select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trip_places'
  and column_name = 'source_wishlist_item_id';

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'add_wishlist_item_to_trip_v2',
    'list_trip_wishlist_consensus'
  )
order by routine_name;
