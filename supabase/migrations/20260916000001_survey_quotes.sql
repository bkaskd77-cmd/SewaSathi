-- A trade whose price does not exist until somebody has looked.
--
-- Movers and packers is the case and it is a FINDING, not a gap: no Nepali
-- operator publishes a figure, every one quotes after a survey, and inventing a
-- range would fabricate the one number the market itself refuses to state.
--
-- WHY THIS IS A SCHEMA CHANGE AND NOT A SCREEN CHANGE. `judgeFinalAmount`
-- measures the 2x overcharge ceiling off `quoted_max`. A booking with no band
-- therefore has no ceiling — exactly the protection that stops a mistyped extra
-- zero turning 15,000 into 150,000. So the band has to exist, and the customer
-- has to have agreed to it, before any work can start. After that every money
-- rule in the product reads a real band and not one of them changes.
--
-- AND THE SURVEY VISIT IS A BOOKING. A real professional at a real door at a
-- real time. A separate table would mean building dispatch, live tracking,
-- cancellation and the no-show flow a second time and reconciling the two for
-- ever.

-- ---------------------------------------------------------------------------
-- Which kind of quote this booking carries
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists quote_model text not null default 'band'
    check (quote_model in ('band', 'survey')),
  add column if not exists surveyed_at timestamptz,
  add column if not exists quote_expires_at timestamptz,
  add column if not exists quote_approved_at timestamptz,
  add column if not exists quote_declined_at timestamptz;

comment on column public.bookings.quote_model is
  'Frozen from categories.pricing_model at booking time. `band` carries a published range from the moment it is made; `survey` has no band until somebody has been to look. Frozen, like the band itself: changing how a category is priced next month must not rewrite what somebody already agreed to.';
comment on column public.bookings.quote_expires_at is
  'When the surveyed price stops being honourable — QUOTE_VALID_HOURS after the survey. Stamped rather than recomputed, so changing that constant never moves a deadline somebody was already given.';

-- ---------------------------------------------------------------------------
-- The band becomes nullable, and a constraint makes that impossible elsewhere
-- ---------------------------------------------------------------------------
--
-- A NULLABLE MONEY COLUMN IS THE THING THAT LEAKS. Three phases from now
-- somebody writes a code path that reads `quoted_min` and gets null on a row
-- they never imagined, and nothing tells them. So the rule that a null band
-- exists ONLY on a survey booking is a check constraint, not a convention —
-- the database refuses the row rather than the reviewer catching it.
--
-- The existing `quoted_min > 0` and `quoted_max >= quoted_min` checks already
-- pass on null (an unknown comparison is not false) and are left alone.

alter table public.bookings
  alter column quoted_min drop not null,
  alter column quoted_max drop not null;

alter table public.bookings
  drop constraint if exists bookings_band_only_null_for_survey;
alter table public.bookings
  add constraint bookings_band_only_null_for_survey check (
    quote_model = 'survey'
    or (quoted_min is not null and quoted_max is not null)
  );

-- `band_min` is OUR floor, frozen at booking time so `category_pricing_signals`
-- can later ask whether a whole trade is mispriced. On a survey booking our
-- floor is the surveyed one, which does not exist until somebody has been — so
-- it follows the band's nullability, under the same rule and for the same
-- reason. 20260913000003 made it not-null when every booking was guaranteed a
-- band; that guarantee is what has just changed.
alter table public.bookings
  alter column band_min drop not null;

alter table public.bookings
  drop constraint if exists bookings_floor_only_null_for_survey;
alter table public.bookings
  add constraint bookings_floor_only_null_for_survey check (
    quote_model = 'survey' or band_min is not null
  );

-- A half-written band is not a band. One column set and the other null would
-- pass every rule above and break the first thing that reads a range.
alter table public.bookings
  drop constraint if exists bookings_band_is_a_pair;
alter table public.bookings
  add constraint bookings_band_is_a_pair check (
    (quoted_min is null) = (quoted_max is null)
  );

-- ---------------------------------------------------------------------------
-- Guard one of two: work cannot start on a price nobody agreed to
-- ---------------------------------------------------------------------------
--
-- The other guard is in `lib/payments` and `lib/booking/survey.ts`, and neither
-- is allowed to be the only one. This is the money path: a rule the application
-- owns alone is a rule the application can forget, and a rule only the database
-- owns produces an exception where a sentence was needed.

