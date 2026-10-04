-- REMOVES: enforce_booking_immutability — nothing. It gains one column in the
--   money block and keeps every other line of its latest definition
--   (20260926000003_payout_holdback.sql). Rebuilt from that file, not from the
--   first one: the trigger is redefined four times as the schema grew, and
--   rebuilding from an earlier copy silently drops the guards added since.

-- ---------------------------------------------------------------------------
-- Recover the trip debt from the customer's next bill, once and visibly.
--
-- WHAT THE TERMS ALREADY PROMISE, in plain words on a page anybody can read: "If it
-- keeps happening, the cost of the trip is added to your next booking: at most a
-- quarter of that bill at a time, until it is settled. We will never ring you asking
-- for money and we will never take it from you any other way. If you do not book
-- again, we write it off." `applyTripDebtToBill` has implemented that since Phase 10
-- with **no caller** — a published promise with nothing behind it, the same shape as
-- the trip payment itself.
--
-- WHY A COLUMN AND NOT JUST A CALL. `recordFinalAmount` is re-enterable by design: a
-- professional correcting a typed figure runs it again, and its update is
-- `.eq("id", bookingId)` with no guard on `final_amount is null`. The function it
-- would call decrements `customer_risk.trip_debt_rupees` directly, so each re-record
-- would recover the debt again. Every other recovery in this product is made
-- idempotent by the database (`provider_ledger_recovery_once_idx`,
-- `our_reference`); this is the booking-shaped version of that.
--
-- NULL IS "NOT CONSIDERED", 0 IS "CONSIDERED AND NOTHING WAS OWED" — rule 6, and
-- here it is load-bearing rather than tidy: the re-record guard asks "is this null",
-- so collapsing the two would make a booking that legitimately owed nothing
-- indistinguishable from one nobody has looked at, and the second record would
-- recover from a customer who had already been charged.
--
-- IT IS A `*_rupees` COLUMN THAT ASSERTS MONEY MOVED, so it is named explicitly in
-- `MONEY_ASSERTING_NAMES` — the pattern only catches past-tense verbs, and this is
-- exactly the dodge that file records.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists trip_debt_added_rupees integer
    check (trip_debt_added_rupees is null or trip_debt_added_rupees >= 0);

comment on column public.bookings.trip_debt_added_rupees is
  'What a past no-show trip added to this bill. NULL means nobody has considered it yet; 0 means considered and nothing was owed. The difference is what stops a re-recorded final amount charging twice.';

-- ---------------------------------------------------------------------------
-- The customer can say it did not happen, before they pay.
--
-- A DISPUTE HOLDS THE DEBT OFF THE BILL ENTIRELY rather than pausing a counter.
-- Recovering while somebody is disputing is how a complaint becomes a grievance: the
-- money is already gone and the argument is about getting it back. Nothing is lost
-- by waiting — the debt stays on `customer_risk` and the next booking recovers it if
-- an admin upholds the claim.
--
-- ONE OPEN DISPUTE AT A TIME, which the stamp gives for free: it is set or it is
-- not. A resolved dispute clears it, and the no-show claim beside it carries the
-- decision and its reason, so this column never has to record an outcome.
-- ---------------------------------------------------------------------------

alter table public.customer_risk
  add column if not exists trip_debt_disputed_at timestamptz;

alter table public.customer_risk
  add column if not exists trip_debt_dispute_note text
    check (trip_debt_dispute_note is null or char_length(trip_debt_dispute_note) <= 1000);

comment on column public.customer_risk.trip_debt_disputed_at is
  'Set when the customer says the trip debt is wrong. While it is set no booking recovers anything — the debt is held off the bill rather than paused, because recovering mid-complaint is how a complaint becomes a grievance.';
comment on column public.customer_risk.trip_debt_dispute_note is
  'What the customer said, in their words. The decision and its reason live on the no_show_claims row an admin resolves.';

-- ---------------------------------------------------------------------------
-- The recovery figure is the server's, not a browser's.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS. RLS is row-level, so "Customers cancel their
-- own open bookings" lets a customer write every column on their own booking —
-- which is why this trigger exists at all. Without the new column in the list, a
-- customer could set `trip_debt_added_rupees` to 0 before settlement and never be
-- charged, or clear it back to null after one and be charged a second time by the
-- next re-record. Both directions are a money hole, and the column exists precisely
-- to be the thing nobody can forge.
--
-- `auth.uid()` is null for the service role, which is how `recordFinalAmount`'s own
-- write passes through — unchanged.
-- ---------------------------------------------------------------------------

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
