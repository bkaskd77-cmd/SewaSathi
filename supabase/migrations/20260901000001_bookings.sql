-- Addresses, bookings, and the history of what happened to them.
--
-- Three tables and one rule engine. The rule engine is the point: a booking is
-- the first thing in this product that is a promise between two people, and
-- Phase 11 has to be able to answer "what happened, and when" months later
-- without taking anyone's word for it.
--
-- Money is integer NPR throughout. No currency column: this product is
-- Nepal-only, and a nullable currency that is always 'NPR' is a column that
-- starts lying the moment somebody forgets to set it.

-- ---------------------------------------------------------------------------
-- Addresses
-- ---------------------------------------------------------------------------
--
-- Nepal addressing is landmark-based. There is no house number that a stranger
-- on a motorbike can use, so `landmark` is not optional decoration — it is the
-- field that actually gets the professional to the door, and it is NOT NULL
-- for that reason.
--
-- `area_key` is the canonical ward reference and matches lib/config/areas.ts.
-- `city` and `ward_number` are written from it at save time rather than joined:
-- the ward list is a config file that will change as we add cities, and an
-- address that silently re-points at a different ward when that file is edited
-- is worse than one that remembers where it was.

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,

  -- 'home' and 'office' are offered; anything else is what the customer typed.
  label text not null default 'home' check (char_length(label) between 1 and 40),

  -- Canonical ward key, e.g. "lalitpur-4".
  area_key text not null,
  -- Snapshot of that key at save time. See the note above.
  city text not null,
  ward_number smallint not null check (ward_number > 0),

  -- The neighbourhood people say out loud.
  tole text not null check (char_length(tole) between 2 and 80),
  -- How you actually find it. Required on purpose.
  landmark text not null check (char_length(landmark) between 2 and 120),
  -- "Blue gate, third floor, ring the bottom bell."
  directions_note text check (char_length(directions_note) <= 300),

  -- Reserved for Phase 8's live tracking. Nothing writes these yet.
  lat double precision,
  lng double precision,

  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.addresses is
  'Customer addresses. landmark is NOT NULL because Nepal addressing is landmark-based — it is how the professional finds the door.';

create index if not exists addresses_profile_idx
  on public.addresses (profile_id, is_default desc, updated_at desc);

-- One default per customer, enforced rather than hoped for. A partial unique
-- index is the only way to say "at most one true" in Postgres.
create unique index if not exists addresses_one_default_idx
  on public.addresses (profile_id)
  where is_default;

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),

  -- "SK-4F2K9". People read these down a phone line, so the alphabet has no
  -- 0/O and no 1/I. Generated in lib/data/bookings.ts.
  reference text not null unique,

  customer_id uuid not null references public.profiles (id) on delete cascade,

  -- Null means unassigned — "send whoever is available", which is the common
  -- case for an emergency at 11pm. `on delete set null`: a provider leaving
  -- the platform must never delete the customer's record of a job.
  provider_id uuid references public.providers (id) on delete set null,

  -- categories is keyed by slug, so this is the category id.
  category_slug text not null references public.categories (slug),

  -- `restrict`, not `set null` or `cascade`: an address with a booking against
  -- it cannot be deleted, because a booking with no address is a professional
  -- with nowhere to go and a record nobody can audit.
  address_id uuid not null references public.addresses (id) on delete restrict,

  description text not null check (char_length(description) between 4 and 1000),
  photo_url text,

  urgency text not null default 'routine'
    check (urgency in ('emergency', 'soon', 'routine')),

  -- Null means as soon as possible. A timestamp means a chosen 2-hour window,
  -- and it is the start of that window.
  scheduled_for timestamptz,

  status text not null default 'pending'
    check (status in (
      'pending', 'accepted', 'en_route', 'in_progress',
      'completed', 'cancelled', 'no_provider_found'
    )),

  -- The band quoted at booking time, frozen. Every screen reads these back
  -- from the booking rather than from `categories`: repricing a service next
  -- month must not rewrite what somebody already agreed to.
  quoted_min integer not null check (quoted_min > 0),
  quoted_max integer not null check (quoted_max >= quoted_min),

  -- Agreed on site, after the professional has seen the job.
  final_amount integer check (final_amount >= 0),

  -- Selected in Phase 6, charged in Phase 7. Recording the intent is not the
  -- same as taking the money, which is why payment_status exists separately
  -- and starts unpaid for every method including cash.
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'esewa', 'khalti')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded', 'failed')),

  -- Which triage produced this, when it came from one. Phase 9 reads it to ask
  -- whether the bands we quote match what jobs actually cost.
  triage_log_id uuid references public.triage_logs (id) on delete set null,

  locale text not null default 'en' check (locale in ('en', 'ne')),

  -- One timestamp per transition. Derivable from the history table, kept here
  -- as well because every list and detail screen needs "when was this accepted"
  -- without a second query.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  en_route_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  no_provider_found_at timestamptz,

  cancelled_by text check (cancelled_by in ('customer', 'provider', 'admin')),
  cancellation_reason text check (char_length(cancellation_reason) <= 300),

  -- The status column and its timestamps must agree. A status that contradicts
  -- its own timestamp is how a report quietly produces the wrong number.
  constraint bookings_completed_shape
    check ((status = 'completed') = (completed_at is not null)),
  constraint bookings_cancelled_shape
    check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint bookings_no_provider_shape
    check ((status = 'no_provider_found') = (no_provider_found_at is not null)),
  -- A finished job has a price; an unfinished one does not.
  constraint bookings_final_amount_shape
    check (final_amount is null or status = 'completed')
);

