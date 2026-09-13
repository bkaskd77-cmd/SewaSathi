-- The quote's floor belongs to whoever is actually doing the job.
--
-- WHAT WAS WRONG. `createBooking` froze `quoted_min` from the category alone,
-- so a plumbing job quoted Rs 900 whoever the customer had picked — the same
-- number for somebody starting at 900 and for somebody starting at 2,000. The
-- figure a professional sets on their own dashboard reached their card, their
-- profile and the replacement list, and then vanished from the one screen that
-- decides what anybody pays. A control whose value changes nothing downstream
-- is a control people stop setting honestly.
--
-- THE CEILING IS STILL OURS AND IS NOT TOUCHED HERE. A professional names a
-- starting price, never a maximum, and `judgeFinalAmount` measures the 2×
-- customer protection off `quoted_max`. Nothing a professional can type may
-- move that, which is the whole reason the band is published in advance and
-- not settable by the person the commission is charged to.
--
-- NO GAMING PAYOFF IN EITHER DIRECTION. `clampRate` stops them going under the
-- published band, and going over only raises the floor their own fee is
-- charged on — the fee is `max(final_amount, quoted_min)`.

-- ------------------------------------------------------------------ --
-- 1. The floor follows the job
-- ------------------------------------------------------------------ --

-- A booking gains or loses a professional in five places: createBooking,
-- chooseProvider, claimJob, declineJob and the dispatch sweep. Recomputing at
-- each call site is four chances to forget, which is exactly why
-- `sync_provider_on_job` and `record_provider_release` are triggers too.
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

  -- Once work has been priced or money has moved, the quote is history and
  -- history is not rewritten. A hand-off cannot happen this late anyway; this
  -- is here so a future path that allows one cannot restate a settled figure.
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
    -- Unheld. The floor goes back to ours: a departed professional's price is
    -- not a promise about whoever comes next.
    new.quoted_min := band_low;
    return new;
  end if;

  select p.base_rate into rate
    from public.providers p
   where p.id = new.provider_id;

  -- The same clamp `lib/provider/rates.ts` applies, against the band of the
  -- trade actually being booked. A multi-trade professional is clamped against
  -- the UNION of their bands — a plumber-and-painter may legally sit at
  -- Rs 25,000 — so taking the rate raw would write quoted_min above
  -- quoted_max and the table's own check constraint would refuse the write.
  new.quoted_min := least(greatest(band_low, coalesce(rate, band_low)), band_high);
  return new;
end;
$$;

comment on function public.sync_booking_quote_floor() is
  'Keeps bookings.quoted_min at the holding professional''s starting price, clamped into the category band. Unheld bookings fall back to the category floor.';

revoke execute on function public.sync_booking_quote_floor() from public;

-- THE TRIGGER NAME IS LOAD-BEARING. Postgres fires BEFORE triggers in
-- alphabetical order. `bookings_enforce_immutability` raises whenever
-- `quoted_min` changed and `auth.uid()` is not null — and `claimJob` writes
-- through the professional's OWN session, not the service role. So this must
-- run AFTER that check sees an unchanged value: 'bookings_e...' sorts before
-- 'bookings_s...'. If that ever inverts, claiming an open job starts failing
-- with "Prices and payment state are not editable from a browser" and nothing
-- in the application code explains why. tests/db asserts the ordering.
drop trigger if exists bookings_sync_quote_floor on public.bookings;
create trigger bookings_sync_quote_floor
  before update on public.bookings
  for each row execute function public.sync_booking_quote_floor();

-- ------------------------------------------------------------------ --
-- 2. A priced job's quote never moves again — for anybody
-- ------------------------------------------------------------------ --

-- `enforce_booking_immutability` lets the service role through, which is right
-- for everything it guards: the server writes those columns legitimately. This
-- is the one case with no legitimate caller at all, so it has no bypass — the
-- same shape as `enforce_booking_address_ownership`. A quote that moves after
-- somebody has been charged against it makes every receipt arguable.
create or replace function public.freeze_quote_after_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.final_amount is null then
    return new;
  end if;

  if new.quoted_min is distinct from old.quoted_min
     or new.quoted_max is distinct from old.quoted_max then
    raise exception 'The quote cannot change once a final amount has been recorded'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.freeze_quote_after_work() is
  'Refuses any change to quoted_min/quoted_max once final_amount is set. No service-role bypass: there is no caller that legitimately restates a priced quote.';

revoke execute on function public.freeze_quote_after_work() from public;

drop trigger if exists bookings_freeze_quote on public.bookings;
create trigger bookings_freeze_quote
  before update on public.bookings
  for each row execute function public.freeze_quote_after_work();

-- ------------------------------------------------------------------ --
-- 3. Heal the rates that were never clamped
-- ------------------------------------------------------------------ --

-- `clampRate` has always said a "from" price may not leave the published band,
-- and it only ever ran when a professional pressed Save. Approval wrote
-- `base_rate: 500` for every trade, and 500 is below every floor we publish —
-- the lowest is electrical at 800. So every professional approved through the
-- real application flow was listed at a price the product refuses from them.
-- lib/data/review.ts now writes the floor of their own band; this fixes the
-- rows already written, and tests/db keeps them inside it from here.
--
-- The band is the UNION across their trades, exactly as `bandForTrades`
-- computes it: the widest of their bands binds, because the alternative
-- punishes breadth — taking on a second trade would otherwise lower a ceiling.
with bands as (
  select
    pc.provider_id,
    min(c.base_price_min) as low,
    max(c.base_price_max) as high
  from public.provider_categories pc
  join public.categories c on c.slug = pc.category_slug
  group by pc.provider_id
)
update public.providers p
   set base_rate = least(greatest(p.base_rate, b.low), b.high)
  from bands b
 where b.provider_id = p.id
   and p.base_rate is distinct from least(greatest(p.base_rate, b.low), b.high);
