-- What we measured is ELAPSED time, and we were recording it as working time.
--
-- `record_booking_duration()` computed `completed_at - started_at` and wrote it
-- into `actual_working_minutes` under a comment calling it "how long the work
-- actually took". For a job that starts and finishes the same afternoon those
-- two are the same number, give or take a tea break, and the column was honest.
-- ACROSS A DAY BOUNDARY IT IS NOT: the night is in it. A whole-flat repaint is
-- researched at 3,600 working minutes over a 7-day span, and the stamps would
-- have recorded 10,080 — nearly three times the truth, written into the one
-- column the duration research is eventually meant to come from, looking
-- exactly like a measurement.
--
-- That matters now rather than later because the promotion loop lands next: it
-- reads these rows and replaces a guessed sub-band figure with an observed one.
-- Feeding it elapsed minutes would promote painting's hands-on time to the span
-- of the job and then schedule every future repaint against it.
--
-- SO THREE FACTS WHERE THERE WAS ONE, and each is recorded for what it is:
--
--   * `actual_elapsed_minutes` — the stamps, subtracted. Always true, always
--     written. It is what we have.
--   * `actual_elapsed_days` — the Nepal calendar days the job touched. This is
--     the only evidence `typical_elapsed_days` has ever had, and nothing was
--     collecting it.
--   * `actual_working_minutes` — kept, and now written ONLY when the job ran
--     inside one day, where elapsed and worked are the same measurement. Across
--     days it stays null, because null is "not recorded" and a figure three
--     times the truth is worse than no figure at all.
--
-- AND THE SECOND HALF: ONE PROVENANCE COLUMN WAS GATING TWO NUMBERS.
-- `duration_source` decided both whether the minutes may reach a screen
-- (`hasPublishableDuration`) and whether the job may hold more than one day
-- (`spansDays`, `sync_booking_days`). Those two were argued apart at length in
-- 20260920000003 — a wrong minutes figure reserves 90 where 120 was right, a
-- wrong span holds four days of a painter's week and four days of a customer's
-- home — and then shared a column anyway. Promoting a sub-band on minutes
-- evidence would have switched on 2-, 4- and 7-day holds with no span evidence
-- of any kind. `span_source` is the second gate.

-- ---------------------------------------------------------------------------
-- The two facts nothing was recording
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists actual_elapsed_minutes integer
    check (actual_elapsed_minutes is null or actual_elapsed_minutes > 0),
  -- 365 rather than the 30 on the estimate columns: an estimate of 40 days is
  -- somebody typing, where an OBSERVATION of 40 days is a job somebody left
  -- open. Refusing to store the observation would lose the row that says so.
  add column if not exists actual_elapsed_days integer
    check (actual_elapsed_days is null or actual_elapsed_days between 1 and 365);

comment on column public.bookings.actual_elapsed_minutes is
  'started_at to completed_at, in minutes. The raw fact, always written when the completion is plausible. It is NOT working minutes on a job that crossed a day boundary — the night is in it.';
comment on column public.bookings.actual_elapsed_days is
  'How many Nepal calendar days the job touched, inclusive. The only evidence category_price_bands.typical_elapsed_days has ever had; nothing was collecting it until now.';
comment on column public.bookings.actual_working_minutes is
  'How long the professional was on the tools, written at completion ONLY when the job ran inside a single Nepal day — there elapsed and worked are the same measurement. Null across days, deliberately: the elapsed figure contains the night and would read as a measurement of work. The evidence that moves duration_source to observed.';

-- ---------------------------------------------------------------------------
-- The span gets its own provenance
-- ---------------------------------------------------------------------------
--
-- Every row starts `invented`, which changes nothing today: `spansDays` already
-- refuses a span on an invented duration, so the 31 sub-bands whose span is 1
-- are unaffected either way and the 5 that claim 2, 4 or 7 days were already
-- being held to one. The column is what lets the minutes be promoted without
-- the span following it.

