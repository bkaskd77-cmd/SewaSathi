-- A job nobody has accepted goes to somebody else, and eventually ends.
--
-- The booking page told the customer "we are alerting professionals now". That
-- was not true: the booking was assigned to the one professional they picked
-- and then sat there. If that person never opened the app, the job stayed
-- pending for ever and nothing anywhere noticed. This is the mechanism behind
-- the sentence.
--
-- The timing rules are NOT here. They are product promises about how fast this
-- moves — five minutes for an emergency, an hour for a repaint — and they live
-- in lib/booking/dispatch.ts where they can be read, changed and tested
-- without a migration. What is here is the shape that makes them enforceable.

-- ---------------------------------------------------------------------------
-- Who the customer originally asked for.
--
-- When a job widens, `provider_id` is cleared so anybody eligible can take it.
-- Without this column the customer's actual choice would be erased by the
-- widening, and "I asked for Krishna and Sita turned up" would have no answer
-- in the data. It is also what a future reliability score reads: a
-- professional who is repeatedly first choice and repeatedly lets the window
-- lapse is a fact worth keeping.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists first_choice_provider_id uuid
    references public.providers (id) on delete set null,
  add column if not exists opened_at timestamptz;

comment on column public.bookings.first_choice_provider_id is
  'The professional the customer picked. Kept when the job widens to others, so their choice survives the escalation.';
comment on column public.bookings.opened_at is
  'When first refusal lapsed and the job became visible to other professionals. Null while it is still the first choice''s alone.';

-- Backfill: every existing assignment was a first choice.
update public.bookings
set first_choice_provider_id = provider_id
where provider_id is not null and first_choice_provider_id is null;

