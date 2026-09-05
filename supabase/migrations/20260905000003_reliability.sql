-- A withdrawal is a fact about the professional, not just about the booking.
--
-- Declining is allowed — a van breaks down, a job overruns, and a product that
-- forbids it produces professionals who simply never turn up, which is worse
-- for the customer than an honest early no. But allowed is not free. A
-- professional who accepts and then withdraws has cost somebody a delay and a
-- decision they had already made, and that has to be visible: to the ranking
-- that decides who is offered work, and to whoever is looking at this later.
--
-- `booking_status_history` already records every withdrawal with a reason and
-- a timestamp — that is the audit trail and it stays authoritative. What it is
-- not is queryable at the speed a search results page needs. These are the
-- counters the ranking reads.

alter table public.provider_stats
  add column if not exists jobs_accepted integer not null default 0
    check (jobs_accepted >= 0),
  add column if not exists withdrawals integer not null default 0
    check (withdrawals >= 0),
  add column if not exists declines integer not null default 0
    check (declines >= 0),
  add column if not exists last_withdrawal_at timestamptz;

comment on column public.provider_stats.withdrawals is
  'Times this professional accepted a job and then pulled out. Counted separately from `declines` because they are different promises broken: declining is saying no, withdrawing is saying yes and then no.';
comment on column public.provider_stats.declines is
  'Times this professional turned down a job they had not yet accepted. Cheap for the customer — the job simply opens sooner — so it weighs far less than a withdrawal.';

-- ---------------------------------------------------------------------------
-- Counting them.
--
-- A trigger rather than application code, because every path that releases a
-- booking has to count: the professional's own button today, an admin
-- unsticking a job tomorrow, and whatever Phase 10 adds. Counting in one
-- server action would mean the second caller silently does not.
--
-- `old.provider_id` is the professional letting go — `new.provider_id` is
-- already null by the time this runs, since `enforce_booking_transition`
-- clears it on the way back to pending.
-- ---------------------------------------------------------------------------

create or replace function public.record_provider_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'pending'
     or old.status not in ('accepted', 'en_route')
     or old.provider_id is null then
    return null;
  end if;

  insert into public.provider_stats (provider_id, withdrawals, last_withdrawal_at)
  values (old.provider_id, 1, now())
  on conflict (provider_id) do update
    set withdrawals = public.provider_stats.withdrawals + 1,
        last_withdrawal_at = now(),
        updated_at = now();

  return null;
end;
$$;

revoke execute on function public.record_provider_release()
  from public, anon, authenticated;

drop trigger if exists bookings_record_release on public.bookings;
create trigger bookings_record_release
  after update of status on public.bookings
  for each row execute function public.record_provider_release();

-- Acceptances, so a withdrawal rate has a denominator. A professional with one
-- withdrawal in two hundred jobs and one in three are not the same person, and
-- a raw count cannot tell them apart.
create or replace function public.record_provider_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'accepted' or old.status = 'accepted' or new.provider_id is null then
    return null;
  end if;

  insert into public.provider_stats (provider_id, jobs_accepted)
  values (new.provider_id, 1)
  on conflict (provider_id) do update
    set jobs_accepted = public.provider_stats.jobs_accepted + 1,
        updated_at = now();

  return null;
end;
$$;

revoke execute on function public.record_provider_acceptance()
  from public, anon, authenticated;

drop trigger if exists bookings_record_acceptance on public.bookings;
create trigger bookings_record_acceptance
  after update of status on public.bookings
  for each row execute function public.record_provider_acceptance();

-- ---------------------------------------------------------------------------
-- WHO TURNED THIS PARTICULAR JOB DOWN.
--
-- The counters above are about a professional in general. This is about one
-- professional and one job, and it exists because three separate things need
-- the same fact and none of them can get it from a counter:
--
--   1. The job must not be offered back to the person who just refused it.
--      Without this row, releasing a booking put it straight into that
--      professional's own open list — they turned it down and the product
--      immediately asked them again, which reads as "still waiting for you".
--   2. The customer's replacement suggestions must not lead with them.
--   3. Support needs to see, per job, who said no and why. `booking_status_
--      history` has the narrative; this has the shape you can query.
--
-- `kind` separates the two refusals because they cost the customer different
-- amounts: a decline before acceptance loses them a few minutes, a withdrawal
-- after it loses them a decision they had already made.
-- ---------------------------------------------------------------------------

create table if not exists public.booking_refusals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  kind text not null default 'withdrawn' check (kind in ('declined', 'withdrawn')),
  reason text,
  created_at timestamptz not null default now(),
  unique (booking_id, provider_id)
);

comment on table public.booking_refusals is
  'One professional saying no to one job. Read by the open-job policy (never re-offer it), by the customer''s replacement suggestions (never lead with them) and by support.';

create index if not exists booking_refusals_provider_idx
  on public.booking_refusals (provider_id, created_at desc);

alter table public.booking_refusals enable row level security;