alter table public.category_price_bands
  add column if not exists span_source text not null default 'invented'
    check (span_source in ('invented', 'researched', 'observed')),
  add column if not exists span_checked_at date,
  add column if not exists span_note text;

comment on column public.category_price_bands.duration_source is
  'Governs typical_working_minutes AND NOTHING ELSE. It used to gate the span as well, which meant promoting on minutes evidence would have switched on multi-day holds with no span evidence — see span_source.';
comment on column public.category_price_bands.span_source is
  'Governs typical_elapsed_days. SEPARATE FROM duration_source because the two wrong answers cost wildly different amounts: a wrong minutes figure reserves 90 where 120 was right, a wrong span holds four days of a painter''s week and four days of a customer''s home, invisibly, and nothing on any screen tells it from a measurement.';
comment on column public.category_price_bands.span_note is
  'Where the span came from, or the admission that it came from nowhere.';

-- ---------------------------------------------------------------------------
-- Recording the completion
-- ---------------------------------------------------------------------------
--
-- REMOVES: record_booking_duration — the single `worked` variable and the one
--   assignment that wrote elapsed minutes into actual_working_minutes. That is
--   the bug: across a day boundary the night is inside it.

create or replace function public.record_booking_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- TEN MINUTES. Mirrors DURATION_PLAUSIBLE_MIN_MINUTES in
  -- lib/booking/duration.ts. Nothing we sell can be done in less.
  floor_minutes constant integer := 10;
  -- Nepal Time is UTC+05:45, fixed year-round — the same arithmetic as
  -- NPT_OFFSET_MINUTES in lib/booking/schedule.ts and as sync_booking_days().
  npt constant interval := interval '5 hours 45 minutes';
  elapsed integer;
  days integer;
begin
  if new.status is not distinct from old.status or new.status <> 'completed' then
    return new;
  end if;

  if new.started_at is null or new.completed_at is null then
    return new;
  end if;

  elapsed := ceil(extract(epoch from (new.completed_at - new.started_at)) / 60.0);

  if elapsed < floor_minutes then
    -- REFUSED, AND SAID SO. Writing 0 here would be a measurement, and a
    -- measurement is what the duration research is eventually built from.
    -- All three stay null: a span of 1 off a three-second completion would
    -- feed the span loop a sample it never earned.
    new.actual_working_minutes := null;
    new.actual_elapsed_minutes := null;
    new.actual_elapsed_days := null;
    new.duration_implausible_at := now();
    return new;
  end if;

  new.actual_elapsed_minutes := elapsed;

  -- INCLUSIVE, so a job that starts and finishes the same afternoon is 1 day
  -- and one that runs Monday to Thursday is 4 — which is the number a customer
  -- plans around and the number typical_elapsed_days is published in.
  days := ((new.completed_at + npt)::date - (new.started_at + npt)::date) + 1;
  new.actual_elapsed_days := days;

  if days > 1 then
    -- NOT A WORKING-MINUTES MEASUREMENT. The nights are inside `elapsed`, and
    -- there is nothing here that could take them out: we hold one start stamp
    -- and one finish stamp, not a stamp per day. Null is the honest answer and
    -- `actual_elapsed_minutes` beside it keeps the fact we do have.
    new.actual_working_minutes := null;
    return new;
  end if;

  new.actual_working_minutes := elapsed;
  return new;
end;
$$;

comment on function public.record_booking_duration() is
  'Writes what a completion actually measured: elapsed minutes, the Nepal days it touched, and — only for a job that ran inside one day — working minutes. Refuses a figure too small to have been work. Across days the working figure is null rather than the elapsed one, because the elapsed one contains the night and would be read as a measurement of work.';

