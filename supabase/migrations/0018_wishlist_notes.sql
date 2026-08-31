-- NekoTrip v0.7.4
-- Expose the existing wishlist_items.notes field through a narrow owner-only RPC.

begin;

create or replace function public.update_wishlist_item_notes(
  p_item_id uuid,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  clean_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if char_length(coalesce(clean_notes, '')) > 500 then
    raise exception 'Wishlist note must be 500 characters or fewer';
  end if;

  update public.wishlist_items wi
  set notes = clean_notes,
      updated_at = clock_timestamp()
  where wi.id = p_item_id
    and wi.user_id = uid;

  if not found then
    raise exception 'Wishlist item not found';
  end if;
end;
$$;

revoke all on function public.update_wishlist_item_notes(uuid,text) from public;
grant execute on function public.update_wishlist_item_notes(uuid,text) to authenticated;

commit;

select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'update_wishlist_item_notes';
