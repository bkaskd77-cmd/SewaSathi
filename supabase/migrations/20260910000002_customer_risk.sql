-- ---------------------------------------------------------------------------
-- Customer-side fraud, and the professional who was carrying the cost of it.
--
-- WHAT WAS WRONG. A professional who rode across Kathmandu to an address that
-- does not exist earned nothing. They carried the entire cost of OUR fraud
-- problem, and they are the scarcest thing this platform has. Two of those and
-- a good provider stops taking our jobs — which is not a complaint we would
-- ever receive, because people do not write in to explain why they left.
--
-- FOUR THINGS, and the order matters because each one makes the next cheaper:
--
--   1. PROTECT THE TRIP, NOT THE BOOKING. `bookings.confirmed_at` — before a
--      professional is dispatched to an address nobody has ever been to, the
--      customer must actively answer. Not a passive timer: the script that
--      fired twenty fake bookings will not say no either. This kills most fake
--      bookings with no fraud model and without blocking anybody real.
--   2. ARRIVAL EVIDENCE. `booking_arrivals` — a timestamp and a coarse
--      location. Without it a no-show claim is one person's word and we can
--      act on neither side, which is the status quo that loses providers.
--   3. TRIP COMPENSATION. `no_show_claims` — we pay the professional from our
--      own money the moment a claim is upheld, and whether we ever recover it
--      is our problem rather than theirs.
--   4. RECOVERY, FORWARD-NETTED. `customer_risk.trip_debt_rupees` — off a
--      later bill, capped, never chased as cash, written off if they never
--      come back. Exactly the redo's logic on the provider side.
--
-- TRUST BELONGS TO THE ADDRESS, NOT THE ACCOUNT. A customer of three years can
-- send somebody to an address they invented this morning; a customer of twenty
-- minutes is usually sending them to the flat they have lived in for a decade.
-- What costs a professional a wasted trip is a door nobody has ever opened.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Confirming the trip before anybody sets off
-- ---------------------------------------------------------------------------

/*
 * NOT A NEW BOOKING STATUS, deliberately.
 *
 * The obvious design is `awaiting_confirmation` before `pending`. It would
 * mean touching the status machine, its trigger, its RLS and the two-copy
 * check that keeps the TypeScript and SQL tables agreeing — a lot of surface
 * for a fact that is really about one column. The booking is `pending`; the
 * dispatch sweep simply declines to widen it while confirmation is owed.
 */
alter table public.bookings
  add column if not exists confirmation_required boolean not null default false;

alter table public.bookings
  add column if not exists confirmed_at timestamptz;

/** After this we stop holding and tell the customer nobody was sent. */
alter table public.bookings
  add column if not exists confirmation_hold_until timestamptz;

comment on column public.bookings.confirmed_at is
  'When the customer actively answered that they will be there. A passive timer is not an answer: the script that made twenty fake bookings will not answer either.';

create index if not exists bookings_awaiting_confirmation_idx
  on public.bookings (confirmation_hold_until)
  where confirmation_required and confirmed_at is null;

-- ---------------------------------------------------------------------------
-- The address, which is where the risk actually is
-- ---------------------------------------------------------------------------

/*
 * Counted rather than derived, because it is read on the dispatch path and an
 * upheld no-show is rare enough that a counter cannot drift far. Completed
 * jobs ARE derived — that number changes constantly and a stale copy of it
 * would quietly stop protecting anybody.
 */
alter table public.addresses
  add column if not exists upheld_no_shows smallint not null default 0;

alter table public.addresses
  add column if not exists first_confirmed_at timestamptz;

comment on column public.addresses.upheld_no_shows is
  'Trips wasted at this door. Takes "proven" away from an address that already worked once — otherwise a fake address is laundered by having one real job done there first, which is exactly how somebody would do it.';

-- ---------------------------------------------------------------------------
-- Arrival evidence
-- ---------------------------------------------------------------------------