create or replace function public.enforce_survey_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * THE MODEL IS FROZEN, AND THIS IS CHECKED FIRST. It used to sit below the
   * band-booking early return, which meant a survey booking flipping itself to
   * `band` took the band branch, found no survey stamps and sailed through —
   * the one move this is supposed to stop was the one move it could not see.
   */
  if tg_op = 'UPDATE' and new.quote_model is distinct from old.quote_model then
    raise exception 'A booking cannot change how it is priced'
      using errcode = 'check_violation';
  end if;

  -- A band booking had its band before it existed. Nothing here applies.
  if new.quote_model <> 'survey' then
    -- ...except that a band booking must never grow survey stamps, which would
    -- mean some other code path had started treating it as one.
    if new.surveyed_at is not null
       or new.quote_expires_at is not null
       or new.quote_approved_at is not null
       or new.quote_declined_at is not null then
      raise exception 'A banded booking has no survey to record'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- AN APPROVED PRICE IS FROZEN. The customer agreed to a figure and the 2x
  -- ceiling is measured off it; letting it be rewritten afterwards would move
  -- the ceiling out from under an approval that was given for something else.
  if tg_op = 'UPDATE'
     and old.quote_approved_at is not null
     and (new.quoted_min is distinct from old.quoted_min
          or new.quoted_max is distinct from old.quoted_max) then
    raise exception 'An approved price cannot be rewritten'
      using errcode = 'check_violation';
  end if;

  -- An approval means nothing without something to approve.
  if new.quote_approved_at is not null
     and (new.quoted_min is null or new.quoted_max is null) then
    raise exception 'There is no price to approve yet'
      using errcode = 'check_violation';
  end if;

  -- THE RULE THIS FILE EXISTS FOR. Work starting is the point after which money
  -- is owed, and it must not be reachable on a booking whose band is missing or
  -- whose band nobody has agreed to.
  if new.status = 'in_progress'
     and (tg_op = 'INSERT' or old.status is distinct from 'in_progress') then
    if new.quoted_min is null or new.quoted_max is null then
      raise exception 'Nobody has surveyed this job yet'
        using errcode = 'check_violation';
    end if;
    if new.quote_approved_at is null then
      raise exception 'The customer has not agreed to this price'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_survey_quote()
  from public, anon, authenticated;

-- Sorts after `bookings_enforce_slot_capacity` and before
-- `bookings_enforce_transition`; it only ever raises, so the position is not
-- load-bearing, but the name says where it sits. Trigger order in Postgres is
-- alphabetical.
drop trigger if exists bookings_enforce_survey_quote on public.bookings;
create trigger bookings_enforce_survey_quote
  before insert or update on public.bookings
  for each row execute function public.enforce_survey_quote();

-- ---------------------------------------------------------------------------
-- The survey stamps are not the browser's to write
-- ---------------------------------------------------------------------------
--
-- Same reason as the overbooking offer, same mechanism. RLS is row-level, so
-- "customers cancel their own open bookings" makes every column on the row
-- writable — including, without this, the approval timestamp that the whole
-- price ceiling hangs from. `auth.uid()` is null for the service role, which is
-- how the customer's actual approval (written in lib/data after an RLS read
-- proves the booking is theirs) passes through.
--
-- REBUILT FROM THE CURRENT DEFINITION, NOT FROM AN OLDER MIGRATION. Doing the
-- latter silently dropped every settlement check the day before; `create or
-- replace` takes the version you paste, not the version that is there.

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
     or new.commission_basis is distinct from old.commission_basis
     or new.commission_floor_waived is distinct from old.commission_floor_waived
     or new.customer_reported_amount is distinct from old.customer_reported_amount
     or new.amount_mismatch_at is distinct from old.amount_mismatch_at
     or new.payout_due_at is distinct from old.payout_due_at
     or new.payment_status is distinct from old.payment_status then
    raise exception 'Prices and payment state are not editable from a browser'
      using errcode = 'check_violation';
  end if;

  -- The survey and its approval. The approval is the customer's to give, but
  -- through the action that re-reads the booking and stamps it server-side —
  -- not by writing a timestamp from a browser onto a price nobody surveyed.
  if new.quote_model is distinct from old.quote_model
     or new.surveyed_at is distinct from old.surveyed_at
     or new.quote_expires_at is distinct from old.quote_expires_at
     or new.quote_approved_at is distinct from old.quote_approved_at
     or new.quote_declined_at is distinct from old.quote_declined_at then
    raise exception 'A surveyed price is recorded by the server, not a browser'
      using errcode = 'check_violation';
  end if;

  if new.overbook_offered_by is distinct from old.overbook_offered_by
     or new.overbook_offered_at is distinct from old.overbook_offered_at then
    raise exception 'An overbooking offer is the professional''s to make, not a browser''s'
      using errcode = 'check_violation';
  end if;

  if new.provider_id is distinct from old.provider_id
     and old.provider_id is not null
     and new.provider_id is not null then
    raise exception 'A booking that is already assigned cannot be reassigned'
      using errcode = 'check_violation';
  end if;

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

