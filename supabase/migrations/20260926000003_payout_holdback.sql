-- REMOVES: provider_ledger_recovery_once_idx — replaced in this same file by
-- provider_ledger_recovery_tranche_idx, which is the same guard one level
-- finer. Nothing is weakened: the old index allowed one recovery per booking,
-- the new one allows one per booking PER TRANCHE, which is what a payout now
-- is. `enforce_booking_immutability` gains two lines and loses none.
--
-- ===========================================================================
-- A payout becomes a tranche, because the guarantee outlives the payout.
--
-- THE GAP THIS CLOSES. `GUARANTEE_WINDOWS` gives painting 90 days — peeling and
-- blistering take weeks to appear — and `PAYOUT_RULES` holds a payout for 24
-- hours to 7 days. So on precisely the trades where a defect surfaces late,
-- every rupee is gone before anybody can claim, and the only answer left is
-- `applyRedoRecovery` netting forward against future earnings: fine while the
-- professional keeps working, a write-off when they stop.
--
-- WHAT IS HELD AND WHY IT IS NOT THE THING ALREADY REFUSED. A quarter, for 30
-- days, only where the guarantee window is 90 days or more. Extending the hold
-- to cover the whole window was considered and refused — nobody works for a
-- platform that pays in a month, and it would punish the many who never
-- generate a claim. That refusal turned on three things, and this differs on
-- all three: a quarter rather than everything, 30 days rather than 90, and one
-- group of trades rather than every job.
--
-- THE RULE IS THE WINDOW, NOT THE TRADE. Painting is the only 90-day entry
-- today, so a literal list would behave identically and quietly stop being
-- right the moment somebody adds another long-window trade. `holdsBack()` in
-- lib/payments/payout.ts derives it, /providers/standards publishes it in those
-- terms, and `/admin/signals` lists which trades currently hold — a derived
-- rule nobody can enumerate is one we end up guessing about later.
--
-- IT TAKES NOTHING FROM ANYBODY. This is the professional's own money arriving
-- in two parts. It is not a fee, not a deduction and not a penalty, and it
-- never touches what the customer is quoted or pays.
--
-- NULL IS "NO HOLD HERE", NOT "ZERO HELD" — rule 6. A short-window trade, and a
-- job settled before this existed, have null in both columns. A hold whose
-- quarter rounded to nothing would be 0, which is a different fact; the shape
-- constraint keeps the pair honest and `payoutPlan` returns null rather than
-- splitting a payout to defer zero rupees. Nothing is backfilled.

alter table public.bookings
  add column if not exists payout_holdback_rupees integer
    check (payout_holdback_rupees is null or payout_holdback_rupees >= 0),
  add column if not exists payout_holdback_until timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_holdback_shape'
  ) then
    alter table public.bookings
      add constraint bookings_holdback_shape check (
        (payout_holdback_rupees is null) = (payout_holdback_until is null)
      );
  end if;
end $$;

comment on column public.bookings.payout_holdback_rupees is
  'The professional''s own money, deferred to payout_holdback_until rather than '
  'deducted. NULL means no hold applies (short guarantee window, or settled '
  'before this column); 0 would mean held and rounded to nothing, which is a '
  'different fact. See lib/payments/payout.ts payoutPlan.';

comment on column public.bookings.payout_holdback_until is
  'When the held part becomes payable. It is a payout in its own right: the '
  'redo recovery sweep can take a quarter of it, which is why the recovery '
  'index is per booking PER TRANCHE.';

-- ---------------------------------------------------------------------------
-- A recovery now happens once per TRANCHE, not once per booking.
--
-- WHY THE OLD INDEX HAD TO GO. `provider_ledger_recovery_once_idx` was
-- unique (booking_id) where kind = 'recovery', and its own comment said a
-- booking IS what a payout is in this product. With two payable dates that is
-- no longer true, and the published promise — never more than a quarter of any
-- one payout — is measured against each of them.
--
-- AND IT WOULD HAVE FAILED SILENTLY, WHICH IS WHY THIS IS A MIGRATION RATHER
-- THAN A COMMENT. `sweepRedoRecovery` reads existing recovery rows into an
-- `alreadyDone` set and filters those bookings out BEFORE attempting any
-- insert. So with the old index in place the released holdback would have been
-- paid in full, no row written, no unique violation raised and nothing logged.
-- A guard that has quietly stopped guarding.
--
-- THE DEFAULT IS A FACT, NOT A GUESS. Every recovery row that already exists
-- was taken against an undivided payout, which is exactly what 'main' means —
-- so defaulting is recording what happened, not inferring it. That is the
-- distinction rule 6 turns on, and it is why this column is not nullable.

alter table public.provider_ledger
  add column if not exists tranche text not null default 'main';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'provider_ledger_tranche_known'
  ) then
    alter table public.provider_ledger
      add constraint provider_ledger_tranche_known
        check (tranche in ('main', 'holdback'));
  end if;
end $$;

comment on column public.provider_ledger.tranche is
  'Which part of a payout this row is about. Every pre-existing row is ''main'' '
  'because payouts were undivided — a record of what happened, not an inference.';

drop index if exists public.provider_ledger_recovery_once_idx;

create unique index if not exists provider_ledger_recovery_tranche_idx
  on public.provider_ledger (booking_id, tranche)
  where kind = 'recovery';

comment on index public.provider_ledger_recovery_tranche_idx is
  'One recovery per payout, and a payout is now a tranche of a booking rather than the whole of it. Same idiom as our_reference: a concurrent sweep is refused by the database rather than remembered against by the application.';

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
-- Same lockdown the function has carried since 20260903000001. Firing a trigger
-- does not re-check execute against the caller, so this costs nothing at
-- runtime and closes the direct-call route.
revoke execute on function public.enforce_booking_immutability() from public, anon, authenticated;
