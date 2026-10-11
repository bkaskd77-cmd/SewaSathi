-- What the duration loop saw, and what it did about it.
--
-- WHAT THE LOOP IS. All 36 sub-band durations were authored `invented` and
-- every screen is silent about length because of it; `spansDays` refuses a
-- multi-day hold for the same reason. The way out was always "observe them",
-- and until this week nothing observed anything — `actual_working_minutes` was
-- recording elapsed time, `actual_elapsed_days` did not exist, and no code read
-- either. `proposeDuration` in lib/booking/duration-promotion.ts is the rule
-- and `lib/data/duration-loop.ts` applies it nightly.
--
-- WHY THE LOG EXISTS AT ALL. The loop acts without a person, so the only way to
-- answer "why is this published as 90 minutes?" afterwards is a row saying what
-- the sample was on the night it moved. It is also the shadow half: a sub-band
-- below its floor logs what it WOULD do, every night, so the figure can be
-- watched converging before it is ever used. A loop whose reasoning is only
-- visible at the moment it fires is a loop nobody can trust with a calendar.
--
-- APPEND-ONLY FOR EVERY CALLER, the service role included — `refuse_rewrite`,
-- the same trigger as `security_events` and `application_decisions`. The whole
-- value is that "the loop decided this on that date" cannot later be tidied
-- into something else.
--
-- A ROW ONLY WHERE THERE IS EVIDENCE. Thirty-six sub-bands times two kinds,
-- nightly, with nothing measured, is seventy-two rows a day asserting that
-- nothing happened — and `cron_runs` already records that the sweep ran, which
-- is the fact that was genuinely unobservable. `durationOutcome` returns null
-- for `no-evidence` and the sweep writes nothing.

create table if not exists public.duration_observations (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null default now(),
  -- NO FOREIGN KEY TO category_price_bands, deliberately, where `bookings` has
  -- a composite one. A measurement is a fact about a product at a point in
  -- time, and retiring the product does not unmake it — an `on delete cascade`
  -- would erase exactly the history that explains a published figure. The risk
  -- a key would close is a mistyped slug, and there is one writer, which reads
  -- these pairs out of category_price_bands in the same sweep.
  category_slug text not null,
  band_slug text not null,
  kind text not null,
  -- How many plausible measurements the median came out of.
  sample integer not null,
  -- The median, rounded the way this kind is published.
  observed integer not null,
  -- What was published at the moment of the reading, and its provenance. Frozen
  -- here rather than joined later, for the same reason `commission_bps` is
  -- frozen onto a booking: a later change must not rewrite what this row said.
  published integer not null,
  published_source text not null,
  -- Values outside the Tukey fence. A signal that the sub-band is two different
  -- jobs under one name, never a reason to drop anything: the median is already
  -- robust, so clamping would change the figure not at all.
  unusual integer not null default 0,
  -- The floor in force that night, so a later change to MIN_DURATION_SAMPLE
  -- leaves this row readable rather than retrospectively wrong.
  floor_sample integer not null,
  outcome text not null
);

comment on table public.duration_observations is
  'One reading by the duration loop, per sub-band and per kind, on the nights it had anything to read. Append-only. It is the shadow half as well as the record: a sub-band below its floor logs what it would do, so a figure can be watched converging before anything uses it.';
comment on column public.duration_observations.kind is
  'minutes or span. Promoted on separate evidence and separate floors, because a wrong minutes figure costs a reservation and a wrong span holds four days of a painter''s week.';
comment on column public.duration_observations.unusual is
  'How many measurements fell outside the Tukey fence. Reported, never removed — the median is robust, so this is a signal that the product is really two products.';
comment on column public.duration_observations.outcome is
  'applied, below-floor or settled. no-evidence is never a row: cron_runs already says the sweep ran, and seventy-two nightly rows asserting nothing happened is how a log stops being read.';

alter table public.duration_observations enable row level security;

revoke all on public.duration_observations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Append-only, and the shapes a row may hold
-- ---------------------------------------------------------------------------

drop trigger if exists duration_observations_append_only
  on public.duration_observations;
create trigger duration_observations_append_only
  before update or delete on public.duration_observations
  for each row execute function public.refuse_rewrite();

alter table public.duration_observations
  add constraint duration_observations_kind_check
    check (kind in ('minutes', 'span')),
  add constraint duration_observations_outcome_check
    check (outcome in ('applied', 'below-floor', 'settled')),
  add constraint duration_observations_sample_check
    check (sample >= 1),
  add constraint duration_observations_shape_check
    check (observed > 0 and published > 0 and unusual >= 0 and floor_sample >= 1),
  add constraint duration_observations_source_check
    check (published_source in ('invented', 'researched', 'observed'));

-- ---------------------------------------------------------------------------
-- Who may read it
-- ---------------------------------------------------------------------------

drop policy if exists "Admins read duration observations"
  on public.duration_observations;
create policy "Admins read duration observations"
  on public.duration_observations for select
  to authenticated
  using (public.is_admin());

-- A NEW TABLE GRANTS NOTHING on this project — the default privilege was
-- revoked in 20261002000001 — so the policy above decides which rows and this
-- decides whether anybody may ask at all. The screen reads through the service
-- role; the grant is here so an admin session can read it directly too.
grant select on public.duration_observations to authenticated;

-- No insert, update or delete grant for any browser role. The sweep writes
-- under the service role and nothing else writes at all.

create index if not exists duration_observations_band_idx
  on public.duration_observations (category_slug, band_slug, kind, observed_at desc);
