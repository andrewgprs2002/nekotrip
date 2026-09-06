-- NekoTrip v0.8.6 — Non-expiring Trip editor invites
-- Invite links remain one-time (max_uses = 1 by default), but no longer expire by time.
-- Once accepted, the resulting trip_members row has no expiration and remains active
-- until the Trip owner removes that member.

begin;

alter table public.trip_invites
  alter column expires_at drop not null;

alter table public.trip_invites
  alter column expires_at set default null;

-- Existing unused, non-revoked invitations also become non-expiring.
update public.trip_invites
set expires_at = null
where revoked_at is null
  and use_count < max_uses;

-- Make the acceptance rule explicit for nullable/non-expiring invites.
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
  if invite_row.expires_at is not null and invite_row.expires_at <= now() then
    raise exception 'Invite has expired';
  end if;

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
    update public.trip_invites
    set use_count = use_count + 1
    where id = invite_row.id;

    insert into public.activity_log (trip_id, actor_id, entity_type, entity_id, action)
    values (invite_row.trip_id, uid, 'member', uid, 'joined');
  end if;

  return query
  select t.id, t.slug, t.name
  from public.trips t
  where t.id = invite_row.trip_id;
end;
$$;

revoke all on function public.accept_trip_invite(uuid) from public;
grant execute on function public.accept_trip_invite(uuid) to authenticated;

commit;

-- Verification
select
  column_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trip_invites'
  and column_name = 'expires_at';