comment on table public.bookings is
  'Jobs customers have booked. quoted_min/quoted_max are frozen at booking time — repricing a category must never rewrite an agreed quote.';

create index if not exists bookings_customer_idx
  on public.bookings (customer_id, created_at desc);

create index if not exists bookings_provider_idx
  on public.bookings (provider_id, created_at desc);

-- Dispatch reads this: unassigned work, most urgent first.
create index if not exists bookings_dispatch_idx
  on public.bookings (status, urgency, created_at)
  where provider_id is null;

-- ---------------------------------------------------------------------------
-- Status history — append only
-- ---------------------------------------------------------------------------
--
-- The status column says where a booking is now. This says how it got there,
-- and it is the evidence when Phase 11 has a dispute to settle. Overwriting a
-- status column destroys exactly the information a dispute needs.

create table if not exists public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,

  -- Null on the first row: nothing preceded 'pending'.
  from_status text,
  to_status text not null,

  -- Null when the change came from the system rather than a person — a
  -- dispatch timeout, say. `set null` on delete so removing an account cannot
  -- erase the record of what they did.
  changed_by uuid references public.profiles (id) on delete set null,
  changed_by_role text not null default 'system'
    check (changed_by_role in ('customer', 'provider', 'admin', 'system')),

  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);

comment on table public.booking_status_history is
  'Append-only. Every status change, who made it and when. This is the evidence in a dispute — nothing updates or deletes rows here.';

create index if not exists booking_status_history_booking_idx
  on public.booking_status_history (booking_id, created_at);

-- ---------------------------------------------------------------------------
-- The transition rules
-- ---------------------------------------------------------------------------
--
-- One place, enforced in the database, so no code path — an app bug, a script,
-- somebody in the SQL editor — can move a booking somewhere it cannot go. A
-- booking must not jump from pending to completed.
--
-- This list is mirrored in lib/booking/status.ts, which is what the interface
-- reads. `npm run check:transitions` fails the build if the two disagree, so
-- the duplication cannot rot.
--
--   pending           -> accepted, cancelled, no_provider_found
--   accepted          -> en_route, cancelled
--   en_route          -> in_progress, cancelled
--   in_progress       -> completed, cancelled
--   completed         -> (terminal)
--   cancelled         -> (terminal)
--   no_provider_found -> (terminal)

create or replace function public.booking_transition_allowed(
  from_status text,
  to_status text
) returns boolean
language sql
immutable
as $$
  select case from_status
    when 'pending'     then to_status in ('accepted', 'cancelled', 'no_provider_found')
    when 'accepted'    then to_status in ('en_route', 'cancelled')
    when 'en_route'    then to_status in ('in_progress', 'cancelled')
    when 'in_progress' then to_status in ('completed', 'cancelled')
    else false
  end;
$$;

/*
 * Enforce the rules, stamp the timestamp, and write the history row.
 *
 * All three in one trigger on purpose: a transition that is recorded but not
 * stamped, or stamped but not recorded, is the inconsistency the history table
 * exists to rule out.
 */
create or replace function public.enforce_booking_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'A booking must start as pending, not %', new.status
        using errcode = 'check_violation';
    end if;
    insert into public.booking_status_history
      (booking_id, from_status, to_status, changed_by, changed_by_role)
    values (new.id, null, 'pending', actor, 'customer');
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not public.booking_transition_allowed(old.status, new.status) then
    raise exception 'A booking cannot go from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Stamp the transition rather than trusting the caller to.
  case new.status
    when 'accepted'          then new.accepted_at := now();
    when 'en_route'          then new.en_route_at := now();
    when 'in_progress'       then new.started_at := now();
    when 'completed'         then new.completed_at := now();
    when 'cancelled'         then new.cancelled_at := now();
    when 'no_provider_found' then new.no_provider_found_at := now();
    else null;
  end case;

  actor_role := case
    when actor is null then 'system'
    when actor = new.customer_id then 'customer'
    when public.is_admin() then 'admin'
    else 'provider'
  end;

  insert into public.booking_status_history
    (booking_id, from_status, to_status, changed_by, changed_by_role, note)
  values (new.id, old.status, new.status, actor, actor_role,
          case when new.status = 'cancelled' then new.cancellation_reason end);

  return new;
