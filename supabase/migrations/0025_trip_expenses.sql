-- NekoTrip v0.8.4 — Trip expenses and settlement tracking
-- One expense record per Trip stop; each Trip member gets an amount due and an amount paid.
-- Equal split is calculated server-side. Manual split must exactly match total cost (within 0.01).

begin;

create table if not exists public.trip_place_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_place_id uuid not null unique references public.trip_places(id) on delete cascade,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  currency text not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
  split_mode text not null default 'equal' check (split_mode in ('equal','manual')),
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_place_expenses_trip_idx
  on public.trip_place_expenses(trip_id, trip_place_id);

create table if not exists public.trip_expense_shares (
  expense_id uuid not null references public.trip_place_expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_due numeric(14,2) not null default 0 check (amount_due >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  updated_at timestamptz not null default now(),
  primary key (expense_id, user_id)
);

alter table public.trip_place_expenses enable row level security;
alter table public.trip_expense_shares enable row level security;

-- Reads/writes are intentionally exposed only through the RPC layer below.
revoke insert, update, delete on public.trip_place_expenses from authenticated;
revoke insert, update, delete on public.trip_expense_shares from authenticated;

create or replace function public.list_trip_expense_members(p_trip_id uuid)
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

  if not exists (
    select 1 from public.trip_members tm
    where tm.trip_id = p_trip_id
      and tm.user_id = auth.uid()
  ) then
    raise exception 'Trip membership required';
  end if;

  return query
  select tm.user_id, u.email::text, tm.role::text
  from public.trip_members tm
  join auth.users u on u.id = tm.user_id
  where tm.trip_id = p_trip_id
  order by
    case tm.role::text when 'owner' then 0 when 'editor' then 1 else 2 end,
    lower(u.email);
end;
$$;

create or replace function public.list_trip_place_expenses(p_trip_id uuid)
returns table(
  expense_id uuid,
  trip_place_id uuid,
  amount numeric,
  currency text,
  split_mode text,
  note text,
  shares jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.trip_members tm
    where tm.trip_id = p_trip_id
      and tm.user_id = auth.uid()
  ) then
    raise exception 'Trip membership required';
  end if;

  return query
  select
    e.id,
    e.trip_place_id,
    e.amount,
    e.currency,
    e.split_mode,
    e.note,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', s.user_id,
          'amount_due', s.amount_due,
          'amount_paid', s.amount_paid
        )
        order by s.user_id
      ) filter (where s.user_id is not null),
      '[]'::jsonb
    ) as shares
  from public.trip_place_expenses e
  left join public.trip_expense_shares s on s.expense_id = e.id
  where e.trip_id = p_trip_id
  group by e.id
  order by e.created_at, e.id;
end;
$$;