-- The sweep that expires a stale quote reads this.
create index if not exists bookings_quote_expiry_idx
  on public.bookings (quote_expires_at)
  where quote_model = 'survey'
    and quote_approved_at is null
    and quote_declined_at is null
    and status in ('pending', 'accepted', 'en_route');

-- ---------------------------------------------------------------------------
-- The two triggers that assumed every booking has a band
-- ---------------------------------------------------------------------------
--
-- Both were written when a band was guaranteed by a NOT NULL, and both would
-- now quietly invent one for a survey booking out of the movers row's leftover
-- numbers — the exact figure this whole change exists to stop publishing.

-- `sync_booking_quote_floor` rewrites quoted_min from the assigned
-- professional's own rate, clamped into the category band. On a survey booking
-- there is no band to clamp into and no floor to write: the surveyor's visit is
-- what produces both.
create or replace function public.sync_booking_quote_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  band_low integer;
  band_high integer;
  rate integer;
begin
  if new.provider_id is not distinct from old.provider_id then
    return new;
  end if;

  -- A surveyed price is not derived from anybody's dashboard rate. Writing one
  -- here would give a movers booking a floor built from a published band that
  -- no operator in the market actually quotes.
  if new.quote_model = 'survey' then
    return new;
  end if;

  if old.final_amount is not null
     or old.completed_at is not null
     or old.payment_status is distinct from 'unpaid' then
    return new;
  end if;

  select c.base_price_min, c.base_price_max
    into band_low, band_high
    from public.categories c
   where c.slug = new.category_slug;

  if band_low is null then
    return new;
  end if;

  if new.provider_id is null then
    new.quoted_min := band_low;
    return new;
  end if;

  select p.base_rate into rate
    from public.providers p
   where p.id = new.provider_id;

  new.quoted_min := least(greatest(band_low, coalesce(rate, band_low)), band_high);
  return new;
end;
$$;

revoke execute on function public.sync_booking_quote_floor()
  from public, anon, authenticated;

-- `freeze_booking_band` stamps OUR floor at booking time, which
-- `category_pricing_signals` later reads to ask whether a whole trade is
-- mispriced. For a survey booking our floor is the surveyed one, so it is
-- stamped when the survey lands rather than invented at insert — and the
-- UPDATE branch has to let that one write through, or the frozen null would
-- outlive the survey that replaced it.
create or replace function public.freeze_booking_band()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  floor_now integer;
begin
  if tg_op = 'UPDATE' then
    if new.quote_model = 'survey'
       and old.band_min is null
       and new.quoted_min is not null then
      new.band_min := new.quoted_min;
    else
      new.band_min := old.band_min;
    end if;
    return new;
  end if;

  -- Nothing has been surveyed yet, so there is no floor of ours to freeze.
  if new.quote_model = 'survey' then
    new.band_min := null;
    return new;
  end if;

  if new.band_min is not null then
    return new;
  end if;

  select c.base_price_min into floor_now
    from public.categories c
   where c.slug = new.category_slug;

  new.band_min := coalesce(floor_now, new.quoted_min);
  return new;
end;
$$;

revoke execute on function public.freeze_booking_band()
  from public, anon, authenticated;