-- The professional sees their own refusals; the customer sees who said no to
-- their job. Neither may write one: a refusal is written by the trigger below,
-- under the service role, as a consequence of the booking actually moving.
drop policy if exists "Providers read their own refusals" on public.booking_refusals;
create policy "Providers read their own refusals"
  on public.booking_refusals for select to authenticated
  using (
    exists (
      select 1 from public.providers p
      where p.id = booking_refusals.provider_id
        and p.profile_id = (select auth.uid())
    )
  );

drop policy if exists "Customers read refusals on their bookings" on public.booking_refusals;
create policy "Customers read refusals on their bookings"
  on public.booking_refusals for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_refusals.booking_id
        and b.customer_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read every refusal" on public.booking_refusals;
create policy "Admins read every refusal"
  on public.booking_refusals for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Has the caller already refused this job?
--
-- SECURITY DEFINER for the same reason `provider_can_serve` is: the open-job
-- policy on `bookings` needs to read `booking_refusals`, whose own policy
-- reads `bookings`. Straight through RLS that is the recursion Postgres
-- refuses to evaluate; a definer function reads the table without re-entering
-- the policy and the cycle never forms.
-- ---------------------------------------------------------------------------

create or replace function public.provider_refused(booking uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.booking_refusals r
    join public.providers p on p.id = r.provider_id
    where r.booking_id = booking
      and p.profile_id = (select auth.uid())
  );
$$;

revoke execute on function public.provider_refused(uuid) from public, anon;
grant execute on function public.provider_refused(uuid) to authenticated;

-- Does this professional actually cover this job? Same question
-- `provider_can_serve` asks, but about a named listing rather than the caller
-- — the customer re-picking after a withdrawal is choosing somebody else.
create or replace function public.provider_serves(
  provider uuid,
  category text,
  address uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.providers p
    join public.provider_categories pc on pc.provider_id = p.id
    join public.addresses a on a.id = address
    where p.id = provider
      and p.is_active
      and pc.category_slug = category
      and a.area_key = any (p.service_areas)
  );
$$;

revoke execute on function public.provider_serves(uuid, text, uuid) from public, anon;
grant execute on function public.provider_serves(uuid, text, uuid) to authenticated;

-- Both open-job policies get the same extra clause. A job you have refused is
-- not an open job as far as you are concerned.
drop policy if exists "Providers see open jobs they can do" on public.bookings;
create policy "Providers see open jobs they can do"
  on public.bookings for select to authenticated
  using (
    bookings.provider_id is null
    and bookings.status = 'pending'
    and bookings.opened_at is not null
    and public.provider_can_serve(bookings.category_slug, bookings.address_id)
    and not public.provider_refused(bookings.id)
  );