create or replace function public.save_trip_place_expense(
  p_trip_place_id uuid,
  p_amount numeric,
  p_currency text,
  p_split_mode text,
  p_note text default null,
  p_shares jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target_trip uuid;
  expense uuid;
  member_count integer;
  base_due numeric(14,2);
  remainder numeric(14,2);
  manual_total numeric(14,2);
  share_row jsonb;
  share_user uuid;
  share_due numeric(14,2);
  share_paid numeric(14,2);
  idx integer := 0;
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  select tp.trip_id into target_trip
  from public.trip_places tp
  where tp.id = p_trip_place_id;

  if target_trip is null then
    raise exception 'Trip stop not found';
  end if;

  if not public.can_edit_trip(target_trip) then
    raise exception 'Trip editor access required';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Amount must be zero or greater';
  end if;

  p_currency := upper(trim(coalesce(p_currency, 'JPY')));
  if p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a 3-letter code';
  end if;

  if p_split_mode not in ('equal','manual') then
    raise exception 'Split mode must be equal or manual';
  end if;

  insert into public.trip_place_expenses(
    trip_id, trip_place_id, amount, currency, split_mode, note, created_by, updated_at
  )
  values (
    target_trip, p_trip_place_id, round(p_amount, 2), p_currency, p_split_mode,
    nullif(trim(coalesce(p_note, '')), ''), uid, clock_timestamp()
  )
  on conflict (trip_place_id)
  do update set
    amount = excluded.amount,
    currency = excluded.currency,
    split_mode = excluded.split_mode,
    note = excluded.note,
    updated_at = clock_timestamp()
  returning id into expense;

  create temporary table if not exists pg_temp.nekotrip_paid_input (
    user_id uuid primary key,
    amount_due numeric(14,2),
    amount_paid numeric(14,2)
  ) on commit drop;
  truncate pg_temp.nekotrip_paid_input;

  for share_row in select value from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb))
  loop
    share_user := nullif(share_row->>'user_id','')::uuid;
    share_due := greatest(0, round(coalesce((share_row->>'amount_due')::numeric, 0), 2));
    share_paid := greatest(0, round(coalesce((share_row->>'amount_paid')::numeric, 0), 2));

    if not exists (
      select 1 from public.trip_members tm
      where tm.trip_id = target_trip
        and tm.user_id = share_user
    ) then
      raise exception 'Expense share user is not a Trip member';
    end if;

    insert into pg_temp.nekotrip_paid_input(user_id, amount_due, amount_paid)
    values (share_user, share_due, share_paid)
    on conflict (user_id) do update
      set amount_due = excluded.amount_due,
          amount_paid = excluded.amount_paid;
  end loop;

  delete from public.trip_expense_shares where expense_id = expense;

  if p_split_mode = 'equal' then
    select count(*) into member_count
    from public.trip_members tm
    where tm.trip_id = target_trip;

    if member_count < 1 then
      raise exception 'Trip has no members';
    end if;

    base_due := trunc((round(p_amount, 2) / member_count) * 100) / 100;
    remainder := round(p_amount, 2) - (base_due * member_count);
    idx := 0;

    insert into public.trip_expense_shares(expense_id, user_id, amount_due, amount_paid, updated_at)
    select
      expense,
      tm.user_id,
      case when row_number() over (order by tm.user_id) = 1 then base_due + remainder else base_due end,
      coalesce(pi.amount_paid, 0),
      clock_timestamp()
    from public.trip_members tm
    left join pg_temp.nekotrip_paid_input pi on pi.user_id = tm.user_id
    where tm.trip_id = target_trip;

  else
    select round(coalesce(sum(pi.amount_due), 0), 2)
    into manual_total
    from pg_temp.nekotrip_paid_input pi;

    if abs(manual_total - round(p_amount, 2)) > 0.01 then
      raise exception 'Manual shares must add up to total cost';
    end if;

    insert into public.trip_expense_shares(expense_id, user_id, amount_due, amount_paid, updated_at)
    select
      expense,
      tm.user_id,
      coalesce(pi.amount_due, 0),
      coalesce(pi.amount_paid, 0),
      clock_timestamp()
    from public.trip_members tm
    left join pg_temp.nekotrip_paid_input pi on pi.user_id = tm.user_id
    where tm.trip_id = target_trip;
  end if;

  update public.trips
  set updated_at = clock_timestamp()
  where id = target_trip;

  return expense;
end;
$$;

create or replace function public.delete_trip_place_expense(p_trip_place_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_trip uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select tp.trip_id into target_trip
  from public.trip_places tp
  where tp.id = p_trip_place_id;

  if target_trip is null then
    raise exception 'Trip stop not found';
  end if;

  if not public.can_edit_trip(target_trip) then
    raise exception 'Trip editor access required';
  end if;

  delete from public.trip_place_expenses
  where trip_place_id = p_trip_place_id;

  update public.trips
  set updated_at = clock_timestamp()
  where id = target_trip;
end;
$$;

revoke all on function public.list_trip_expense_members(uuid) from public;
revoke all on function public.list_trip_place_expenses(uuid) from public;
revoke all on function public.save_trip_place_expense(uuid,numeric,text,text,text,jsonb) from public;
revoke all on function public.delete_trip_place_expense(uuid) from public;

grant execute on function public.list_trip_expense_members(uuid) to authenticated;
grant execute on function public.list_trip_place_expenses(uuid) to authenticated;
grant execute on function public.save_trip_place_expense(uuid,numeric,text,text,text,jsonb) to authenticated;
grant execute on function public.delete_trip_place_expense(uuid) to authenticated;

commit;

-- Verification
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'list_trip_expense_members',
    'list_trip_place_expenses',
    'save_trip_place_expense',
    'delete_trip_place_expense'
  )
order by routine_name;
