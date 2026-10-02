-- ---------------------------------------------------------------------------
-- Every change to a published price band, and who decided it.
--
-- WHY A TABLE AND NOT JUST AN AUDIT ROW. `security_events` is written too and is
-- the record that cannot be tidied, but it is a log read by a screen that lists
-- events — it cannot answer "what band did we publish in October and why", which
-- is the question `bookings.band_min` makes askable one booking at a time and
-- this makes askable for the band itself. `docs/PRICING-BANDS.md § 2` specified
-- it before any of this was built; this is that table.
--
-- IT ALSO HOLDS THE REJECTIONS, which is the part that does work rather than
-- recording it. A proposal is computed on demand from settled jobs, so a number
-- the owner has already turned down returns on every visit — and the same number
-- offered weekly is a number approved out of fatigue. The suppression rule is
-- written down rather than implied, in `proposalSuppressedBy`
-- (`lib/data/band-proposal.ts`): a rejection suppresses a later proposal only
-- while the proposed pair is IDENTICAL to the rejected one AND the sample has not
-- grown by half again. Both bounds are already rounded outward to Rs 100, so
-- "identical" means the same published numbers and the smallest possible
-- difference is Rs 100 — there is no margin to choose and nothing to tune. The
-- sample clause is the escape hatch for a rejection that meant "too soon" rather
-- than "wrong shape"; more data producing the SAME number is not an answer to
-- "this category is two different jobs", which is why both must break.
-- The suppression is never silent: the screen names the rejected pair, its reason
-- and what would bring it back, because a hidden proposal and no proposal must
-- not look alike.
--
-- APPEND-ONLY, with `refuse_rewrite()` — the same trigger as
-- `application_decisions` and for the same reason: a price history the
-- application can edit proves nothing about what we published.
--
-- NOBODY WRITES FROM A BROWSER. `lib/data/bands.ts` writes under the service
-- role, like every other price write. `categories` deliberately has no update
-- policy and must not get one: RLS is row-level, so an update policy there would
-- make every column editable from a browser including the Nepali copy — the
-- `profiles.role` lesson, one table over.
--
-- ------------------------------------------------------------------------
-- THE TRANSPORT RULE IN CLAUDE.md § SCHEMA IS WRONG, AND THIS FILE IS HOW IT
-- WAS FOUND. The recorded rule is "multi-statement DDL hangs, so more than one
-- statement goes in a DO block". What today's attempts actually show:
--
--   one LARGE DO block (create table + alter + revoke)        applied, instantly
--   one SMALL DO block (index + drop trigger + create trigger) timed out 3x
--   each of those statements on its own, bare                 applied, instantly
--
-- Three timeouts at 60s, each rolling back whole — `pg_locks` empty,
-- `pg_stat_activity` idle, nothing waiting, nothing left behind. So the DO block
-- is not the way through and statement count is not the variable; what is
-- reliable is **one bare statement per call**. This file is therefore plain
-- statements, which is also what the db suite runs, and it is ordered
-- closed-before-open because losing the block means losing atomicity: create,
-- then RLS and the revokes, then the trigger and the index, then the policy and
-- the grant. Stopping anywhere leaves a table nobody can reach — which is exactly
-- what `20261001000003_payouts.sql` failed to do when it timed out and left
-- `anon` holding full write on a money-instruction table.
-- ---------------------------------------------------------------------------

create table if not exists public.category_price_revisions (
  id uuid primary key default gen_random_uuid(),
  category_slug text not null
    references public.categories (slug) on update cascade on delete cascade,

  -- A `rejected` row carries no new band: nothing was written.
  decision text not null check (decision in ('approved', 'rejected')),

  -- What was published at the moment of the decision. Kept rather than joined,
  -- for the reason `band_min` is frozen onto a booking: a band we have since
  -- moved would otherwise re-describe every decision that came before it.
  old_min integer not null check (old_min > 0),
  old_max integer not null check (old_max >= old_min),

  -- What is published after it. Equal to old_* on a rejection.
  new_min integer not null check (new_min > 0),
  new_max integer not null check (new_max >= new_min),

  -- What the data asked for, which is what a rejection is ABOUT and what the
  -- suppression rule is keyed on.
  proposed_min integer not null check (proposed_min > 0),
  proposed_max integer not null check (proposed_max >= proposed_min),

  -- The evidence, so a decision can be weighed later rather than taken on trust.
  -- `sample` is settled jobs in the window; `winsorised` is how many sat outside
  -- the Tukey fence, which is the tell that one band is the wrong shape; `capped`
  -- says the 20% movement cap bound the result, so the data asked for more than
  -- was applied.
  sample integer not null check (sample >= 0),
  winsorised integer not null check (winsorised >= 0),
  capped boolean not null,

  -- Null only if the profile is later deleted. A decision with no actor is not
  -- writable: the insert names one.
  actor_id uuid references public.profiles (id) on delete set null,

  -- Required, and required to be non-blank, on an approval and a rejection
  -- alike. The band is published copy and it moves commission through
  -- `max(final_amount, quoted_min)`; "why" is the part a future reader needs and
  -- the part nobody writes unless the form insists.
  reason text not null check (length(btrim(reason)) > 0),

  decided_at timestamptz not null default now()
);

alter table public.category_price_revisions enable row level security;

revoke all on table public.category_price_revisions from public, anon, authenticated;

create index if not exists category_price_revisions_slug_idx
  on public.category_price_revisions (category_slug, decided_at desc);

drop trigger if exists category_price_revisions_append_only
  on public.category_price_revisions;
create trigger category_price_revisions_append_only
  before update or delete on public.category_price_revisions
  for each row execute function public.refuse_rewrite();

comment on table public.category_price_revisions is
  'Append-only history of published band changes and of proposals a person turned down. A rejection suppresses that exact proposed pair until the data moves; see lib/data/bands.ts.';
comment on column public.category_price_revisions.capped is
  'True when MAX_REVISION_MOVE held the proposal back, so the sample asked for a larger move than was applied.';
comment on column public.category_price_revisions.winsorised is
  'Settled jobs capped at a Tukey fence. A large share means the answer is sub-bands rather than a wider band.';

-- Admins read it: it is the evidence behind a number on every category card, and
-- the screen that shows a proposal shows what was decided before it.
drop policy if exists "Admins read every band revision"
  on public.category_price_revisions;
create policy "Admins read every band revision"
  on public.category_price_revisions for select to authenticated
  using (public.is_admin());

-- A NEW TABLE GRANTS NOTHING UNTIL IT SAYS SO. `20261002000001` closed the
-- default privilege, so the policy above decides which rows and this decides
-- whether anybody may ask at all. SELECT only, and only for the role the policy
-- can narrow; every write is the service role.
grant select on table public.category_price_revisions to authenticated;
