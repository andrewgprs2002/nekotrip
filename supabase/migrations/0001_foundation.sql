-- NekoTrip collaborative foundation v0.3
-- Fresh-project migration: Auth-aware trips, invitations, places, preferences, RLS, and Realtime.

create extension if not exists pgcrypto;

create type public.trip_role as enum ('owner','editor','viewer');
create type public.trip_place_status as enum ('candidate','planned','booked','visited','skipped');
create type public.place_preference as enum ('must_go','interested','neutral','skip');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(name) between 1 and 120),
  timezone text not null default 'UTC',
  start_date date,
  end_date date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.trip_role not null default 'viewer',
  joined_at timestamptz not null default now(),
  primary key (trip_id,user_id)
);

create table public.trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  date date,
  title text not null check (char_length(title) between 1 and 80),
  base_location text,
  order_index integer not null check (order_index >= 0),
  created_at timestamptz not null default now(),
  unique(trip_id, order_index),
  unique(id, trip_id)
);

-- Places are deliberately NOT globally unique by provider_place_id.
-- A canonical global place table would conflict with privacy-aware RLS because a user
-- might hit a uniqueness conflict on a row they are not allowed to read.
create table public.places (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'manual',
  provider_place_id text,
  name text not null check (char_length(name) between 1 and 200),
  formatted_address text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index places_provider_lookup_idx on public.places(provider, provider_place_id)
where provider_place_id is not null;

create table public.trip_places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  place_id uuid not null references public.places(id),
  day_id uuid,
  order_index integer not null default 0 check (order_index >= 0),
  category text not null default 'Sightseeing',
  planned_duration_minutes integer check (planned_duration_minutes is null or planned_duration_minutes >= 0),
  notes text,
  status public.trip_place_status not null default 'candidate',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (day_id, trip_id) references public.trip_days(id, trip_id)
);

