-- A customer's statement is evidence. Our guess is not.
--
-- WHAT PROMPTED THIS. The keyword matcher names a product for about a sixth of
-- requests, measured across all three scripts, and a category band spans
-- 10-13x — AC servicing runs 500 to 12,000 because a routine service, a gas
-- refill and an installation are three products. We accepted those bands only
-- because a customer would usually read a narrowed sub-band. Usually they do
-- not.
--
-- So when the triage names a trade but no product, the card asks one question
-- and the customer answers it. That answer is a third provenance, and it
-- belongs at the top of the ordering rather than beside the other two: `model`
-- and `matcher` are both OUR reading of somebody's sentence, and this is the
-- person who owns the tap saying which tap it is.
--
-- STILL A HINT AND NOT A CLAIM, and the column's own comment already says so.
-- It travels in the query string with the band itself, so a determined
-- customer can set `bandSource=customer` on their own booking. What that buys
-- them is protection from a cleanup sweep on their own job's duration. It
-- moves no money, `enforce_booking_immutability` refuses every subsequent
-- change to it, and `rebandBookings` can ignore the column and clear by
-- category, product and date.
--
-- `triage_logs` STILL NEEDS NOTHING. It records `source`, and a customer's
-- answer arrives after that row is written — the tap happens on a card the
-- server has already finished answering. The durable record of a stated band
-- is the booking, which is the row that matters: a triage nobody acted on
-- narrows nothing. Measuring the ask in production is a count over
-- `bookings.band_source`.

alter table public.bookings
  drop constraint if exists bookings_band_source_check;

alter table public.bookings
  add constraint bookings_band_source_check
  check (band_source is null or band_source in ('model', 'matcher', 'customer'));

comment on column public.bookings.band_source is
  'Which path named this booking''s product: model, matcher, or customer — the customer answering the card''s one question, which outranks the other two because a statement is evidence and a guess is not. A browser-supplied hint, used to scope a cleanup when a matcher rule is later found wrong; never a security claim. triage_logs remains the authoritative record of what the two automatic paths produced.';
