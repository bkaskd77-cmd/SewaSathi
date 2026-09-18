-- The band the customer stated now sets the price, and the professional can
-- correct it before work starts.
--
-- WHAT WAS BROKEN, AND IT WAS OURS. The triage card asks which product a job is
-- and shows that product's published range — and then the number was lost at
-- the very first link. `/services/[slug]` rendered the CATEGORY band whatever
-- `?band=` said, and `createBooking` froze `quoted_max` from
-- `categories.base_price_max`. So somebody who answered "AC repair" read
-- 500-1,500 on the card and got a booking quoted 500-12,000, with the 2x
-- ceiling standing at 24,000. The band drove the calendar and nothing else.
-- "No surprises: the price is agreed before work starts" was true on one screen
-- and false on the next.
--
-- AND CLOSING IT IS WHAT CREATES THE INCENTIVE, which is why the correction
-- arrives in the same migration rather than after it. Once the stated band sets
-- the price, a customer has a reason to name a cheaper product than the one
-- they have. They are not the ones who will see the job.
--
-- SO THE BAND GETS DURATION'S SHAPE: three values that never collapse into one.
-- `band_slug` + `band_source` is what the customer said and is NEVER
-- overwritten; `provider_band_slug` is what the professional says after seeing
-- the job; `quoted_min`/`quoted_max` is what is in force. Keeping the first two
-- apart is what lets us ask later, per product, how far our published ranges
-- are from what the work actually is — which is the same reason
-- `provider_estimated_working_minutes` sits beside `estimated_working_minutes`
-- rather than replacing it.
--
-- THE SHAPE IS THE SURVEY MACHINE'S; THE COLUMNS ARE NOT. `enforce_survey_quote`
-- already does exactly this dance — a price arrives after the booking, the
-- customer approves it, an approved price freezes, and `in_progress` is refused
-- until they have agreed. But it early-returns for `quote_model <> 'survey'`
-- and, before it does, raises if a banded booking has grown any survey stamp,
-- because that would mean some other path had started treating it as a survey.
-- Writing a correction through `quote_approved_at` would make that guard
-- unwritable. A banded correction is genuinely not a survey, so it gets its own
-- columns and its own trigger, and each function keeps one reason to raise.

alter table public.bookings
  add column if not exists provider_band_slug text,
  add column if not exists provider_band_at timestamptz,
  add column if not exists provider_band_reason text,
  add column if not exists band_change_approved_at timestamptz,
  add column if not exists band_change_declined_at timestamptz;

-- The same composite key `band_slug` carries, so a correction naming a product
-- this trade does not sell is refused rather than stored. `set null` on delete
-- matches band_slug's: a retired product must not take the booking with it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_provider_band_slug_fkey'
  ) then
    alter table public.bookings
      add constraint bookings_provider_band_slug_fkey
      foreign key (category_slug, provider_band_slug)
      references public.category_price_bands (category_slug, slug)
      on delete set null (provider_band_slug);
  end if;
end $$;

-- A correction cannot be both agreed and refused.
alter table public.bookings
  drop constraint if exists bookings_band_change_one_answer;
alter table public.bookings
  add constraint bookings_band_change_one_answer
  check (band_change_approved_at is null or band_change_declined_at is null);

-- An answer with nothing to answer is a fact about nothing.
alter table public.bookings
  drop constraint if exists bookings_band_change_needs_a_correction;
alter table public.bookings
  add constraint bookings_band_change_needs_a_correction
  check (
    provider_band_slug is not null
    or (band_change_approved_at is null and band_change_declined_at is null)
  );

comment on column public.bookings.provider_band_slug is
  'The product the professional says this job actually is, after seeing it. Stored beside the customer''s statement, never over it: keeping both is how we later learn, per product, how far a published range sits from the work. Only in force once the customer has agreed to it.';

comment on column public.bookings.provider_band_reason is
  'Why the professional says the product is different. Same rule as final_amount_reason: a figure that moves needs a sentence, and a dispute needs both sides on the record.';

comment on column public.bookings.band_change_approved_at is
  'When the customer agreed to the corrected product. Until it is set, enforce_price_correction refuses in_progress — the price is agreed BEFORE work starts, which is the promise this column makes structural.';

