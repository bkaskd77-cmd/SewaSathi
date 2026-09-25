-- REMOVES: nothing. Two columns and one index are added to `providers`; no
-- column, policy, function, grant or guard clause is dropped or weakened.
--
-- ===========================================================================
-- A listing that closed because nobody worked, which is not a listing removed.
--
-- WHY THIS IS A THIRD STATE AND NOT ONE OF THE TWO WE HAVE. The schema already
-- separates these and says why, in 20260910000001_provider_applications.sql:
--
--     `removed_at` … Kept as its own column rather than folded into
--     `is_active`, because "taking a break" and "removed for cause" are not
--     the same state and a schema that conflates them will let one be undone
--     as if it were the other.
--
-- Dormancy is neither of those. It is not `is_active` alone — that is somebody
-- choosing to stop appearing, and it says nothing about why or when. It is
-- emphatically not `removed_at`, which is step 5 of the enforcement ladder:
-- punitive, for confirmed deliberate under-reporting, and deliberately hard to
-- come back from. Closing a dormant listing carries no finding against anybody
-- and **returning means re-applying, which is allowed**.
--
-- Conflating the two would put a professional who simply stopped taking work
-- onto every screen and every future report that reads `removed_at` as "we
-- removed this person for cause". That is a false accusation written into a
-- schema, and it is exactly the failure the comment above was written to stop.
--
-- WHAT IT IS FOR. `/providers/standards` now publishes that a guarantee
-- balance is written off after twelve months with no completed job, and that
-- the listing closes at that point. These columns are what makes that sentence
-- true rather than a promise backed by nothing — the same fault
-- `applyRedoRecovery` had for four phases while the same page promised the
-- balance was one "you can watch going down".
--
-- ONLY LISTINGS CARRYING A BALANCE ARE CLOSED THIS WAY, and that asymmetry is
-- deliberate. A professional with nothing owed who takes a year off keeps
-- their listing: a general dormancy policy would deactivate people who have
-- done nothing but be quiet, and it would need its own decision and its own
-- published copy. The close exists here to make the write-off final, so a
-- balance does not follow somebody indefinitely.
-- ===========================================================================

alter table public.providers
  add column if not exists closed_at timestamptz;

alter table public.providers
  add column if not exists closed_reason text;

alter table public.providers
  drop constraint if exists providers_closed_reason_known;
alter table public.providers
  add constraint providers_closed_reason_known check (
    closed_reason is null
    or closed_reason in ('dormant')
  );

/*
 * BOTH OR NEITHER. A `closed_at` with no reason is a listing nobody can
 * account for, and a reason with no date is a claim with no event behind it.
 * The pair is how a person reading this row a year later can tell what
 * happened without asking anybody.
 */
alter table public.providers
  drop constraint if exists providers_closed_shape;
alter table public.providers
  add constraint providers_closed_shape check (
    (closed_at is null) = (closed_reason is null)
  );

comment on column public.providers.closed_at is
  'When this listing was closed for dormancy — twelve months with no completed job while carrying a guarantee balance. NOT removal: `removed_at` is step 5 of the ladder and is for cause. Returning from this is re-applying, which is allowed.';

comment on column public.providers.closed_reason is
  'Why the listing closed. Only "dormant" today. Separate from `removal_reason`, which records a finding against somebody.';

-- The sweep asks for open listings only, every run. A partial index keeps that
-- predicate cheap and matches `providers_standing_idx`, which is shaped the
-- same way for the same reason.
create index if not exists providers_open_idx
  on public.providers (id)
  where closed_at is null;
