-- Where a published band came from, and measuring whether it is right.
--
-- THE BANDS ARE INVENTED AND NOTHING SAID SO. `categories.base_price_min/max`
-- is on every category card, on /services, on each category page, inside the
-- triage prompt, and it is the floor of every booking's quote — which the
-- platform fee is charged on. Every one of the ten was a developer's guess at a
-- Kathmandu price. A comment would have protected the next developer and not
-- the person reading the page, so it is a column: a band cannot go live while
-- it still says `invented`, and `npm run check:blockers` refuses the build.
--
-- The intended path for these numbers is: invented -> researched against named
-- competitors before launch -> observed from our own settled jobs once there
-- are enough of them to mean anything. The last step is what the view at the
-- bottom of this file exists to make possible.

-- ------------------------------------------------------------------ --
-- 1. Provenance, beside the numbers it describes
-- ------------------------------------------------------------------ --

alter table public.categories
  add column if not exists pricing_source text not null default 'invented'
    check (pricing_source in ('invented', 'researched', 'observed')),
  add column if not exists pricing_checked_at date,
  add column if not exists pricing_note text;

comment on column public.categories.pricing_source is
  'Where base_price_min/max came from: invented (a guess — cannot launch), researched (named competitors, see pricing_note), observed (our own settled jobs).';
comment on column public.categories.pricing_checked_at is
  'The date the band was last checked against the world. Null while invented.';
comment on column public.categories.pricing_note is
  'Who was checked, or what the figure was derived from.';

-- ------------------------------------------------------------------ --
-- 2. The band a booking was quoted under, frozen
-- ------------------------------------------------------------------ --

-- WHY THIS COLUMN NOW EXISTS. Until yesterday `quoted_min` WAS the category's
-- published floor, so "how often does a settled job land under our floor" was
-- answerable from the booking alone. Yesterday's change made `quoted_min` the
-- holding professional's own starting price — correct for the commission
-- basis, and it destroyed the measurement: a professional starting at Rs 2,400
-- who does a Rs 1,500 job now looks like evidence that OUR band is too high.
--
-- The two questions are different and both are worth asking, so both floors are
-- kept. `band_min` is ours, frozen at booking time like `quoted_max` beside it;
-- `quoted_min` is theirs. Frozen rather than joined to `categories` at read
-- time because the honest question is "was the band we PUBLISHED right", and a
-- band we have since moved would otherwise re-judge every job that came before
-- it.
alter table public.bookings
  add column if not exists band_min integer
    check (band_min is null or band_min > 0);

comment on column public.bookings.band_min is
  'The category band floor as published when this was booked — ours, never a professional''s. quoted_min is the holding professional''s own starting price.';

-- Existing rows predate the column. They are seed and walkthrough bookings that
-- will be deleted before launch, so today's category floor is close enough and
-- better than null.
update public.bookings b
   set band_min = c.base_price_min
  from public.categories c
 where c.slug = b.category_slug
   and b.band_min is null;

-- FILLED BY A TRIGGER, NOT BY THE CALLER. createBooking is the only insert path
-- today, but a column that silently becomes null the day somebody adds a second
-- one is a measurement that quietly stops measuring. Filling it here means the
-- db suite's own inserts carry it too, which is how the tests stay honest.
--
-- ON UPDATE IT IS PINNED RATHER THAN GUARDED. Every ordinary status write would
-- otherwise have to know this column exists. It is derived and frozen; silently
-- holding it is what "frozen" means here, and the comment is the warning.
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
    new.band_min := old.band_min;
    return new;
  end if;

  if new.band_min is not null then
    return new;
  end if;

  select c.base_price_min into floor_now
    from public.categories c
   where c.slug = new.category_slug;

  -- quoted_min as the last resort rather than null: a category row missing
  -- behind a foreign key should not be able to break a booking.
  new.band_min := coalesce(floor_now, new.quoted_min);
  return new;
end;
$$;

comment on function public.freeze_booking_band() is
  'Fills bookings.band_min from the category at insert and pins it on update. The published floor at booking time, kept so the pricing signal can ask whether OUR band was right.';

revoke execute on function public.freeze_booking_band() from public;

drop trigger if exists bookings_freeze_band on public.bookings;
create trigger bookings_freeze_band
  before insert or update on public.bookings
  for each row execute function public.freeze_booking_band();

alter table public.bookings
  alter column band_min set not null;

-- ------------------------------------------------------------------ --
-- 3. The signal, measuring our band again
-- ------------------------------------------------------------------ --

-- Two floors, two questions, named apart so neither can be read as the other:
--
--   below_band_jobs  — under OUR published floor. A category where these pile
--                      up is a price WE got wrong, and every one of those jobs
--                      was overcharged in fee by us. This is the band-review
--                      signal and the one `needsBandReview` reads.
--   below_quote_jobs — under the holding professional's own starting price.
--                      This is the commission floor biting, and it is what
--                      `commission_appeals` exists to answer one job at a time.
--
-- Counted per category and never per person, unchanged from before: read the
-- other way it becomes a list of people to punish for our own mispricing.
-- Dropped rather than replaced: `create or replace view` cannot rename a
-- column, and the rename is the point — `below_floor_jobs` no longer says which
-- floor it means, now that there are two.
drop view if exists public.category_pricing_signals;

create view public.category_pricing_signals as
  select
    b.category_slug,
    count(*) as settled_jobs,
    count(*) filter (where b.final_amount < b.band_min) as below_band_jobs,
    round(
      100.0 * count(*) filter (where b.final_amount < b.band_min)
        / nullif(count(*), 0)
    , 1) as below_band_pct,
    count(*) filter (where b.final_amount < b.quoted_min) as below_quote_jobs,
    count(*) filter (where b.final_amount > b.quoted_max) as above_band_jobs,
    min(b.band_min) as band_min,
    max(b.quoted_max) as band_max,
    percentile_cont(0.5) within group (order by b.final_amount)::int as median_final,
    percentile_cont(0.25) within group (order by b.final_amount)::int as p25_final,
    percentile_cont(0.75) within group (order by b.final_amount)::int as p75_final
  from public.bookings b
  where b.payment_status = 'paid' and b.final_amount is not null
  group by b.category_slug;

comment on view public.category_pricing_signals is
  'Per category: how often settled jobs land under OUR published floor (below_band), under the professional''s own rate (below_quote), or over the band. A high below_band share means our price is wrong, not that our professionals are.';

-- A view over `bookings` runs with the caller's own policies, so a customer
-- reading it would see only their own rows and get a meaningless aggregate.
-- It is read by lib/data under the service role, for support.
revoke all on public.category_pricing_signals from public, anon, authenticated;