-- ---------------------------------------------------------------------------
-- Which bounds are in force
-- ---------------------------------------------------------------------------
--
-- ONE DEFINITION, because four things read it: the insert path, the hand-off
-- trigger, the correction trigger, and `lib/booking/band-bounds.ts` which
-- mirrors it for the screens. A second implementation of "what does this job
-- cost" is a second answer, and the two diverge on exactly the booking nobody
-- is looking at.
--
-- `stated_low` is returned alongside because the floor rule needs it: a
-- correction may raise the band and may lower the max, but the floor never goes
-- below what the customer's own statement set. The fee is charged on
-- `max(final_amount, quoted_min)` and that is the whole answer to
-- under-reporting; letting a correction lower it would reopen the same payoff
-- through a different door.
--
-- ONLY A CUSTOMER-STATED BAND NARROWS. A model- or matcher-named band is our
-- reading of somebody's sentence, and trusting its slug over its own number
-- would make the price wrong rather than merely wide. That was decided when the
-- ask shipped and this is where it is enforced.

create or replace function public.booking_band_bounds(
  p_category_slug text,
  p_band_slug text,
  p_band_source text,
  p_provider_band_slug text,
  p_approved_at timestamptz
)
returns table (low integer, high integer, stated_low integer)
language sql
stable
security definer
set search_path = ''
as $$
  with stated as (
    select b.low, b.high
      from public.category_price_bands b
     where p_band_source = 'customer'
       and p_band_slug is not null
       and b.category_slug = p_category_slug
       and b.slug = p_band_slug
  ),
  corrected as (
    select b.low, b.high
      from public.category_price_bands b
     where p_approved_at is not null
       and p_provider_band_slug is not null
       and b.category_slug = p_category_slug
       and b.slug = p_provider_band_slug
  ),
  cat as (
    select c.base_price_min as low, c.base_price_max as high
      from public.categories c
     where c.slug = p_category_slug
  )
  select
    coalesce((select c.low from corrected c), (select s.low from stated s), (select x.low from cat x)),
    coalesce((select c.high from corrected c), (select s.high from stated s), (select x.high from cat x)),
    coalesce((select s.low from stated s), (select x.low from cat x));
$$;

comment on function public.booking_band_bounds(text, text, text, text, timestamptz) is
  'The price bounds in force for a booking: an approved correction first, then the customer''s own stated product, then the trade''s whole band. Also returns the floor the customer''s statement set, which a correction may never go below.';