-- The sweep asks for pending bookings by age, and the open list asks for
-- unassigned ones. Both are hot paths on every provider page load.
create index if not exists bookings_awaiting_provider_idx
  on public.bookings (status, created_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- Professionals can see an open job in their own category and ward.
--
-- Scoped three ways on purpose: the job must be unassigned, still pending, and
-- match a category they actually work in an area they actually serve. A
-- professional browsing every open booking in the valley would be a directory
-- of strangers' addresses, which is the thing `provider_contacts` exists to
-- avoid on the other side.
--
-- Note this grants SELECT only. Taking the job is a guarded update below.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Can this professional do this job?
--
-- SECURITY DEFINER, and that is not an optimisation — it is the only way this
-- works at all. The check needs the booking's ward, which lives on
-- `addresses`, and the RLS policy on `addresses` asks whether the caller owns
-- a booking for it. A policy on `bookings` that reads `addresses` therefore
-- re-enters `bookings`, and Postgres raises "infinite recursion detected in
-- policy". Found by the db suite rather than in production, which is the whole
-- reason that suite runs the real migrations.
--
-- Same cycle, same remedy as `public.is_admin()`. `search_path` is pinned
-- empty and every reference is schema-qualified; execute is granted only to
-- `authenticated`, because the policies that call it are evaluated with the
-- caller's privileges.
-- ---------------------------------------------------------------------------

create or replace function public.provider_can_serve(
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
    where p.profile_id = (select auth.uid())
      and p.is_active
      and pc.category_slug = category
      and a.area_key = any (p.service_areas)
  );
$$;

revoke execute on function public.provider_can_serve(text, uuid)
  from public, anon;
grant execute on function public.provider_can_serve(text, uuid) to authenticated;

drop policy if exists "Providers see open jobs they can do" on public.bookings;
create policy "Providers see open jobs they can do"
  on public.bookings for select to authenticated
  using (
    bookings.provider_id is null
    and bookings.status = 'pending'
    and bookings.opened_at is not null
    and public.provider_can_serve(bookings.category_slug, bookings.address_id)
  );

-- ---------------------------------------------------------------------------
-- Claiming an open job.
--
-- `with check` alone is not enough: it validates the row AFTER the update, by
-- which point `provider_id` is already this professional. The `using` clause
-- is what makes it a race that exactly one person wins — it matches only rows
-- that are STILL unassigned, so the second claim updates zero rows and the
-- caller is told the job has gone.
-- ---------------------------------------------------------------------------

drop policy if exists "Providers claim an open job" on public.bookings;
create policy "Providers claim an open job"
  on public.bookings for update to authenticated
  using (
    bookings.provider_id is null
    and bookings.status = 'pending'
    and bookings.opened_at is not null
    and public.provider_can_serve(bookings.category_slug, bookings.address_id)
  )
  with check (
    exists (
      select 1 from public.providers p
      where p.id = bookings.provider_id
        and p.profile_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- What a customer may change on their own booking.
--
-- FOUND BY THE DB SUITE, not by reading the code, and it is a money bug.
--
-- "Customers cancel their own open bookings" grants UPDATE with a `with check`
-- that validates `customer_id` and `status` and nothing else. RLS is row-level:
-- once a row is updatable, EVERY column on it is. So a customer could set
-- `provider_id` to any professional, and — far worse — rewrite `quoted_min`,
-- `quoted_max` and `final_amount` on their own job. `openPayment` judges the
-- final amount against the band frozen on the booking, so a customer who can
-- edit both can pay Rs 100 for a Rs 4,000 job and every server-side check
-- agrees with them.
--
-- The policy cannot express this: Postgres RLS has no per-column clause. A
-- trigger can, and it is the same place the status machine is already
-- enforced, so this is one more rule in a mechanism that already exists.
--
-- `auth.uid()` is null for the service role, which is how the server's own
-- writes — recording a final amount, freezing the commission split, running
-- the dispatch sweep — pass through untouched. Those paths do their own
-- checking in lib/data, under a key no browser holds.
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
  -- The server role writes with no session user. Everything below is about
  -- what a person sitting in a browser may do.
  if caller is null then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
     or new.reference is distinct from old.reference
     or new.category_slug is distinct from old.category_slug then
    raise exception 'A booking cannot be re-identified'
      using errcode = 'check_violation';
  end if;

  -- The money. The band was published before the job and the final amount is
  -- the professional's to enter; neither is the customer's to type.
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

  -- Assignment. A customer must not hand their job to somebody, and a
  -- professional must not take one already assigned. The only legal move is
  -- null -> a listing, which the claim policy already restricts to a listing
  -- the caller owns.
  if new.provider_id is distinct from old.provider_id
     and old.provider_id is not null then
    raise exception 'A booking that is already assigned cannot be reassigned'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_immutability()
  from public, anon, authenticated;

drop trigger if exists bookings_enforce_immutability on public.bookings;
create trigger bookings_enforce_immutability
  before update on public.bookings
  for each row execute function public.enforce_booking_immutability();

-- ---------------------------------------------------------------------------
-- A professional withdrawing is not the customer cancelling.
--
-- Declining an accepted job ended the booking at `cancelled`, and the customer
-- was shown "This booking was cancelled. Nothing is owed." — on a job they
-- still needed doing. Their air conditioner was still broken; the product had
-- simply stopped. Nothing is owed, and nothing is happening either.
--
-- So `accepted -> pending` and `en_route -> pending` become legal moves. They
-- are the only backwards transitions in this machine, and they exist because
-- the customer's *need* has not gone anywhere. The job returns to the pool and
-- somebody else picks it up; only the customer may end it.
--
-- The stamps are cleared on the way back, because `accepted_at` on a booking
-- nobody has accepted is a lie a report would repeat.
-- ---------------------------------------------------------------------------

create or replace function public.booking_transition_allowed(
  from_status text,
  to_status text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_status
    when 'pending'     then to_status in ('accepted', 'cancelled', 'no_provider_found')
    when 'accepted'    then to_status in ('en_route', 'cancelled', 'pending')
    when 'en_route'    then to_status in ('in_progress', 'cancelled', 'pending')
    when 'in_progress' then to_status in ('completed', 'cancelled')
    else false
  end;
$$;

revoke execute on function public.booking_transition_allowed(text, text)
  from public, anon, authenticated;

create or replace function public.enforce_booking_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'A booking must start as pending, not %', new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not public.booking_transition_allowed(old.status, new.status) then
    raise exception 'A booking cannot go from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Going back to the pool. Clear the stamps of the assignment that lapsed:
  -- an `accepted_at` on a booking nobody has accepted is a lie, and it is the
  -- kind a report repeats without anyone noticing.
  if new.status = 'pending' then
    new.accepted_at := null;
    new.en_route_at := null;
    new.provider_id := null;
    return new;
  end if;

  case new.status
    when 'accepted'          then new.accepted_at := now();
    when 'en_route'          then new.en_route_at := now();
    when 'in_progress'       then new.started_at := now();
    when 'completed'         then new.completed_at := now();
    when 'cancelled'         then new.cancelled_at := now();
    when 'no_provider_found' then new.no_provider_found_at := now();
    else null;
  end case;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_transition()
  from public, anon, authenticated;

-- The immutability trigger forbids reassigning an already-assigned booking.
-- Releasing one is the exception: `provider_id` may go to NULL, because that is
-- a professional letting go rather than handing the job to somebody chosen.
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

  -- null -> a listing is a claim; a listing -> null is a release. Listing ->
  -- another listing is the one that would let somebody hand away a job that is
  -- not theirs to give.
  if new.provider_id is distinct from old.provider_id
     and old.provider_id is not null
     and new.provider_id is not null then
    raise exception 'A booking that is already assigned cannot be reassigned'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_immutability()
  from public, anon, authenticated;