create table public.place_preferences (
  trip_place_id uuid not null references public.trip_places(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  preference public.place_preference not null default 'neutral',
  rating smallint check (rating between 1 and 5),
  note text,
  updated_at timestamptz not null default now(),
  primary key (trip_place_id,user_id)
);

create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  role public.trip_role not null default 'editor' check (role <> 'owner'),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 1 check (max_uses between 1 and 50),
  use_count integer not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index trip_members_user_idx on public.trip_members(user_id);
create index trip_days_trip_idx on public.trip_days(trip_id, order_index);
create index trip_places_trip_idx on public.trip_places(trip_id, day_id, order_index);
create index trip_invites_trip_idx on public.trip_invites(trip_id, created_at desc);
create index activity_log_trip_idx on public.activity_log(trip_id, created_at desc);

-- Automatically create a profile row for every Auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1), 'Traveler'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_trip_member(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.trip_members m
    where m.trip_id = target_trip and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_trip(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.trip_members m
    where m.trip_id = target_trip
      and m.user_id = (select auth.uid())
      and m.role in ('owner','editor')
  );
$$;

create or replace function public.is_trip_owner(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.trip_members m
    where m.trip_id = target_trip
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

-- Atomic trip creation: avoids the awkward state where a trip exists before its owner membership.
create or replace function public.shares_trip_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists(
    select 1
    from public.trip_members me
    join public.trip_members them on them.trip_id = me.trip_id
    where me.user_id = (select auth.uid()) and them.user_id = target_user
  );
$$;

create or replace function public.create_trip(
  p_name text,
  p_timezone text default 'UTC',
  p_start_date date default null,
  p_end_date date default null,
  p_default_days integer default 4
)
returns table(trip_id uuid, trip_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  base_slug text;
  new_trip_id uuid;
  new_slug text;
  i integer;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Trip name is required';
  end if;
  if p_end_date is not null and p_start_date is not null and p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'trip'; end if;
  new_slug := base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.trips (slug, name, timezone, start_date, end_date, created_by)
  values (new_slug, trim(p_name), coalesce(nullif(trim(p_timezone), ''), 'UTC'), p_start_date, p_end_date, uid)
  returning id into new_trip_id;

  insert into public.trip_members (trip_id, user_id, role)
  values (new_trip_id, uid, 'owner');

  for i in 1..least(greatest(coalesce(p_default_days, 4), 1), 30) loop
    insert into public.trip_days (trip_id, title, order_index, date)
    values (
      new_trip_id,
      'Day ' || i,
      i,
      case when p_start_date is null then null else p_start_date + (i - 1) end
    );
  end loop;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action)
  values (new_trip_id, uid, 'trip', new_trip_id, 'created');

  return query select new_trip_id, new_slug;
end;
$$;

-- Atomic place creation keeps the place row, trip placement, and the creator's rating consistent.
create or replace function public.add_trip_place(
  p_trip_id uuid,
  p_name text,
  p_provider text default 'manual',
  p_provider_place_id text default null,
  p_formatted_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_day_id uuid default null,
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
  new_place_id uuid;
  new_trip_place_id uuid;
  next_order integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_trip(p_trip_id) then raise exception 'Editor access required'; end if;
  if p_name is null or char_length(trim(p_name)) = 0 then raise exception 'Place name is required'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'Rating must be 1-5'; end if;
  if p_day_id is not null and not exists (
    select 1 from public.trip_days d where d.id = p_day_id and d.trip_id = p_trip_id
  ) then
    raise exception 'Day does not belong to this trip';
  end if;

  select coalesce(max(order_index), -1) + 1 into next_order
  from public.trip_places where trip_id = p_trip_id and day_id is not distinct from p_day_id;

  insert into public.places (
    provider, provider_place_id, name, formatted_address, latitude, longitude, created_by
  ) values (
    coalesce(nullif(trim(p_provider), ''), 'manual'), nullif(trim(p_provider_place_id), ''), trim(p_name),
    nullif(trim(p_formatted_address), ''), p_latitude, p_longitude, uid
  ) returning id into new_place_id;

  insert into public.trip_places (
    trip_id, place_id, day_id, order_index, category, created_by, updated_by
  ) values (
    p_trip_id, new_place_id, p_day_id, next_order, coalesce(nullif(trim(p_category), ''), 'Sightseeing'), uid, uid
  ) returning id into new_trip_place_id;

  if p_rating is not null then
    insert into public.place_preferences (trip_place_id, user_id, rating, preference)
    values (
      new_trip_place_id,
      uid,
      p_rating,
      case
        when p_rating = 5 then 'must_go'::public.place_preference
        when p_rating >= 4 then 'interested'::public.place_preference
        when p_rating <= 1 then 'skip'::public.place_preference
        else 'neutral'::public.place_preference
      end
    );
  end if;

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action, payload)
  values (p_trip_id, uid, 'trip_place', new_trip_place_id, 'created', jsonb_build_object('place_name', trim(p_name)));

  return new_trip_place_id;
end;
$$;

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
    and not exists (select 1 from public.trip_places tp where tp.place_id = p.id);

  insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action)
  values (target_trip, uid, 'trip_place', p_trip_place_id, 'deleted');
end;
$$;

create or replace function public.accept_trip_invite(p_token uuid)
returns table(trip_id uuid, trip_slug text, trip_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  invite_row public.trip_invites%rowtype;
  inserted_count integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select * into invite_row
  from public.trip_invites
  where token = p_token
  for update;

  if invite_row.id is null then raise exception 'Invite not found'; end if;
  if invite_row.revoked_at is not null then raise exception 'Invite has been revoked'; end if;
  if invite_row.expires_at <= now() then raise exception 'Invite has expired'; end if;
  if invite_row.use_count >= invite_row.max_uses then
    -- Existing members can still resolve an already-used invitation back to the trip.
    if not exists (
      select 1 from public.trip_members m
      where m.trip_id = invite_row.trip_id and m.user_id = uid
    ) then
      raise exception 'Invite has already been used';
    end if;
  end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (invite_row.trip_id, uid, invite_row.role)
  on conflict (trip_id, user_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    update public.trip_invites set use_count = use_count + 1 where id = invite_row.id;
    insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action)
    values (invite_row.trip_id, uid, 'member', uid, 'joined');
  end if;

  return query
  select t.id, t.slug, t.name from public.trips t where t.id = invite_row.trip_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_days enable row level security;
alter table public.places enable row level security;
alter table public.trip_places enable row level security;
alter table public.place_preferences enable row level security;
alter table public.trip_invites enable row level security;
alter table public.activity_log enable row level security;

revoke all on table public.profiles, public.trips, public.trip_members, public.trip_days, public.places,
  public.trip_places, public.place_preferences, public.trip_invites, public.activity_log from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, update, delete on public.trips to authenticated;
grant select, insert, update, delete on public.trip_members, public.trip_days, public.trip_places, public.place_preferences, public.trip_invites to authenticated;
grant select, insert, update on public.places to authenticated;
grant select on public.activity_log to authenticated;

create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()) or public.shares_trip_with(id));
create policy profiles_insert on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy trips_select on public.trips for select to authenticated using (public.is_trip_member(id));
create policy trips_update on public.trips for update to authenticated using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));
create policy trips_delete on public.trips for delete to authenticated using (public.is_trip_owner(id));