create table if not exists public.booking_arrivals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique
    references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,

  arrived_at timestamptz not null default now(),

  /*
   * ROUNDED TO ABOUT A KILOMETRE, ON PURPOSE.
   *
   * This answers "was this person plausibly in the right part of the city" and
   * deliberately cannot answer "where exactly was this person at 9:14". We are
   * asking a professional to be located in order to support their own claim;
   * taking more precision than the claim needs would be taking something we
   * have no use for and would have to defend holding.
   */
  coarse_lat numeric(6, 2),
  coarse_lng numeric(6, 2),

  /** Filled in when they give up, not when they arrive. */
  gave_up_at timestamptz,
  waited_minutes smallint not null default 0 check (waited_minutes >= 0),
  contact_attempts smallint not null default 0 check (contact_attempts >= 0),

  created_at timestamptz not null default now()
);

comment on table public.booking_arrivals is
  'Where and when a professional says they turned up. Without this a no-show claim is one person''s word and we can act on neither side.';

create index if not exists booking_arrivals_provider_idx
  on public.booking_arrivals (provider_id, arrived_at desc);

-- ---------------------------------------------------------------------------
-- The claim, and the money
-- ---------------------------------------------------------------------------

create table if not exists public.no_show_claims (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique
    references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,

  /*
   * `needs_person` is a first-class outcome rather than a flavour of open.
   * There is no `refused_automatically` and there must never be one: the cost
   * of wrongly telling a professional they were not really there is that
   * professional.
   */
  status text not null default 'open' check (
    status in ('open', 'needs_person', 'upheld', 'refused')
  ),

  /** What we paid the professional. Paid on upholding, never conditional on recovery. */
  trip_rupees_paid integer not null default 0 check (trip_rupees_paid >= 0),
  /** What, if anything, the customer now owes. Often zero — the first is on us. */
  debt_rupees integer not null default 0 check (debt_rupees >= 0),

  /** The customer's side, if they said anything. */
  customer_disputed_at timestamptz,
  customer_note text check (char_length(customer_note) <= 1000),

  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text check (char_length(decision_reason) <= 2000),

  created_at timestamptz not null default now()
);

comment on table public.no_show_claims is
  'A professional arrived and nobody was there. We pay them from our own money when it is upheld; recovering it from the customer is our problem, not theirs.';

create index if not exists no_show_claims_queue_idx
  on public.no_show_claims (status, created_at)
  where status in ('open', 'needs_person');

create index if not exists no_show_claims_customer_idx
  on public.no_show_claims (customer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The customer's record
-- ---------------------------------------------------------------------------

create table if not exists public.customer_risk (
  profile_id uuid primary key references public.profiles (id) on delete cascade,

  no_shows smallint not null default 0 check (no_shows >= 0),
  false_addresses smallint not null default 0 check (false_addresses >= 0),
  completed_jobs integer not null default 0 check (completed_jobs >= 0),

  /*
   * Outstanding trip debt, in rupees. Recovered off a later bill at a capped
   * share, never chased as cash — we have no card on file and no instrument to
   * collect with, and a debt we cannot collect is a threat rather than a term.
   */
  trip_debt_rupees integer not null default 0 check (trip_debt_rupees >= 0),

  /*
   * A ban is the last tool and never the first. The ladder reaches a deposit
   * long before it reaches here, because a deposit lets somebody keep using
   * the platform while making the attack cost money.
   */
  banned_at timestamptz,
  banned_reason text check (char_length(banned_reason) <= 1000),

  updated_at timestamptz not null default now()
);

comment on table public.customer_risk is
  'No-shows, false addresses and trip debt per customer. Completed jobs are counted here too, because they retire strikes — without that the ladder is a ratchet and somebody with one bad week sits on the top rung for ever.';

/*
 * THE SAME KEYS AS THE PROVIDER SIDE, and for the same reason: a banned
 * customer coming back on a new number is the same attack as a removed
 * provider doing it, and a phone number costs a hundred rupees. Hashed, so a
 * leak of this table is not a leak of everybody's identity.
 */
create table if not exists public.customer_match_keys (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (
    kind in ('document', 'account', 'name', 'area', 'device', 'face')
  ),
  key_hash text not null check (char_length(key_hash) = 64),
  created_at timestamptz not null default now()
);

comment on table public.customer_match_keys is
  'Hashed identifiers for a customer. What stops a banned account returning on a new SIM — enforced by what is expensive to change, never by a phone number.';

create unique index if not exists customer_match_keys_unique_idx
  on public.customer_match_keys (profile_id, kind, key_hash);

create index if not exists customer_match_keys_lookup_idx
  on public.customer_match_keys (kind, key_hash);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.booking_arrivals enable row level security;
alter table public.no_show_claims enable row level security;
alter table public.customer_risk enable row level security;
alter table public.customer_match_keys enable row level security;

/*
 * A customer may see that somebody arrived, and when. That is not a courtesy —
 * it is the other half of the evidence, and somebody accused of not being
 * there has to be able to see what is being claimed.
 */
drop policy if exists "Both sides read the arrival" on public.booking_arrivals;
create policy "Both sides read the arrival"
  on public.booking_arrivals for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_arrivals.booking_id
        and b.customer_id = (select auth.uid())
    )
    or exists (
      select 1 from public.providers p
      where p.id = booking_arrivals.provider_id
        and p.profile_id = (select auth.uid())
    )
    or public.is_admin()
  );

