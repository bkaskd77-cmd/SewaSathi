-- A customer can keep their booking off the homepage.
--
-- The activity strip names a first name, a trade and a city — never a ward,
-- never a surname, and never sooner than an hour after the job finished. That
-- is a low bar for re-identification and still not nothing, so somebody who
-- would rather not appear must be able to say so without asking us.
--
-- PROFILE-LEVEL, NOT PER BOOKING. One setting the customer can find in
-- /account and reason about once, rather than a checkbox in the booking flow
-- that they have to notice every time. It applies to everything they have
-- booked and everything they book later, including bookings already completed.

alter table public.profiles
  add column if not exists hide_from_activity boolean not null default false;

comment on column public.profiles.hide_from_activity is
  'Customer has asked not to appear in the public activity strip. False is a '
  'preference nobody has expressed, not a measurement — see CLAUDE.md rule 6 '
  'for why that distinction is worth stating even where it does not bite.';
