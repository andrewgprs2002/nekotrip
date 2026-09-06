-- NekoTrip v0.8.12 — Trip Message Board
--
-- Any Trip member can read messages.
-- Trip owner/editor can post.
-- Authors can delete their own messages.
-- Trip owner can delete any message.

begin;

create table if not exists public.trip_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists trip_messages_trip_created_idx
  on public.trip_messages(trip_id, created_at, id);

alter table public.trip_messages enable row level security;

revoke all on table public.trip_messages from anon, authenticated;
grant select on table public.trip_messages to authenticated;

drop policy if exists trip_messages_select on public.trip_messages;
create policy trip_messages_select
on public.trip_messages
for select
to authenticated
using (public.is_trip_member(trip_id));

create or replace function public.list_trip_messages(
  p_trip_id uuid
)
returns table(
  id uuid,
  user_id uuid,
  email text,
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
    coalesce(u.email::text, 'Unknown member') as email,
    tm.message,
    tm.created_at
  from public.trip_messages tm
  left join auth.users u
    on u.id = tm.user_id
  where tm.trip_id = p_trip_id
  order by tm.created_at asc, tm.id asc;
end;
$$;

create or replace function public.post_trip_message(
  p_trip_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean_message text := trim(coalesce(p_message, ''));
  new_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Owner or editor access required';
  end if;

  if char_length(clean_message) < 1 then
    raise exception 'Message cannot be empty';
  end if;

  if char_length(clean_message) > 2000 then
    raise exception 'Message must be 2000 characters or fewer';
  end if;

  insert into public.trip_messages(
    trip_id,
    user_id,
    message
  )
  values(
    p_trip_id,
    uid,
    clean_message
  )
  returning id into new_id;

  update public.trips
  set updated_at = clock_timestamp()
  where id = p_trip_id;

  return new_id;
end;
$$;

create or replace function public.delete_trip_message(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target_trip uuid;
  author_id uuid;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  select tm.trip_id, tm.user_id
  into target_trip, author_id
  from public.trip_messages tm
  where tm.id = p_message_id;

  if target_trip is null then
    raise exception 'Message not found';
  end if;

  if uid <> author_id and not public.is_trip_owner(target_trip) then
    raise exception 'Only the author or Trip owner can delete this message';
  end if;

  delete from public.trip_messages
  where id = p_message_id;

  update public.trips
  set updated_at = clock_timestamp()
  where id = target_trip;
end;
$$;

revoke all on function public.list_trip_messages(uuid) from public;
revoke all on function public.post_trip_message(uuid,text) from public;
revoke all on function public.delete_trip_message(uuid) from public;

grant execute on function public.list_trip_messages(uuid) to authenticated;
grant execute on function public.post_trip_message(uuid,text) to authenticated;
grant execute on function public.delete_trip_message(uuid) to authenticated;

-- Add to Realtime publication when available.
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_messages'
  ) then
    alter publication supabase_realtime add table public.trip_messages;
  end if;
end $$;

commit;

-- Verification
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'list_trip_messages',
    'post_trip_message',
    'delete_trip_message'
  )
order by routine_name;

select
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'trip_messages';