revoke execute on function public.booking_band_bounds(text, text, text, text, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The floor, now band-aware
-- ---------------------------------------------------------------------------
--
-- REBUILT FROM THE LIVE DEFINITION read out of pg_proc, not from
-- 20260913000002 above it. Three things in the original are load-bearing and
-- are kept verbatim: the survey early-return (a surveyed price is not derived
-- from anybody's dashboard rate), the settled-booking early-return (history is
-- not rewritten), and the `least(greatest(...))` clamp — a multi-trade
-- professional may legally sit at Rs 25,000 against the UNION of their bands,
-- so taking the rate raw would write quoted_min above quoted_max and the
-- table's own check constraint would refuse it.
--
-- WHAT CHANGED: the two `categories` reads become `booking_band_bounds`, and
-- an approved correction is now a reason to fire. It used to watch only
-- `provider_id`, because a hand-off was the only thing that could move the
-- floor. A correction moves it too, and the recompute has to live here rather
-- than at the call site for the same reason it always did — a job changes hands
-- four ways and a fifth writer is a fifth chance to forget.

create or replace function public.sync_booking_quote_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  band_low integer;
  band_high integer;
  stated_low integer;
  rate integer;
begin
  if new.provider_id is not distinct from old.provider_id
     and new.band_change_approved_at is not distinct from old.band_change_approved_at then
    return new;
  end if;

  -- A surveyed price is not derived from anybody's dashboard rate.
  if new.quote_model = 'survey' then
    return new;
  end if;

  if old.final_amount is not null
     or old.completed_at is not null
     or old.payment_status is distinct from 'unpaid' then
    return new;
  end if;

  select b.low, b.high, b.stated_low
    into band_low, band_high, stated_low
    from public.booking_band_bounds(
      new.category_slug,
      new.band_slug,
      new.band_source,
      new.provider_band_slug,
      new.band_change_approved_at
    ) b;

  if band_low is null then
    return new;
  end if;

  /*
   * THE CEILING MOVES WITH THE BAND IN FORCE. It did not exist here before —
   * quoted_max was written once at insert and never again, because the trade's
   * band could not change. An approved correction changes which product this
   * is, and the 2x ceiling in `judgeFinalAmount` is measured off this number:
   * leaving it on the customer's understated product is exactly how an honest
   * overrun becomes unapprovable in the app.
   *
   * `band_min` moves with it for a different reason. It is OUR floor and
   * `lib/data/pricing-signals.ts` measures settled amounts against it to find
   * our own mispricing; comparing a sub-band job against a category floor would
   * make a whole trade look like it is bunching under a price nobody quoted.
   */
  new.quoted_max := band_high;
  new.band_min := band_low;

  if new.provider_id is null then
    -- Unheld. The floor goes back to ours: a departed professional's price is
    -- not a promise about whoever comes next.
    new.quoted_min := greatest(band_low, stated_low);
    return new;
  end if;

  select p.base_rate into rate
    from public.providers p
   where p.id = new.provider_id;

  /*
   * NEVER BELOW WHAT THE CUSTOMER'S OWN STATEMENT SET. The fee is charged on
   * `max(final_amount, quoted_min)` and that is the entire answer to
   * under-reporting: the band is ours and frozen, so reporting less earns
   * nothing. A correction that could lower this floor would reopen the same
   * payoff through a different door — the professional names a cheaper product
   * instead of a smaller number. An honest small job appeals through
   * `commission_appeals`, which is a person looking, not a rule to be gamed.
   */
  new.quoted_min := greatest(
    stated_low,
    least(greatest(band_low, coalesce(rate, band_low)), band_high)
  );
  return new;
end;
$$;

comment on function public.sync_booking_quote_floor() is
  'Keeps a booking''s quote on the band in force — an approved correction, else the customer''s stated product, else the trade''s whole band — with the floor at the holding professional''s starting price and never below what the customer''s own statement set. Fires on a hand-off and on a correction being agreed.';

revoke execute on function public.sync_booking_quote_floor() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The correction itself
-- ---------------------------------------------------------------------------
--
-- THE RULE THIS FUNCTION EXISTS FOR: the customer sees the re-narrowed price
-- BEFORE work starts, not at settlement. Everything else here serves that.
--
-- Deliberately NOT `enforce_survey_quote`. That function early-returns for a
-- banded booking and, before it does, raises if one has grown a survey stamp —
-- "some other code path had started treating it as one". Reusing its columns
-- would make that guard unwritable. Same shape, own columns, one reason each
-- to raise.

create or replace function public.enforce_price_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  corrected_high integer;
  stated_low integer;
begin
  -- A survey job has no published product to correct; its whole price arrives
  -- after the visit and `enforce_survey_quote` owns that path.
  if new.quote_model = 'survey' then
    if new.provider_band_slug is not null then
      raise exception 'A surveyed job has no product band to correct'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  /*
   * THE CUSTOMER'S STATEMENT IS NEVER OVERWRITTEN. This is the same rule
   * `provider_estimated_working_minutes` follows beside
   * `estimated_working_minutes`: keeping both is what lets us ask later, per
   * product, how far a published range sits from the work. A correction that
   * edited `band_slug` would destroy the only evidence of the disagreement.
   */
  if tg_op = 'UPDATE'
     and new.band_slug is distinct from old.band_slug
     and old.provider_band_slug is not null then
    raise exception 'A correction records what the professional says, it does not rewrite what the customer said'
      using errcode = 'check_violation';
  end if;

  -- A figure that moves needs a sentence. Same rule as final_amount_reason,
  -- and for the same reason: a dispute needs both sides on the record.
  if new.provider_band_slug is not null
     and coalesce(btrim(new.provider_band_reason), '') = '' then
    raise exception 'A corrected product needs a reason'
      using errcode = 'check_violation';
  end if;

  -- An answer nobody asked for.
  if (new.band_change_approved_at is not null or new.band_change_declined_at is not null)
     and new.provider_band_at is null then
    raise exception 'There is no correction to answer'
      using errcode = 'check_violation';
  end if;

  /*
   * A CORRECTION MAY NOT PRICE THE JOB BELOW WHAT THE CUSTOMER SAID IT WAS.
   * The floor rule in sync_booking_quote_floor holds quoted_min at the stated
   * product's low; a correction whose whole range sits under that would put
   * quoted_min above quoted_max and the table's own check would refuse the
   * write with a message about nothing. Refused here, with the reason.
   */
  if new.provider_band_slug is not null then
    select b.high, b.stated_low into corrected_high, stated_low
      from public.booking_band_bounds(
        new.category_slug, new.band_slug, new.band_source,
        new.provider_band_slug, now()
      ) b;

    if corrected_high is not null and stated_low is not null
       and corrected_high < stated_low then
      raise exception 'A correction cannot price this job below what the customer said it was'
        using errcode = 'check_violation';
    end if;
  end if;

  /*
   * AN AGREED PRICE IS FROZEN, the same rule enforce_survey_quote keeps for a
   * surveyed one. The customer agreed to a figure and the 2x ceiling is
   * measured off it; letting the product be rewritten afterwards would move
   * that ceiling out from under an approval given for something else.
   */
  if tg_op = 'UPDATE'
     and old.band_change_approved_at is not null
     and new.provider_band_slug is distinct from old.provider_band_slug then
    raise exception 'An agreed price cannot be rewritten'
      using errcode = 'check_violation';
  end if;

  /*
   * AND THE ONE THE WHOLE FILE IS FOR. Work starting is the point after which
   * money is owed. A correction the customer has not answered must not be
   * reachable past it — otherwise the re-narrowed price arrives at settlement,
   * with the professional standing in their kitchen, which is the exact
   * position `lib/payments/pricing.ts` exists to keep people out of.
   */
  if new.status = 'in_progress'
     and (tg_op = 'INSERT' or old.status is distinct from 'in_progress')
     and new.provider_band_at is not null
     and new.band_change_approved_at is null
     and new.band_change_declined_at is null then
    raise exception 'The customer has not answered the corrected price'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_price_correction() is
  'A professional may say a job is a different product than the customer named, with a reason; the customer must agree before work starts. The customer''s own statement is never overwritten, an agreed price is frozen, and a correction may not price the job below what the customer said it was.';

revoke execute on function public.enforce_price_correction() from public, anon, authenticated;

-- THE TRIGGER NAME IS LOAD-BEARING, and the first name was wrong. Postgres
-- fires BEFORE triggers in alphabetical order, so this has to sit between two
-- others:
--
--   AFTER  `bookings_enforce_immutability`, because a browser must be told it
--          may not write these columns at all, not coached on how to write
--          them correctly. Named `bookings_enforce_band_correction` first,
--          which sorts BEFORE it, and a customer poking at the column got
--          "A corrected product needs a reason" — a validation message on a
--          write that was never going to be allowed. The db suite caught it.
--   BEFORE `bookings_sync_quote_floor`, because the floor recompute must only
--          ever see a correction this function has already accepted.
--
-- 'enforce_p...' sorts after 'enforce_i...' and before 'sync_...'. If that ever
-- inverts the symptom is a confusing message rather than a failure, which is
-- why the ordering is asserted in tests/db rather than trusted.
drop trigger if exists bookings_enforce_band_correction on public.bookings;
drop trigger if exists bookings_enforce_price_correction on public.bookings;
create trigger bookings_enforce_price_correction
  before insert or update on public.bookings
  for each row execute function public.enforce_price_correction();

-- ---------------------------------------------------------------------------
-- The browser may not write any of it
-- ---------------------------------------------------------------------------
--
-- REBUILT FROM THE LIVE DEFINITION read out of pg_proc, never from the
-- migration files above it. `create or replace` takes the text you paste, not
-- the text that is there, and this function has been a near-miss twice: once it
-- would have dropped the `provider_serves` coverage guard and once the
-- `booking_refusals` check. Both are below, unchanged, and
-- `tests/db/guard-clauses.test.ts` asserts every clause in here still exists.
--
-- ONE NEW BLOCK, WITH ITS OWN SENTENCE. The correction columns are NOT appended
-- to the duration block: that one raises "How long a job takes is not a
-- browser's to set", which is the wrong thing to tell somebody who just tried
-- to approve a price. A customer must not be able to stamp their own approval
-- and a professional must not be able to stamp the customer's — both go through
-- server actions that re-read who is asking.

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

  if new.quote_model is distinct from old.quote_model
     or new.surveyed_at is distinct from old.surveyed_at
     or new.quote_expires_at is distinct from old.quote_expires_at
     or new.quote_approved_at is distinct from old.quote_approved_at
     or new.quote_declined_at is distinct from old.quote_declined_at then
    raise exception 'A surveyed price is recorded by the server, not a browser'
      using errcode = 'check_violation';
  end if;

  if new.overbook_offered_by is distinct from old.overbook_offered_by
     or new.overbook_offered_at is distinct from old.overbook_offered_at
     or new.overbook_missed_at is distinct from old.overbook_missed_at then
    raise exception 'An overbooking offer is the professional''s to make, not a browser''s'
      using errcode = 'check_violation';
  end if;

  if new.band_slug is distinct from old.band_slug
     or new.band_source is distinct from old.band_source
     or new.estimated_working_minutes is distinct from old.estimated_working_minutes
     or new.estimated_elapsed_days is distinct from old.estimated_elapsed_days
     or new.provider_estimated_working_minutes is distinct from old.provider_estimated_working_minutes
     or new.provider_estimated_elapsed_days is distinct from old.provider_estimated_elapsed_days
     or new.actual_working_minutes is distinct from old.actual_working_minutes
     or new.duration_implausible_at is distinct from old.duration_implausible_at then
    raise exception 'How long a job takes is not a browser''s to set'
      using errcode = 'check_violation';
  end if;

  if new.provider_band_slug is distinct from old.provider_band_slug
     or new.provider_band_at is distinct from old.provider_band_at
     or new.provider_band_reason is distinct from old.provider_band_reason
     or new.band_change_approved_at is distinct from old.band_change_approved_at
     or new.band_change_declined_at is distinct from old.band_change_declined_at then
    raise exception 'A corrected price is agreed through the app, not written from a browser'
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

revoke execute on function public.enforce_booking_immutability() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- band_min is frozen from the band in force, not from the trade
-- ---------------------------------------------------------------------------
--
-- REBUILT FROM THE LIVE DEFINITION, AT THE SECOND ATTEMPT. The first one was
-- built from `20260913000003_band_provenance.sql` — and there are THREE
-- definitions of this function in the tree. Filename order decides which is
-- live, and the live one came from `20260916000001_survey_quotes.sql`. Reading
-- the oldest dropped both of its survey guards, and it shipped:
--
--   * INSERT: a survey booking must get `band_min := null`. Nothing has been
--     surveyed, so there is no floor of OURS to freeze. Without it the read
--     below falls through to movers-packers' stale 5,000 category row — the
--     exact invented figure the survey-pricing phase existed to keep off a
--     booking.
--   * UPDATE: the write-through that lets a surveyed floor land. Without it the
--     frozen null outlives the survey that replaced it and a surveyed job never
--     gets our floor at all.
--
-- `band_min` is OUR floor at booking time and `lib/data/pricing-signals.ts`
-- measures settled amounts against it to find our own wrong prices. Filled from
-- the category, a customer-stated `pipe-work` job would be compared against
-- plumbing's 350 and a whole trade would look like it was bunching under a
-- price nobody was ever quoted. Hence the bounds read — and ONLY on the insert
-- path, which is the whole of what this migration changes here.
--
-- The UPDATE pin still means what it said: every ordinary status write would
-- otherwise have to know this column exists. `sync_booking_quote_floor` sorts
-- after this one ('s' after 'f') and is what moves it when a correction is
-- agreed. That ordering is not asserted directly — the db suite asserts the
-- BEHAVIOUR, that band_min narrows at insert and again on an approved
-- correction, which is what must stay true however the triggers are named.

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

  select b.low into floor_now
    from public.booking_band_bounds(
      new.category_slug,
      new.band_slug,
      new.band_source,
      new.provider_band_slug,
      new.band_change_approved_at
    ) b;

  -- quoted_min as the last resort rather than null: a category row missing
  -- behind a foreign key should not be able to break a booking.
  new.band_min := coalesce(floor_now, new.quoted_min);
  return new;
end;
$$;

comment on function public.freeze_booking_band() is
  'Fills bookings.band_min from the band in force at insert — the customer''s stated product where they named one, else the trade, and null on a survey job because nothing has been surveyed yet — and pins it on update, letting a surveyed floor write through. The published floor at booking time, kept so the pricing signal can ask whether OUR band was right.';

revoke execute on function public.freeze_booking_band() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A declined correction is a trip made for nothing
-- ---------------------------------------------------------------------------
--
-- Cancelling is free until work begins — that is the policy and it is not
-- changing. So a professional who arrives, finds a burst pipe where "inspection
-- only" was booked, and says so honestly can have the customer walk away, with
-- the trip already made. Left unpaid, the lesson everybody learns is to START
-- THE WORK FIRST and correct at settlement, which is the exact thing this whole
-- mechanism exists to prevent.
--
-- `survey_visit_fees` is already the right shape: born `pending`, refused
-- without a `booking_arrivals` row (no trip, no fee), released only by a
-- person, and the monthly cap counts approved rows only so a queue of honest
-- declines never blocks a real claim. A third outcome rather than reusing
-- 'declined': a surveyed quote turned down and a corrected product turned down
-- are different events, and a report that cannot tell them apart is a report
-- that will be read wrong.
--
-- The unique-per-booking constraint cannot collide: `enforce_price_correction`
-- refuses a correction on a survey job outright, so no booking can generate
-- both kinds.

alter table public.survey_visit_fees
  drop constraint if exists survey_visit_fees_outcome_check;
alter table public.survey_visit_fees
  add constraint survey_visit_fees_outcome_check
  check (outcome in ('declined', 'expired', 'band-declined'));

comment on column public.survey_visit_fees.outcome is
  'What the trip ended in: the customer declined a surveyed quote, the quote expired unanswered, or the customer declined a corrected product on a banded job. Three events, kept apart because a report that conflates them will be read wrong.';
