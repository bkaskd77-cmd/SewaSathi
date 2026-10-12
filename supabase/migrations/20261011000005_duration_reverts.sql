-- ---------------------------------------------------------------------------
-- A published duration a person took down, and what would bring it back.
--
-- WHY THIS EXISTS AT ALL. The duration loop is the one thing in this product
-- that acts on published data without a person, and the argument for that is
-- recorded in `duration-promotion.ts`: what we publish as a duration changes
-- what the scheduler RESERVES and not how long somebody is on the tools, so the
-- measurement is independent of the figure, and no duration touches a rupee.
-- That argument justifies acting unattended. It does not give anybody a way to
-- disagree, and until now there was none: a figure the loop published could be
-- changed only by editing the seed and running a migration — which is
-- `proposeBand`'s four-phase sin wearing a different hat, and the exact gap the
-- owner asked to close.
--
-- WHY A TABLE AND NOT JUST AN AUDIT ROW. `security_events` is written too, and
-- is the record that cannot be tidied. But it is a log read by a screen that
-- lists events; it cannot answer "is this figure currently held back, and what
-- would release it", which is a question the nightly sweep has to ask on every
-- run. `category_price_revisions` is the same shape for the same reason, one
-- decision over, and this file follows it deliberately.
--
-- AND THE SUPPRESSION IS THE PART THAT DOES WORK RATHER THAN RECORDING IT. The
-- loop acts unattended, so a revert with no suppression is undone by that
-- night's sweep: the sample has not changed, the median is the same number, and
-- the figure somebody just took down goes straight back up. A revert that lasts
-- until midnight is not a revert. `revertSuppressedBy`
-- (`lib/booking/duration-promotion.ts`) is the rule, written down rather than
-- implied: a revert suppresses a later promotion only while the figure is
-- IDENTICAL to the reverted one AND the sample has not grown by half again.
-- `publishable()` has already rounded — minutes to the nearest five, a span
-- down to a whole day — so "identical" needs no tolerance, and the sample
-- clause is the escape hatch for a revert that meant "too soon" rather than
-- "wrong shape". Both must break.
--
-- IT IS NEVER SILENT. `/admin/duration` names the reverted figure, the reason,
-- and the sample that would release it, because a suppressed proposal and no
-- proposal must not look alike — `category_price_revisions` learned that, and
-- here it matters more, since the thing being suppressed is a machine that
-- would otherwise act tonight.
--
-- NOT AN OBSERVATION ROW. `duration_observations.observed` means "what the data
-- says" and `published` means "what was in force": a revert is neither, and
-- writing one there would put a decision into two measurement columns. Rule 6
-- in the shape it takes for a log. The sweep writes an observation with
-- outcome `suppressed` on the nights the revert holds, which IS a measurement
-- of the loop's reasoning and belongs there.
--
-- Ordered create -> RLS and revokes -> trigger and constraints -> policy and
-- grant, so stopping anywhere leaves a table nobody can reach. Plain statements
-- rather than a DO block: `20261002000004` measured that one bare statement per
-- call is what is reliable over the agent's connection, and nothing here is
-- destructive.
-- ---------------------------------------------------------------------------

create table if not exists public.duration_reverts (
  id uuid primary key default gen_random_uuid(),

  category_slug text not null
    references public.categories (slug) on update cascade on delete cascade,
  -- Not a foreign key: sub-bands live in `category_price_bands`, keyed on the
  -- pair, and `band_slug` is already the identity everything downstream joins
  -- on. A revert of a sub-band that is later renamed should read as a revert of
  -- a product that no longer exists, which is the truth, rather than cascading
  -- onto whatever took its name.
  band_slug text not null,

  kind text not null,

  -- The figure that was taken down, and the one restored in its place. Kept
  -- rather than joined, for the reason `band_min` is frozen onto a booking: a
  -- figure we have since moved would otherwise re-describe every decision made
  -- before it.
  from_value integer not null check (from_value > 0),
  to_value integer not null check (to_value > 0),

  -- The provenance restored with it, which is whatever the figure carried
  -- before the loop replaced it — read off the promotion's own observation row
  -- rather than assumed. ALL THREE VALUES, INCLUDING `observed`: a sub-band the
  -- loop has promoted twice reverts to the earlier MEASUREMENT, and refusing
  -- that would make the second promotion unrevertable. A first draft of this
  -- file refused it, on the reasoning that an observed target would read as
  -- `settled` and stop the loop looking — which is simply not what
  -- `proposeDuration` does: `settled` needs the median to EQUAL the published
  -- figure, and after a revert it does not, so the decision is `suppressed` and
  -- the suppression is what holds.
  to_source text not null,

  -- The sample the reverted figure was computed from. This is what the
  -- suppression rule is keyed on, and it is why a revert is not just a write:
  -- without it, "has the evidence moved" has no denominator.
  sample integer not null check (sample >= 1),

  -- Null only if the profile is later deleted. A revert with no actor is not
  -- writable: the insert names one.
  actor_id uuid references public.profiles (id) on delete set null,

  -- Required and required to be non-blank. A duration is published copy that
  -- holds a professional's week and that a customer plans around; "why" is the
  -- part a future reader needs and the part nobody writes unless the form
  -- insists. `category_price_revisions` made the same call.
  reason text not null check (length(btrim(reason)) > 0),

  reverted_at timestamptz not null default now()
);

