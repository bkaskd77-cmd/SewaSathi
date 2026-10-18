-- ADDS: category_price_revisions.source, and makes the five proposal columns
--       nullable so a band a PERSON states can be recorded honestly.
--
-- THE GAP THIS CLOSES. `/admin/bands` can only ever apply a COMPUTED proposal:
-- `approveBand` takes `input.proposal.low/high`, and `proposeBand` returns null
-- below `MIN_PROPOSAL_SAMPLE` (15-30 settled jobs). So on day one — and on any
-- category that has not been sold 15 times — no band is changeable through the
-- admin at all, and a mispriced category needs a migration and a deploy. The
-- screen exists and the one case it is most needed for is the one it cannot do.
--
-- `mode: "correction"` WAS THE DESIGNED ANSWER AND IT DOES NOT REACH. It lives
-- in `proposeBand`, is commented at length against `MAX_REVISION_MOVE`, and
-- nothing anywhere passes it — the no-caller sin again. It also would not have
-- helped: it lifts the CAP and still requires the sample, so with no settled
-- jobs it returns null exactly as the computed path does.
--
-- WHY THE COLUMNS CANNOT JUST BE FILLED IN. `proposed_min`, `proposed_max`,
-- `sample`, `winsorised` and `capped` are NOT NULL and every one of them is a
-- fact about a proposal. A stated band has none: `proposed_min = new_min` would
-- record that the data asked for exactly this, `sample = 0` would record that
-- zero jobs were measured rather than that no measurement was involved, and
-- `capped = false` would record that the movement cap considered this figure and
-- let it through. All three are rule 6 — a default standing in for a fact — on
-- the table a disputed price is argued from.
--
-- Read live first: 0 rows in `category_price_revisions`, so nothing is
-- backfilled and nothing needs to be, and the constraints below can be plain
-- rather than `NOT VALID`.

alter table public.category_price_revisions
  add column if not exists source text not null default 'proposal';

comment on column public.category_price_revisions.source is
  'Where the figures came from: proposal (computed from settled jobs, then approved or rejected by a person) or stated (a person set the band directly, with no sample). On a stated row proposed_min, proposed_max, sample, winsorised and capped are all null, because there was no proposal - not because it measured nothing.';

-- ------------------------------------------------------------ constraints ---

alter table public.category_price_revisions
  drop constraint if exists category_price_revisions_source_known;

alter table public.category_price_revisions
  add constraint category_price_revisions_source_known check (
    source in ('proposal', 'stated')
  );

/*
 * THE SHAPE OF EACH SOURCE, REFUSED RATHER THAN TRUSTED. A proposal row without
 * its sample is a decision nobody can audit afterwards; a stated row WITH one is
 * a claim that data was consulted when it was not. This table is what a disputed
 * quote is argued from, so both are refused here rather than left to every future
 * writer to remember.
 *
 * A CHECK CONSTRAINT PASSES ON NULL, which is the trap this schema has already
 * been bitten by once — so every clause names its column explicitly rather than
 * relying on the NOT NULL that is no longer there.
 */
alter table public.category_price_revisions
  drop constraint if exists category_price_revisions_shape;

alter table public.category_price_revisions
  add constraint category_price_revisions_shape check (
    (source = 'proposal'
      and proposed_min is not null
      and proposed_max is not null
      and sample is not null
      and winsorised is not null
      and capped is not null)
    or (source = 'stated'
      and proposed_min is null
      and proposed_max is null
      and sample is null
      and winsorised is null
      and capped is null
      -- A rejection is a verdict on somebody else's proposal. There is nothing
      -- to reject about a band a person is stating; they state a different one.
      and decision = 'approved')
  );

-- ------------------------------------------------- and only then, the nulls ---

/*
 * THE NOT NULLs COME OFF LAST, AND THAT ORDERING IS THE WHOLE SAFETY OF THIS
 * FILE. Dropping them first opens a window in which a proposal row can be
 * written with no sample behind it — `20261001000003_payouts.sql` timed out
 * between its `create table` and its guards and left `anon` holding full write
 * on a money-instruction table, which is how this rule got written down.
 *
 * Added above while every column is still NOT NULL, the shape constraint is
 * trivially satisfied by every row that exists and by every row any current
 * writer produces; it is what REPLACES the NOT NULL for a proposal row, so
 * stopping anywhere in this file leaves the table at least as closed as it
 * started.
 */
alter table public.category_price_revisions
  alter column proposed_min drop not null;
alter table public.category_price_revisions
  alter column proposed_max drop not null;
alter table public.category_price_revisions
  alter column sample drop not null;
alter table public.category_price_revisions
  alter column winsorised drop not null;
alter table public.category_price_revisions
  alter column capped drop not null;