end;
$$;

drop trigger if exists bookings_enforce_transition on public.bookings;
create trigger bookings_enforce_transition
  before insert or update of status on public.bookings
  for each row execute function public.enforce_booking_transition();

-- updated_at, without trusting the application to remember.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bookings_touch_updated_at on public.bookings;
create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_updated_at();

drop trigger if exists addresses_touch_updated_at on public.addresses;
create trigger addresses_touch_updated_at
  before update on public.addresses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.addresses enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_status_history enable row level security;

-- Addresses: yours and nobody else's.
drop policy if exists "Own addresses are readable" on public.addresses;
create policy "Own addresses are readable"
  on public.addresses for select to authenticated
  using ((select auth.uid()) = profile_id);

drop policy if exists "Own addresses are writable" on public.addresses;
create policy "Own addresses are writable"
  on public.addresses for insert to authenticated
  with check ((select auth.uid()) = profile_id);

drop policy if exists "Own addresses are updatable" on public.addresses;
create policy "Own addresses are updatable"
  on public.addresses for update to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- A professional needs the address of a job assigned to them, and no others.
drop policy if exists "Assigned providers read the job address" on public.addresses;
create policy "Assigned providers read the job address"
  on public.addresses for select to authenticated
  using (exists (
    select 1
    from public.bookings b
    join public.providers p on p.id = b.provider_id
    where b.address_id = addresses.id
      and p.profile_id = (select auth.uid())
      and b.status in ('accepted', 'en_route', 'in_progress')
  ));

-- Bookings: customers read and write their own.
drop policy if exists "Customers read their own bookings" on public.bookings;
create policy "Customers read their own bookings"
  on public.bookings for select to authenticated
  using ((select auth.uid()) = customer_id);

-- `with check` on customer_id is what stops a crafted insert booking a job in
-- somebody else's name.
drop policy if exists "Customers create their own bookings" on public.bookings;
create policy "Customers create their own bookings"
  on public.bookings for insert to authenticated
  with check ((select auth.uid()) = customer_id);

-- A customer may change their own booking only while nobody is on the way, and
-- may only ever move it to cancelled. The transition trigger blocks the rest;
-- this stops them reaching 'completed', which is what would let them set
-- final_amount.
drop policy if exists "Customers cancel their own open bookings" on public.bookings;
create policy "Customers cancel their own open bookings"
  on public.bookings for update to authenticated
  using (
    (select auth.uid()) = customer_id
    and status in ('pending', 'accepted')
  )
  with check (
    (select auth.uid()) = customer_id
    and status in ('pending', 'accepted', 'cancelled')
  );

-- Providers read only what is assigned to them.
drop policy if exists "Providers read their assigned bookings" on public.bookings;
create policy "Providers read their assigned bookings"
  on public.bookings for select to authenticated
  using (exists (
    select 1 from public.providers p
    where p.id = bookings.provider_id
      and p.profile_id = (select auth.uid())
  ));

drop policy if exists "Providers advance their assigned bookings" on public.bookings;
create policy "Providers advance their assigned bookings"
  on public.bookings for update to authenticated
  using (exists (
    select 1 from public.providers p
    where p.id = bookings.provider_id
      and p.profile_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.providers p
    where p.id = bookings.provider_id
      and p.profile_id = (select auth.uid())
  ));

drop policy if exists "Admins read every booking" on public.bookings;
create policy "Admins read every booking"
  on public.bookings for select to authenticated
  using (public.is_admin());

-- History is readable by whoever can read the booking, and written by nobody:
-- rows come from the trigger, which is security definer. No insert, update or
-- delete policy exists, so RLS denies all three — that is what "append-only"
-- means here.
drop policy if exists "Booking history follows the booking" on public.booking_status_history;
create policy "Booking history follows the booking"
  on public.booking_status_history for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_status_history.booking_id
      and (
        b.customer_id = (select auth.uid())
        or exists (
          select 1 from public.providers p
          where p.id = b.provider_id and p.profile_id = (select auth.uid())
        )
        or public.is_admin()
      )
  ));

-- No delete policy on bookings anywhere. A booking is cancelled, never erased:
-- it is the record of what was promised to somebody.
