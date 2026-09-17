-- The booking learns which product it is, and therefore how long it takes.
--
-- WHAT WAS MISSING. `category_price_bands` has held 36 products since
-- 2026-09-15 — a researched price per product, because a category band
-- spanning 10-13x cannot carry "no surprises". But no booking ever recorded
-- WHICH of those products it was quoted from. The sub-band was inferred at
-- triage time, shown to the customer as a narrowed range, and thrown away. So
-- the most specific thing we knew about a job did not survive the booking.
--
-- That is why `category_pricing_signals` can only measure a whole trade, and
-- it is why painting's bimodality — a 1,000 touch-up and a 40,000 flat in one
-- band — is invisible to every number we compute. `band_slug` closes it.
--
-- AND IT IS WHAT MAKES DURATION POSSIBLE WITHOUT INVENTING ONE. Naming the
-- product is the same lookup as reading its researched length, so nothing has
-- to guess how long a job will take: triage picks a labelled product and the
-- duration comes with it. A model asked "how many days" invents a number, and
-- an invented number that looks measured is exactly what rule 6 names.
--
-- NULL IS A REAL ANSWER AND NOTHING IS BACKFILLED. "I need a painter" does not
-- say whether that is a touch-up or a whole flat. Nine of the fourteen keyword
-- rules name no product for the same reason, and the model is told plainly
-- that null beats a guess. A booking with no band gets no estimate, and the
-- scheduler has a defined answer for that (see UNESTIMATED_HOLD_MINUTES in
-- lib/booking/capacity.ts) which is exactly the behaviour it has today.

-- ---------------------------------------------------------------------------
-- Which product, and how long we think it takes
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists band_slug text,
  add column if not exists estimated_working_minutes integer
    check (estimated_working_minutes is null or estimated_working_minutes > 0),
  add column if not exists estimated_elapsed_days integer
    check (estimated_elapsed_days is null or estimated_elapsed_days between 1 and 30),
  -- THE PROFESSIONAL'S OWN FIGURE, BESIDE OURS AND NEVER OVER IT. They have
  -- seen the job and we have not, so they may correct it — but overwriting the
  -- sub-band's estimate would destroy the only comparison that ever makes the
  -- researched numbers better. Two columns, so "what we published" and "what
  -- somebody standing in the room said" stay separable for ever.
  add column if not exists provider_estimated_working_minutes integer
    check (provider_estimated_working_minutes is null
           or provider_estimated_working_minutes > 0),
  add column if not exists provider_estimated_elapsed_days integer
    check (provider_estimated_elapsed_days is null
           or provider_estimated_elapsed_days between 1 and 30),
  -- WHAT ACTUALLY HAPPENED, which is the third and last column in the chain
  -- and the one that eventually turns duration_source from `researched` into
  -- `observed` — the same path pricing_source already has.
  add column if not exists actual_working_minutes integer
    check (actual_working_minutes is null or actual_working_minutes > 0),
  -- A COMPLETION TOO FAST TO BE WORK. Recorded as a fact rather than written
  -- into the number above, because the first evidence this product ever
  -- collects about duration would otherwise be poisoned by our own test
  -- accounts: all four completed bookings in the live database at the time
  -- this shipped had started_at and completed_at three to twenty-nine SECONDS
  -- apart. A three-second job is a walkthrough, not a fast plumber, and 0
  -- looks measured.
  add column if not exists duration_implausible_at timestamptz;

-- The product has to be one this trade actually sells. A composite key rather
-- than a plain text column, so painting's `flat` can never end up on a
-- plumbing job — the one failure that would make every signal reading this
-- column quietly wrong rather than loudly broken.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_band_slug_fkey'
  ) then
    alter table public.bookings
      add constraint bookings_band_slug_fkey
      foreign key (category_slug, band_slug)
      references public.category_price_bands (category_slug, slug)
      -- SET NULL ON band_slug ONLY. category_slug is NOT NULL, so a bare
      -- `on delete set null` would try to null both columns and the delete
      -- would fail. Retiring a product must not take the booking with it.
      on delete set null (band_slug);
  end if;
end
$$;

comment on column public.bookings.band_slug is
  'Which product inside the trade, from category_price_bands. Null when nobody could tell — an ordinary answer, not a failure. It is what lets a booking know its own length without anybody inventing one, and what lets pricing signals see inside a trade for the first time.';
comment on column public.bookings.estimated_working_minutes is
  'How long the professional is expected to be on the tools, copied from the sub-band at booking time and frozen there like band_min beside it. Null when no product was identified.';
comment on column public.bookings.estimated_elapsed_days is
  'How many days the customer''s home is expected to be a building site. 1 for nine trades; painting is why it exists.';
comment on column public.bookings.provider_estimated_working_minutes is
  'THE PROFESSIONAL''S CORRECTION, NEVER OVERWRITING OURS. They have seen the job. Keeping both is the only way the researched durations ever improve, and it is why this is a second column rather than an update.';
comment on column public.bookings.actual_working_minutes is
  'started_at to completed_at, written once at completion and only when it is long enough to have been work. The evidence that eventually moves duration_source to observed.';
comment on column public.bookings.duration_implausible_at is
  'This job completed too fast to be real work, so no actual duration was recorded. A test walkthrough, a mis-tap, or somebody closing a job they never started. Kept as a fact because a silently missing measurement and a measurement we refused are different things.';