create policy members_select on public.trip_members for select to authenticated using (public.is_trip_member(trip_id));
create policy members_insert on public.trip_members for insert to authenticated with check (public.is_trip_owner(trip_id));
create policy members_update on public.trip_members for update to authenticated using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));
create policy members_delete on public.trip_members for delete to authenticated using (public.is_trip_owner(trip_id) or user_id = (select auth.uid()));

create policy days_select on public.trip_days for select to authenticated using (public.is_trip_member(trip_id));
create policy days_insert on public.trip_days for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy days_update on public.trip_days for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy days_delete on public.trip_days for delete to authenticated using (public.can_edit_trip(trip_id));

create policy places_select on public.places for select to authenticated using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.trip_places tp
    where tp.place_id = id and public.is_trip_member(tp.trip_id)
  )
);
create policy places_insert on public.places for insert to authenticated with check (created_by = (select auth.uid()));
create policy places_update on public.places for update to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

create policy trip_places_select on public.trip_places for select to authenticated using (public.is_trip_member(trip_id));
create policy trip_places_insert on public.trip_places for insert to authenticated with check (
  public.can_edit_trip(trip_id) and created_by = (select auth.uid()) and updated_by = (select auth.uid())
);
create policy trip_places_update on public.trip_places for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy trip_places_delete on public.trip_places for delete to authenticated using (public.can_edit_trip(trip_id));

create policy preferences_select on public.place_preferences for select to authenticated using (
  exists(select 1 from public.trip_places tp where tp.id = trip_place_id and public.is_trip_member(tp.trip_id))
);
create policy preferences_insert on public.place_preferences for insert to authenticated with check (
  user_id = (select auth.uid()) and exists(select 1 from public.trip_places tp where tp.id = trip_place_id and public.is_trip_member(tp.trip_id))
);
create policy preferences_update on public.place_preferences for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy preferences_delete on public.place_preferences for delete to authenticated using (user_id = (select auth.uid()));

create policy invites_select on public.trip_invites for select to authenticated using (public.is_trip_owner(trip_id));
create policy invites_insert on public.trip_invites for insert to authenticated with check (
  public.is_trip_owner(trip_id) and created_by = (select auth.uid()) and role <> 'owner'
);
create policy invites_update on public.trip_invites for update to authenticated using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));
create policy invites_delete on public.trip_invites for delete to authenticated using (public.is_trip_owner(trip_id));

create policy activity_select on public.activity_log for select to authenticated using (public.is_trip_member(trip_id));

-- Explicit function permissions. Helper functions remain executable by authenticated users because RLS policies call them.
revoke all on function public.create_trip(text,text,date,date,integer) from public;
revoke all on function public.add_trip_place(uuid,text,text,text,text,double precision,double precision,uuid,text,smallint) from public;
revoke all on function public.delete_trip_place(uuid) from public;
revoke all on function public.accept_trip_invite(uuid) from public;
grant execute on function public.create_trip(text,text,date,date,integer) to authenticated;
grant execute on function public.add_trip_place(uuid,text,text,text,text,double precision,double precision,uuid,text,smallint) to authenticated;
grant execute on function public.delete_trip_place(uuid) to authenticated;
grant execute on function public.accept_trip_invite(uuid) to authenticated;

-- Realtime: keep the v0.3 implementation simple with filtered Postgres Changes.
-- Replica identity FULL lets filtered DELETE events include the old row values.
alter table public.trip_places replica identity full;
alter table public.trip_days replica identity full;
alter table public.trip_members replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_places') then
    alter publication supabase_realtime add table public.trip_places;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_days') then
    alter publication supabase_realtime add table public.trip_days;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trip_members') then
    alter publication supabase_realtime add table public.trip_members;
  end if;
end $$;