drop policy if exists "Providers claim an open job" on public.bookings;
create policy "Providers claim an open job"
  on public.bookings for update to authenticated
  using (
    bookings.provider_id is null
    and bookings.status = 'pending'
    and bookings.opened_at is not null
    and public.provider_can_serve(bookings.category_slug, bookings.address_id)
    and not public.provider_refused(bookings.id)
  )
  with check (
    exists (
      select 1 from public.providers p
      where p.id = bookings.provider_id
        and p.profile_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- The customer picks again, and the clock starts again.
--
-- After a withdrawal the booking is old, and every dispatch decision is taken
-- from the booking's age. Without an anchor, a replacement chosen forty
-- minutes into an emergency would be widened away from in the same sweep that
-- noticed them — first refusal already spent, on a person the customer had
-- just this second chosen. The give-up window moves with it for the same
-- reason: somebody who has actively re-picked has not given up, so we do not
-- give up on them either.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists reassigned_at timestamptz;

comment on column public.bookings.reassigned_at is
  'When the customer chose a replacement after a refusal. The dispatch clock is measured from this instead of created_at, so a re-pick gets a real first-refusal window.';

-- ---------------------------------------------------------------------------
-- A booking may be assigned from a browser — but only to somebody who can
-- actually do it, and never back to the person who just refused it.
--
-- The immutability trigger already allowed null -> a listing, because that is
-- how a professional claims an open job. The claim POLICY checks the claimer
-- covers the job; nothing checked it when the *customer* was the one writing,
-- which was a hole before this feature and is a load-bearing rule now that the
-- customer picking a replacement is a real path. Enforced here rather than in
-- the server action so it holds for every caller, including one that does not
-- exist yet.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_booking_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
     or new.reference is distinct from old.reference
     or new.category_slug is distinct from old.category_slug then
    raise exception 'A booking cannot be re-identified'
      using errcode = 'check_violation';
  end if;

  if new.quoted_min is distinct from old.quoted_min
     or new.quoted_max is distinct from old.quoted_max
     or new.final_amount is distinct from old.final_amount
     or new.final_amount_approved_at is distinct from old.final_amount_approved_at
     or new.platform_fee is distinct from old.platform_fee
     or new.provider_earning is distinct from old.provider_earning
     or new.commission_bps is distinct from old.commission_bps
     or new.payment_status is distinct from old.payment_status then
    raise exception 'Prices and payment state are not editable from a browser'
      using errcode = 'check_violation';
  end if;

  if new.provider_id is distinct from old.provider_id
     and old.provider_id is not null
     and new.provider_id is not null then
    raise exception 'A booking that is already assigned cannot be reassigned'
      using errcode = 'check_violation';
  end if;

  -- Taking on a professional, whoever is writing.
  if new.provider_id is distinct from old.provider_id
     and old.provider_id is null
     and new.provider_id is not null then
    if not public.provider_serves(new.provider_id, new.category_slug, new.address_id) then
      raise exception 'That professional does not cover this job'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.booking_refusals r
      where r.booking_id = new.id and r.provider_id = new.provider_id
    ) then
      raise exception 'That professional has already turned this job down'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_immutability()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recording the refusal itself, in the same trigger that counts it.
--
-- In the trigger rather than in the server action so that EVERY release writes
-- one — the professional's button today, an admin unsticking a job tomorrow.
-- The reason is filled in afterwards by whoever collected it; a refusal with
-- no reason is still a refusal and must not be lost because nobody typed one.
-- ---------------------------------------------------------------------------

create or replace function public.record_provider_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'pending'
     or old.status not in ('accepted', 'en_route')
     or old.provider_id is null then
    return null;
  end if;

  insert into public.provider_stats (provider_id, withdrawals, last_withdrawal_at)
  values (old.provider_id, 1, now())
  on conflict (provider_id) do update
    set withdrawals = public.provider_stats.withdrawals + 1,
        last_withdrawal_at = now(),
        updated_at = now();

  insert into public.booking_refusals (booking_id, provider_id, kind)
  values (old.id, old.provider_id, 'withdrawn')
  on conflict (booking_id, provider_id) do nothing;

  return null;
end;
$$;

revoke execute on function public.record_provider_release()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- LETTING GO CANNOT BE A POLICY, AND THAT IS A PROPERTY OF POSTGRES.
--
-- The obvious shape is a policy: "a professional may update a booking of
-- theirs to unassigned and pending". It cannot work, and the reason is worth
-- writing down because it will look like a missing policy to whoever reads
-- this next.
--
-- On UPDATE, Postgres applies the table's SELECT policies to the NEW row as
-- well as the UPDATE policy's own `with check`. An update is not allowed to
-- make a row vanish from the person making it. Releasing a job does exactly
-- that: the moment `provider_id` is null the row stops matching "Providers
-- read their assigned bookings", and it does not match "Providers see open
-- jobs they can do" either — that policy excludes anyone who has refused the
-- job, which by then is them. The write is refused with `new row violates
-- row-level security policy` whatever the update policy says: proved by adding
-- one with `with check (true)` and watching it fail exactly the same way, and
-- by adding a permissive SELECT policy and watching it pass.
--
-- Granting them a SELECT policy over jobs they refused would satisfy it, and
-- would put every refused job straight back into their open list, which is the
-- exact bug this migration exists to fix.
--
-- So a release is a SERVER-SIDE write: `declineJob` verifies through RLS that
-- the job is theirs — the policy is still what answers that — and the release
-- itself goes through the service role. The rules that matter are still in the
-- database: the transition trigger decides the move is legal, and the trigger
-- below records it against them whoever writes it.

-- ---------------------------------------------------------------------------
-- Both refusals, counted in one place.
--
-- A professional who never accepted is at `pending` already, so there is no
-- status change to hang a trigger on — the fact that identifies the refusal is
-- `provider_id` going to null. Firing on the whole row rather than on `status`
-- is what lets one function see both, and one function is what stops the two
-- being counted by rules that drift apart.
-- ---------------------------------------------------------------------------

create or replace function public.record_provider_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := old.provider_id;
  refusal text;
begin
  if who is null or new.provider_id is not null then
    return null;
  end if;

  if new.status = 'pending' and old.status in ('accepted', 'en_route') then
    refusal := 'withdrawn';
  elsif new.status = 'pending' and old.status = 'pending' then
    refusal := 'declined';
  else
    -- Any other way of losing a professional is not a refusal: a cancellation
    -- is the customer's, and a completed job keeps its provider.
    return null;
  end if;

  if refusal = 'withdrawn' then
    insert into public.provider_stats (provider_id, withdrawals, last_withdrawal_at)
    values (who, 1, now())
    on conflict (provider_id) do update
      set withdrawals = public.provider_stats.withdrawals + 1,
          last_withdrawal_at = now(),
          updated_at = now();
  else
    insert into public.provider_stats (provider_id, declines)
    values (who, 1)
    on conflict (provider_id) do update
      set declines = public.provider_stats.declines + 1,
          updated_at = now();
  end if;

  insert into public.booking_refusals (booking_id, provider_id, kind)
  values (old.id, who, refusal)
  on conflict (booking_id, provider_id) do nothing;

  return null;
end;
$$;

revoke execute on function public.record_provider_release()
  from public, anon, authenticated;

drop trigger if exists bookings_record_release on public.bookings;
create trigger bookings_record_release
  after update on public.bookings
  for each row execute function public.record_provider_release();