comment on table public.duration_reverts is
  'Append-only history of published durations a person took down. It also does work: the nightly sweep reads the latest row per sub-band and kind, and revertSuppressedBy holds the same figure back until the sample grows by half again. Never silent — /admin/duration names the figure, the reason and what would release it.';
comment on column public.duration_reverts.sample is
  'The sample the reverted figure was computed from. The denominator the suppression rule needs: without it, "has the evidence moved" cannot be answered.';
comment on column public.duration_reverts.to_source is
  'The provenance restored, read off the promotion''s own observation row. Includes observed: a sub-band promoted twice reverts to the earlier measurement.';

alter table public.duration_reverts enable row level security;

revoke all on table public.duration_reverts from public, anon, authenticated;

drop trigger if exists duration_reverts_append_only on public.duration_reverts;
create trigger duration_reverts_append_only
  before update or delete on public.duration_reverts
  for each row execute function public.refuse_rewrite();

create index if not exists duration_reverts_band_idx
  on public.duration_reverts (category_slug, band_slug, kind, reverted_at desc);

alter table public.duration_reverts
  add constraint duration_reverts_kind_check
    check (kind in ('minutes', 'span')),
  add constraint duration_reverts_to_source_check
    check (to_source in ('invented', 'researched', 'observed')),
  add constraint duration_reverts_moved_check
    check (from_value <> to_value);

-- Admins read it: it is the evidence behind a figure the loop is not allowed to
-- publish, and the screen that shows a suppressed proposal shows why.
drop policy if exists "Admins read every duration revert" on public.duration_reverts;
create policy "Admins read every duration revert"
  on public.duration_reverts for select to authenticated
  using (public.is_admin());

-- A NEW TABLE GRANTS NOTHING UNTIL IT SAYS SO. `20261002000001` closed the
-- default privilege, so the policy above decides which rows and this decides
-- whether anybody may ask at all. SELECT only, and every write is the service
-- role — `lib/data/duration-loop.ts`, like every other write to published data.
grant select on table public.duration_reverts to authenticated;

-- ---------------------------------------------------------------------------
-- The observation outcomes gain `suppressed`
-- ---------------------------------------------------------------------------
--
-- ONE LIST WRITTEN TWICE, and `LOGGABLE_REASONS` is the recorded cost of
-- letting the two drift: a value the column refuses loses the row in the same
-- statement that writes it, and here that row is the only evidence that the
-- loop looked and was held back. `DURATION_OUTCOMES` in
-- `lib/booking/duration-promotion.ts` is the other copy and the db suite
-- compares them, out of `pg_constraint` rather than out of this file.
--
-- `alter table ... drop constraint` is the one destructive-shaped statement
-- that is instant over the agent's connection — measured, and the reason every
-- check constraint in this schema is changed by dropping and re-adding it.

alter table public.duration_observations
  drop constraint if exists duration_observations_outcome_check;

alter table public.duration_observations
  add constraint duration_observations_outcome_check
    check (outcome in ('applied', 'below-floor', 'settled', 'suppressed'));

comment on column public.duration_observations.outcome is
  'applied, below-floor, settled or suppressed. no-evidence is never a row: cron_runs already says the sweep ran, and seventy-two nightly rows asserting nothing happened is how a log stops being read. suppressed is a night the loop would have acted and a revert held it back.';