-- ---------------------------------------------------------------------------
-- The estimate follows the product, at the one moment the product is set
-- ---------------------------------------------------------------------------
--
-- A TRIGGER RATHER THAN THE CALL SITE, for the reason every other rule on this
-- table is a trigger: a booking is created in one place today and will be
-- created in three, and the copy that gets forgotten is the one that silently
-- schedules a four-day repaint as a two-hour call.

create or replace function public.sync_booking_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  minutes integer;
  days integer;
begin
  if new.band_slug is null then
    new.estimated_working_minutes := null;
    new.estimated_elapsed_days := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.band_slug is not distinct from old.band_slug then
    return new;
  end if;

  select b.typical_working_minutes, b.typical_elapsed_days
    into minutes, days
    from public.category_price_bands b
   where b.category_slug = new.category_slug
     and b.slug = new.band_slug;

  -- FROZEN, not looked up on every read. Re-pricing or re-timing a sub-band
  -- must not silently restate how long a job somebody already booked was
  -- supposed to take — same reasoning as band_min and quoted_max.
  new.estimated_working_minutes := minutes;
  new.estimated_elapsed_days := days;
  return new;
end;
$$;

comment on function public.sync_booking_duration() is
  'Copies a sub-band''s researched duration onto a booking when its product is set, and clears it when the product is cleared. Frozen at that moment: re-timing a sub-band later must not rewrite a job already booked.';

revoke execute on function public.sync_booking_duration() from public, anon, authenticated;

-- Sorts after `bookings_enforce_immutability`, like `bookings_sync_quote_floor`
-- and for the same reason: the immutability check must see these columns
-- unchanged by a browser before this writes them under the service role.
drop trigger if exists bookings_sync_duration on public.bookings;
create trigger bookings_sync_duration
  before insert or update on public.bookings
  for each row execute function public.sync_booking_duration();

-- ---------------------------------------------------------------------------
-- What actually happened, and the floor that keeps a walkthrough out of it
-- ---------------------------------------------------------------------------

create or replace function public.record_booking_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- TEN MINUTES. Mirrors DURATION_PLAUSIBLE_MIN_MINUTES in
  -- lib/booking/duration.ts. Nothing we sell can be done in less: the
  -- shortest product on the board is a 30-minute inspection, and the shortest
  -- thing anybody could honestly do in ten minutes is change a washer they
  -- were already standing next to.
  floor_minutes constant integer := 10;
  worked integer;
begin
  if new.status is not distinct from old.status or new.status <> 'completed' then
    return new;
  end if;

  if new.started_at is null or new.completed_at is null then
    return new;
  end if;

  worked := ceil(extract(epoch from (new.completed_at - new.started_at)) / 60.0);

  if worked < floor_minutes then
    -- REFUSED, AND SAID SO. Writing 0 here would be a measurement, and a
    -- measurement is what the duration research is eventually built from.
    new.actual_working_minutes := null;
    new.duration_implausible_at := now();
    return new;
  end if;

  new.actual_working_minutes := worked;
  return new;
end;
$$;

comment on function public.record_booking_duration() is
  'Writes how long the work actually took, at completion, and refuses a figure too small to have been work. A three-second completion is a walkthrough; recording it as 0 would poison the first real evidence this product ever collects about duration.';

revoke execute on function public.record_booking_duration() from public, anon, authenticated;

drop trigger if exists bookings_record_duration on public.bookings;
create trigger bookings_record_duration
  before update on public.bookings
  for each row execute function public.record_booking_duration();

-- ---------------------------------------------------------------------------
-- None of it is the browser's to write
-- ---------------------------------------------------------------------------
--
-- RLS is row-level, so "customers cancel their own open bookings" would
-- otherwise let a customer set their own job to twenty minutes and jump the
-- queue, or claim a four-day span on a tap washer and hold a professional's
-- week. The same mechanism as every other column pair here, one more block:
-- auth.uid() is null for the service role, which is how the professional's own
-- correction — written in lib/data after an RLS read proves the job is theirs —
-- passes through.
--
-- REBUILT FROM THE LIVE DEFINITION, NOT FROM MEMORY. Rebuilding this function
-- from a stale copy once dropped every settlement check at a stroke, with no
-- application code changing; `tests/db/booking-rls.test.ts` now carries a
-- canary that fails if any of them goes missing again.

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

  -- THE ONLY NEW BLOCK. Everything above and below is the live definition
  -- verbatim, read out of pg_proc rather than rebuilt from a migration file —
  -- rebuilding this function from a stale copy once dropped every settlement
  -- check at a stroke with no application code changing, and rebuilding it
  -- from memory while writing THIS migration would have dropped the
  -- provider_serves coverage guard below and broken every release path.
  --
  -- It is a SCHEDULING guard rather than a money one, which is exactly why it
  -- needs its own block: a reader scanning for the money checks would not
  -- think to add these to them. A customer shortening their own job takes
  -- somebody else's slot; a customer lengthening it holds a professional's
  -- week. Neither moves a rupee.
  if new.band_slug is distinct from old.band_slug
     or new.estimated_working_minutes is distinct from old.estimated_working_minutes
     or new.estimated_elapsed_days is distinct from old.estimated_elapsed_days
     or new.provider_estimated_working_minutes is distinct from old.provider_estimated_working_minutes
     or new.provider_estimated_elapsed_days is distinct from old.provider_estimated_elapsed_days
     or new.actual_working_minutes is distinct from old.actual_working_minutes
     or new.duration_implausible_at is distinct from old.duration_implausible_at then
    raise exception 'How long a job takes is not a browser''s to set'
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

create index if not exists bookings_band_slug_idx
  on public.bookings (category_slug, band_slug)
  where band_slug is not null;
