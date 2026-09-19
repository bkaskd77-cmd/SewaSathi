-- The return visit becomes a real booking.
--
-- WHAT WAS WRONG. `guarantee_claims.visit_booking_id` has existed since the
-- claim table was written and NOTHING EVER WROTE IT. The return visit was the
-- claim row itself, which meant the thing the guarantee actually promises —
-- "we send somebody back" — had no slot, no dispatch, no capacity seat, no
-- arrival record and no way to be paid for. Three consequences, all of them
-- load-bearing:
--
--   * A redo consumed none of the professional's day. It did not take a seat
--     from `enforce_slot_capacity`, did not count against `crew_count`, and
--     did not appear in `providerCapacity` — so a professional could be sent
--     back to a job while the scheduler believed they were free.
--   * "Three failed access attempts" cannot be counted, because attempts live
--     in `booking_arrivals` and that hangs off a booking.
--   * `claimOutcome`'s `payer: 'customer'` branch — "an ordinary job at the
--     ordinary price" — had no job to price.
--
-- WHY THE VISIT IS NOT PRICED AT ZERO. `quoted_min integer not null check
-- (quoted_min > 0)` forbids it, and rightly: a zero band would make the
-- professional's time worth nothing to every rule that reads a band. So the
-- visit CARRIES THE PARENT'S FROZEN BAND and a separate flag decides whether
-- anybody is charged. The price is real; `billable` says who pays it.
--
-- That is also what makes the `differentProblem` verdict one field rather than
-- a re-pricing: the band was frozen before anybody travelled, so the customer
-- knew what it would cost if it turned out not to be our fault BEFORE the
-- visit — the same rule the price correction follows, for the same reason.

-- ---------------------------------------------------------------------------
-- The two columns
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists guarantee_claim_id uuid
    references public.guarantee_claims (id) on delete set null;

/*
 * DEFAULT TRUE, AND THE DEFAULT IS THE WHOLE RISK IN THIS MIGRATION.
 *
 * Every ordinary booking is billable. A column added as `default false` would
 * have silently made every existing row — and every future one — free, which
 * is the single worst thing this file could do. The visit is created with
 * `billable = false` EXPLICITLY, by the one function that creates visits.
 *
 * Rule 6 in reverse: here the default IS the measurement for every row that
 * has one, and the exception is the thing that must be written down.
 */
alter table public.bookings
  add column if not exists billable boolean not null default true;

comment on column public.bookings.billable is
  'False only on a guarantee return visit the customer does not pay for. The band is still real — it is what the professional''s time is worth and what the customer is charged if the verdict says the fault was not ours.';

comment on column public.bookings.guarantee_claim_id is
  'The claim this booking is the return visit for. Null on an ordinary booking. The reverse link is guarantee_claims.visit_booking_id, which is unique — one claim, one visit.';

/*
 * AN ORDINARY BOOKING CAN NEVER BE FREE.
 *
 * Without this, a bug anywhere that wrote `billable = false` on a normal job
 * would hand somebody a free visit and nothing would notice until the
 * settlement did not happen. The two columns are one fact and the database
 * says so.
 */
alter table public.bookings
  drop constraint if exists bookings_free_only_for_guarantee;
alter table public.bookings
  add constraint bookings_free_only_for_guarantee check (
    billable or guarantee_claim_id is not null
  );

create index if not exists bookings_guarantee_claim_idx
  on public.bookings (guarantee_claim_id)
  where guarantee_claim_id is not null;

-- ---------------------------------------------------------------------------
-- Neither column is a browser's to write
-- ---------------------------------------------------------------------------
--
-- `billable` decides whether money changes hands, so it belongs with the
-- prices in `enforce_booking_immutability` rather than beside them. A customer
-- who could flip it would have a free job for the asking; a professional who
-- could flip it could bill for a redo of their own defect.
--
-- Rebuilt from the LIVE definition read out of pg_proc, not from a migration
-- file — `create or replace` takes the text it is given, and restoring an
-- older version is how two guard clauses have been lost before.

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
     or new.platform_fee is distinct from old.platform_fee
     or new.provider_earning is distinct from old.provider_earning
     or new.commission_bps is distinct from old.commission_bps
     or new.commission_basis is distinct from old.commission_basis
     or new.commission_floor_waived is distinct from old.commission_floor_waived
     or new.customer_reported_amount is distinct from old.customer_reported_amount
     or new.amount_mismatch_at is distinct from old.amount_mismatch_at
     or new.payout_due_at is distinct from old.payout_due_at
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

revoke execute on function public.enforce_booking_immutability() from public, anon, authenticated;