drop policy if exists "Both sides read the claim" on public.no_show_claims;
create policy "Both sides read the claim"
  on public.no_show_claims for select to authenticated
  using (
    customer_id = (select auth.uid())
    or exists (
      select 1 from public.providers p
      where p.id = no_show_claims.provider_id
        and p.profile_id = (select auth.uid())
    )
    or public.is_admin()
  );

/*
 * A customer may read their own record. Somebody being asked for a deposit is
 * entitled to see the count it came from — a ladder nobody can read is a trap,
 * the same argument as the provider standards page.
 */
drop policy if exists "Customers read their own record" on public.customer_risk;
create policy "Customers read their own record"
  on public.customer_risk for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_admin());

-- Hashed already, and still nobody's business from a browser.
drop policy if exists "Admins read customer match keys" on public.customer_match_keys;
create policy "Admins read customer match keys"
  on public.customer_match_keys for select to authenticated
  using (public.is_admin());

/*
 * NO INSERT OR UPDATE POLICY ON ANY OF THE FOUR, for anybody.
 *
 * Every write goes through the service role after the server has checked who
 * is asking. A row a client could write is a row an attacker can forge, and
 * these are rows that move money and mark people. Same rule as `payments` and
 * `provider_documents`.
 */

-- ---------------------------------------------------------------------------
-- Confirmation is the customer's to give and nobody else's
-- ---------------------------------------------------------------------------

create or replace function public.enforce_confirmation_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service role is how the server writes; auth.uid() is null for it.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  /*
   * A CUSTOMER MAY CONFIRM, AND MAY NOT UN-REQUIRE.
   *
   * `bookings` already lets a customer update their own open booking, and RLS
   * is row-level — so without this they could simply write
   * `confirmation_required = false` from a browser and skip the whole gate.
   * The same shape as the bug that let a customer set their own final_amount.
   */
  if new.confirmation_required is distinct from old.confirmation_required then
    raise exception 'Whether a trip needs confirming is not the customer''s to set.';
  end if;

  if new.confirmed_at is distinct from old.confirmed_at
     and old.confirmed_at is not null
  then
    raise exception 'A confirmation cannot be rewritten.';
  end if;

  if new.confirmation_hold_until is distinct from old.confirmation_hold_until then
    raise exception 'The hold window is set by the server.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_confirmation_integrity() from public;

drop trigger if exists enforce_confirmation_integrity on public.bookings;
create trigger enforce_confirmation_integrity
  before update on public.bookings
  for each row execute function public.enforce_confirmation_integrity();
