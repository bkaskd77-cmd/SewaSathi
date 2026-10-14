-- ---------------------------------------------------------------------------
-- A review may be taken off the front page by a person, and never for being
-- negative.
--
-- WHAT THIS IS FOR. Published reviews are going on the homepage — the slot
-- `lib/mock/activityFeed.ts` used to hold with invented customers. The listing
-- shows every published review for ever and that does not change
-- (`countsTowardAverage`); the homepage is a CHOSEN surface, read by strangers
-- and indexed, so it needs a way to take down abuse or something that is not
-- about the work at all.
--
-- THE DANGER IS OBVIOUS AND IT IS WHY THE SHAPE IS NARROW. A button that
-- removes a review from the most-read page in the product is a button for
-- removing bad reviews, unless four things are true at once:
--
--   1. **THE AVERAGE DOES NOT MOVE.** `refresh_provider_stats` filters on
--      `excluded_from_average_at` and reads nothing here, so hiding changes no
--      rating, no recency figure and no ranking position. That is asserted in
--      `tests/db/review-homepage.test.ts` rather than left to be re-read off
--      this comment — a comment describing behaviour the code does not have is
--      the class this repository keeps recording.
--   2. **THE REVIEW STAYS ON THE LISTING.** `getProviderReviews` reads nothing
--      here either. A rating average is evidence; a review page is testimony
--      and must not lose anything — the sentence
--      `excluded_from_average_at` already carries, one column over.
--   3. **THE REASON COMES FROM A CLOSED SET THAT CANNOT MEAN "NEGATIVE".** Two
--      values, `abusive` and `irrelevant`. `CUSTOMER_FLAGS` refuses a "wanted a
--      discount" flag for the same reason: a list that cannot express
--      retaliation is a stronger guarantee than a policy promising nobody will.
--   4. **NOTHING FILTERS BY STARS.** `showsOnHomepage` does not read `rating`,
--      so a one-star review is as eligible as a five-star one and this column
--      is the only lever there is.
--
-- A PAIR OF STATE COLUMNS RATHER THAN AN APPEND-ONLY TABLE, which is the
-- opposite choice from `duration_reverts` and for a stated reason: hiding is a
-- TOGGLE and a toggle has state, where a revert is an event. The permanent
-- record is `security_events`, which refuses UPDATE and DELETE for every caller
-- including the service role — so un-hiding clears these columns and cannot
-- erase that it happened. The shape is copied from
-- `excluded_from_average_at`/`excluded_by`/`excluded_reason` beside it, because
-- it is the same kind of decision about the same row.
--
-- NULL IS "NOT HIDDEN", and that is a measurement rather than an absence here:
-- every review ever written is on the homepage unless somebody took it off, so
-- there is nothing to backfill and no silence to misread. Rule 6 does not bite
-- on a column whose default state is the ordinary one.
--
-- NOTHING DESTRUCTIVE: the only `delete` token is the `on delete set null` in
-- the column definition, and no statement in this file carries an `update`
-- token, so nothing here can trip the agent transport's pair rule.
-- ---------------------------------------------------------------------------

alter table public.provider_reviews
  add column if not exists homepage_hidden_at timestamptz,
  add column if not exists homepage_hidden_by uuid
    references public.profiles (id) on delete set null,
  add column if not exists homepage_hidden_code text,
  add column if not exists homepage_hidden_reason text;

comment on column public.provider_reviews.homepage_hidden_at is
  'Set when a person took this review off the HOMEPAGE. It stays on the provider''s listing and it still counts toward every rating average — see refresh_provider_stats, which reads nothing here. NEVER for being negative: the code set cannot express that and nothing selecting for the homepage reads `rating`.';
comment on column public.provider_reviews.homepage_hidden_code is
  'Why, from the closed set in lib/reviews/homepage.ts: abusive, irrelevant. There is deliberately no code meaning low-rated, disputed or unfair — a list that cannot express retaliation is a stronger guarantee than a policy saying nobody will.';
comment on column public.provider_reviews.homepage_hidden_reason is
  'The sentence a person wrote, read back when somebody asks why. The code makes the action countable; the sentence makes it answerable. Both are required, unlike booking_refusals.reason_code, because this is a staff decision about somebody''s published words rather than a form a professional may skip.';

-- A hide nobody decided is the automatic suppression this column exists to
-- prevent, wearing a timestamp. All four together or all four null — the shape
-- `provider_reviews_exclusion_needs_a_person` already uses, extended to the
-- reason because an unexplained hide is the one that gets argued about.
alter table public.provider_reviews
  drop constraint if exists provider_reviews_homepage_hide_needs_a_person;
alter table public.provider_reviews
  add constraint provider_reviews_homepage_hide_needs_a_person check (
    (homepage_hidden_at is null) = (homepage_hidden_by is null)
    and (homepage_hidden_at is null) = (homepage_hidden_code is null)
    and (homepage_hidden_at is null) = (homepage_hidden_reason is null)
  );

-- ONE LIST WRITTEN TWICE, with `HOMEPAGE_HIDE_CODES` in lib/reviews/homepage.ts.
-- `tests/db/review-homepage.test.ts` compares them out of `pg_constraint`, the
-- arrangement `bookings_band_source_check` needed and did not have: a chip
-- offered by a screen whose write the constraint refuses loses the decision in
-- the same statement that records it.
alter table public.provider_reviews
  drop constraint if exists provider_reviews_homepage_hidden_code_check;
alter table public.provider_reviews
  add constraint provider_reviews_homepage_hidden_code_check check (
    homepage_hidden_code is null
    or homepage_hidden_code in ('abusive', 'irrelevant')
  );

alter table public.provider_reviews
  drop constraint if exists provider_reviews_homepage_reason_length;
alter table public.provider_reviews
  add constraint provider_reviews_homepage_reason_length check (
    homepage_hidden_reason is null
    or char_length(homepage_hidden_reason) between 2 and 600
  );

-- The homepage read: published, newest first, not hidden. The opt-out and the
-- contact-details rule are applied in `lib/reviews/homepage.ts` over the joined
-- row, because neither is a column on this table.
create index if not exists provider_reviews_homepage_idx
  on public.provider_reviews (published_at desc)
  where published_at is not null and homepage_hidden_at is null;

-- NO NEW GRANT AND NO NEW POLICY, said out loud because a new column on a table
-- `anon` can SELECT is a publication decision. "Anyone reads published provider
-- reviews" already covers every column on a published row, which is correct
-- here: who hid a review and why is staff information, and it is readable by
-- anybody who asks for it. That is deliberate — the alternative is a column
-- grant on a public directory table, and a hidden review's existence is not a
-- secret worth one. The name in `homepage_hidden_by` is a UUID, not a person.