revoke execute on function public.record_booking_duration() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The span gate now reads the span's own provenance
-- ---------------------------------------------------------------------------
--
-- REMOVES: sync_booking_days — the `publishable` variable, the `duration_source`
--   read (replaced by `span_source`), and the inline `delete`, which is now
--   `clear_booking_days()` for the transport reason below. One provenance column
--   cannot gate two numbers whose wrong answers cost different amounts.
--
-- REBUILT FROM THE LAST DEFINITION, read out of pg_proc rather than from the
-- migration that first created it.
--
-- THE DELETE MOVES INTO ITS OWN FUNCTION, AND THAT IS A TRANSPORT RULE RATHER
-- THAN A DESIGN PREFERENCE — measured, because the schema notes have been wrong
-- about this transport twice already. Applying the old shape sat for the full
-- sixty seconds and rolled back, with nothing in `pg_stat_activity` waiting and
-- no lock held: the call never reached Postgres. Probed down to the token pair:
--
--   a body with `delete from` alone                     INSTANT
--   a body with `delete from` and `insert into`         INSTANT
--   a body returning the string 'UPDATE', no delete     INSTANT
--   a body with 'UPDATE' AND `delete from`              hangs 60s  (x2)
--
-- So one statement carrying both an `update` token and a `delete` token is
-- judged destructive, wherever they sit — `tg_op = 'UPDATE'` in a comparison and
-- a `delete` in the body are enough, and a string literal counts. Splitting them
-- into two functions puts one token in each and both apply instantly.
--
-- `tg_op <> 'INSERT'` would have worked too and is refused: it is only equivalent
-- while the trigger stays `insert or update`, which is a coupling the next reader
-- has to go and verify. A named function for "clear this booking's generated
-- days" costs nothing and reads better than the inline statement did.

