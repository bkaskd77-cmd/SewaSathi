-- The one person who actually saw the job can finally say what it was.
--
-- WHAT WAS MISSING. A booking learns its product from the triage card, from the
-- customer tapping a sub-band in the flow, or not at all — and "not at all" is
-- a legitimate outcome twice over: "I'm not sure" writes null on purpose, and a
-- survey trade has no products to choose between. So a job can be booked,
-- accepted, worked and completed with `band_slug` null, and then it teaches the
-- duration loop nothing, the per-product bands nothing, and the span nothing. It
-- holds a flat two hours whatever it turned out to be.
--
-- The professional who just finished it knows exactly which product it was. One
-- tap at completion, recorded as `professional`.
--
-- IT IS ITS OWN SOURCE AND NOT `customer`, because who said so is the whole
-- point of a provenance column. An answer from somebody standing in the room
-- after the work is better evidence than a guess from somebody describing the
-- job beforehand — the duration loop will eventually want to weigh those
-- differently, and folding them together loses that for ever.
--
-- IT IS NOT A PRICE CORRECTION. `provider_band_slug` already exists for "this is
-- a DIFFERENT job from the one that was booked": it moves the band, needs a
-- reason, and the customer must agree before work may start, because it is a
-- question about money. This names a job nobody ever classified, after the work
-- is done, and it cannot move a rupee — `freeze_booking_band` pins `band_min`
-- and `band_revision_id` to their old values on every UPDATE, and
-- `booking_band_bounds` treats only a `customer` source as a stated band. Both
-- checked against the live definitions rather than assumed.

alter table public.bookings
  drop constraint if exists bookings_band_source_check;

alter table public.bookings
  add constraint bookings_band_source_check
  check (
    band_source is null
    or band_source in
       ('model', 'matcher', 'customer', 'inherited', 'professional')
  );

comment on column public.bookings.band_source is
  'Who named the product. model/matcher are our reading of a sentence; customer is the one that narrows the price; inherited is a guarantee visit copying its parent, which is nobody naming it for THIS booking; professional is the answer recorded at completion by the person who did the work, on a booking nobody had classified. Null is "not recorded" and is not backfilled.';

-- ---------------------------------------------------------------------------
-- An estimate is what we said BEFOREHAND, so a late product does not get one
-- ---------------------------------------------------------------------------
--
-- REMOVES: sync_booking_duration — nothing; one guard is added.
--
-- THE TRAP THIS CLOSES, and it would have been silent. `sync_booking_duration`
-- copies the sub-band's researched figures onto `estimated_working_minutes` and
-- `estimated_elapsed_days` whenever the product is set. That is right at booking
-- time and wrong at completion: the whole value of those columns is that they
-- are what WE said the job would take before anybody did it, which is the only
-- thing that ever makes the researched numbers better than a guess. Writing
-- them when the professional names the product afterwards would create an
-- estimate that informed no scheduling decision and was made with the answer in
-- hand — and any estimate-against-actual reading would then flatter us with
-- rows that are really hindsight.
--
-- THE LINE IS `started_at`, NOT THE STATUS. Up to the moment work begins the
-- estimate still has a job to do: it is what the scheduler holds. Once somebody
-- is on the tools there is nothing left for it to inform. That also keeps the
-- ordinary paths untouched — a booking named at `pending`, `accepted` or
-- `en_route` behaves exactly as it did.

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

  -- NAMED AFTER THE WORK STARTED. Record the product; invent no estimate.
  if tg_op = 'UPDATE' and new.started_at is not null then
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
  'Copies a sub-band''s researched duration onto a booking when its product is set, and clears it when the product is cleared. Frozen at that moment, and refused once started_at is stamped: a product named at completion records what the job was, and must not mint an estimate nobody made before the work.';

revoke execute on function public.sync_booking_duration() from public, anon, authenticated;