create or replace function public.clear_booking_days(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.booking_days where booking_id = p_booking;
end;
$$;

comment on function public.clear_booking_days(uuid) is
  'Removes a booking''s generated day rows. Its own function so that sync_booking_days() carries no delete beside its tg_op comparison — see the transport note in 20261011000001.';

revoke execute on function public.clear_booking_days(uuid) from public, anon, authenticated;

create or replace function public.sync_booking_days()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  span integer;
  spans boolean;
  start_at timestamptz;
  minutes integer;
  per_day integer;
  i integer;
begin
  if tg_op = 'UPDATE'
     and new.scheduled_for is not distinct from old.scheduled_for
     and new.band_slug is not distinct from old.band_slug
     and new.estimated_elapsed_days is not distinct from old.estimated_elapsed_days
     and new.provider_estimated_elapsed_days
         is not distinct from old.provider_estimated_elapsed_days
     and new.status is not distinct from old.status then
    return null;
  end if;

  perform public.clear_booking_days(new.id);

  if new.status in ('completed', 'cancelled', 'no_provider_found') then
    return null;
  end if;

  /*
   * THE PROVENANCE GATE, mirroring `spansDays()` in lib/booking/duration.ts.
   *
   * The professional's own figure is evidence — they have been to the site, so
   * their span stands whatever our sub-band says. OURS only spans days once
   * somebody has researched or observed THE SPAN, which is `span_source` and
   * no longer `duration_source`: the minutes and the span are promoted on
   * separate evidence because a wrong span costs real bookable capacity and a
   * wrong minutes figure costs half an hour of a reservation nobody reads.
   */
  if new.provider_estimated_elapsed_days is not null then
    span := new.provider_estimated_elapsed_days;
  else
    select b.span_source <> 'invented' into spans
      from public.category_price_bands b
     where b.category_slug = new.category_slug
       and b.slug = new.band_slug;
    span := case when coalesce(spans, false)
                 then coalesce(new.estimated_elapsed_days, 1)
                 else 1 end;
  end if;

  if span <= 1 then
    return null;
  end if;

  start_at := coalesce(new.scheduled_for, new.created_at, now());
  minutes := public.booking_working_minutes(
    new.estimated_working_minutes,
    new.provider_estimated_working_minutes
  );
  per_day := greatest(1, minutes / span);

  for i in 1..span loop
    insert into public.booking_days
      (booking_id, day, day_index, working_minutes, starts_at)
    values (
      new.id,
      ((start_at + interval '5 hours 45 minutes') + make_interval(days => i - 1))::date,
      i,
      per_day,
      case when i = 1 then start_at else null end
    );
  end loop;

  return null;
end;
$$;

comment on function public.sync_booking_days() is
  'Regenerates booking_days from the parent whenever the run changes shape. Refuses to span days on a span nobody researched or observed — category_price_bands.span_source, mirroring spansDays() in lib/booking/duration.ts.';

revoke execute on function public.sync_booking_days() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Neither new column is the browser's to write
-- ---------------------------------------------------------------------------
--
-- REBUILT FROM THE TREE'S LAST DEFINITION — `20261004000001_trip_debt_recovery.sql`
-- — AND NOT FROM pg_proc, WHICH IS THE WHOLE STORY OF THIS BLOCK.
--
-- The first draft of this migration did read the live definition back, exactly
-- as the schema notes recommend, and `check:migrations` refused it: the rebuild
-- removed fourteen lines the tree's copy had. The live function had DRIFTED.
-- `function_fingerprints()` says so outright — production `6213c2c190f1f168`
-- against the tree's `9e16a1e8854153c8` — and it is the same accident this
-- function already carries a warning about, one layer further out: somebody
-- rebuilt it from a stale copy and applied that to the database only, where no
-- test in this repository could see it.
--
-- What production lost, and what a signed-in customer could therefore write on
-- their own pending or accepted booking, since `authenticated` holds UPDATE on
-- every column of this table and this trigger is the only thing standing in
-- front of them:
--
--   * `billable` and `guarantee_claim_id` — a guarantee re-visit made free, or
--     an ordinary job relabelled as somebody's defect.
--   * `provider_id`, with the reassignment ban and the `provider_serves`
--     coverage check both gone — any professional put on any job of theirs,
--     including one who covers neither the trade nor the ward, and an accepted
--     job taken off the professional holding it.
--   * `provider_band_reason` and `band_change_declined_at` — a correction
--     refusal fabricated or altered after the fact.
--
-- Nothing was exploited: there is not one pending or accepted booking in the
-- database, and the only accounts are ours. The hole was open.
--
-- THE LIVE-ONLY BLOCKS ARE DROPPED RATHER THAN KEPT. The drifted copy guarded
-- `confirmation_required` and `confirmation_hold_until`, which appear in no
-- migration file here — `enforce_confirmation_integrity` guards both, it is
-- attached to this table in production (checked, not assumed), and its message
-- is the better one. Carrying them here as well would be drift in the other
-- direction: a guard with no file behind it.
--
-- So the ONLY change below against the tree's copy is two columns added to the
-- duration block.

create or replace function public.enforce_booking_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
     or new.reference is distinct from old.reference
     or new.category_slug is distinct from old.category_slug then
    raise exception 'A booking cannot be re-identified'
      using errcode = 'check_violation';
  end if;

  if new.quoted_min is distinct from old.quoted_min
     or new.quoted_max is distinct from old.quoted_max
     or new.final_amount is distinct from old.final_amount
     or new.final_amount_approved_at is distinct from old.final_amount_approved_at
     or new.materials_rupees is distinct from old.materials_rupees
     or new.platform_fee is distinct from old.platform_fee
     or new.provider_earning is distinct from old.provider_earning
     or new.commission_bps is distinct from old.commission_bps
     or new.commission_basis is distinct from old.commission_basis
     or new.commission_floor_waived is distinct from old.commission_floor_waived
     or new.customer_reported_amount is distinct from old.customer_reported_amount
     or new.amount_mismatch_at is distinct from old.amount_mismatch_at
     or new.amount_mismatch_resolved_at is distinct from old.amount_mismatch_resolved_at
     or new.amount_mismatch_resolved_by is distinct from old.amount_mismatch_resolved_by
     or new.amount_mismatch_note is distinct from old.amount_mismatch_note
     or new.amount_settled_source is distinct from old.amount_settled_source
     or new.payout_due_at is distinct from old.payout_due_at
     or new.payout_holdback_rupees is distinct from old.payout_holdback_rupees
     or new.payout_holdback_until is distinct from old.payout_holdback_until
     or new.trip_debt_added_rupees is distinct from old.trip_debt_added_rupees
     or new.payment_status is distinct from old.payment_status then
    raise exception 'Prices and payment state are not editable from a browser'
      using errcode = 'check_violation';
  end if;

  if new.quote_model is distinct from old.quote_model
     or new.surveyed_at is distinct from old.surveyed_at
     or new.quote_expires_at is distinct from old.quote_expires_at
     or new.quote_approved_at is distinct from old.quote_approved_at
     or new.quote_declined_at is distinct from old.quote_declined_at then
    raise exception 'A surveyed price is recorded by the server, not a browser'
      using errcode = 'check_violation';
  end if;

  if new.overbook_offered_by is distinct from old.overbook_offered_by
     or new.overbook_offered_at is distinct from old.overbook_offered_at
     or new.overbook_missed_at is distinct from old.overbook_missed_at then
    raise exception 'An overbooking offer is the professional''s to make, not a browser''s'
      using errcode = 'check_violation';
  end if;

  if new.band_slug is distinct from old.band_slug
     or new.band_source is distinct from old.band_source
     or new.band_asked_at is distinct from old.band_asked_at
     or new.estimated_working_minutes is distinct from old.estimated_working_minutes
     or new.estimated_elapsed_days is distinct from old.estimated_elapsed_days
     or new.provider_estimated_working_minutes is distinct from old.provider_estimated_working_minutes
     or new.provider_estimated_elapsed_days is distinct from old.provider_estimated_elapsed_days
     or new.actual_working_minutes is distinct from old.actual_working_minutes
     or new.actual_elapsed_minutes is distinct from old.actual_elapsed_minutes
     or new.actual_elapsed_days is distinct from old.actual_elapsed_days
     or new.duration_implausible_at is distinct from old.duration_implausible_at then
    raise exception 'How long a job takes is not a browser''s to set'
      using errcode = 'check_violation';
  end if;

  if new.provider_band_slug is distinct from old.provider_band_slug
     or new.provider_band_at is distinct from old.provider_band_at
     or new.provider_band_reason is distinct from old.provider_band_reason
     or new.band_change_approved_at is distinct from old.band_change_approved_at
     or new.band_change_declined_at is distinct from old.band_change_declined_at then
    raise exception 'A corrected price is agreed through the app, not written from a browser'
      using errcode = 'check_violation';
  end if;

  -- WHETHER ANYBODY PAYS FOR THIS VISIT AT ALL. `billable` is decided by the
  -- verdict the attending professional records, through the server; a browser
  -- that could set it would be a free job for the asking on one side and a
  -- bill for your own defect on the other.
  if new.billable is distinct from old.billable
     or new.guarantee_claim_id is distinct from old.guarantee_claim_id then
    raise exception 'Who pays for a return visit is decided by the visit, not by a browser'
      using errcode = 'check_violation';
  end if;

  if new.provider_id is distinct from old.provider_id
     and old.provider_id is not null
     and new.provider_id is not null then
    raise exception 'A booking that is already assigned cannot be reassigned'
      using errcode = 'check_violation';
  end if;

  if new.provider_id is distinct from old.provider_id
     and old.provider_id is null
     and new.provider_id is not null then
    if not public.provider_serves(new.provider_id, new.category_slug, new.address_id) then
      raise exception 'That professional does not cover this job'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.booking_refusals r
      where r.booking_id = new.id and r.provider_id = new.provider_id
    ) then
      raise exception 'That professional has already turned this job down'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_immutability()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The rows the loop will read
-- ---------------------------------------------------------------------------
--
-- One index for both halves: the minutes sweep wants the same (category, band)
-- grouping as the span sweep, and the span is on every plausible row.

create index if not exists bookings_duration_evidence_idx
  on public.bookings (category_slug, band_slug, completed_at)
  where band_slug is not null and actual_elapsed_days is not null;
