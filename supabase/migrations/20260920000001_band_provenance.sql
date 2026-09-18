-- Where a booking's product came from, so a wrong rule can be found later.
--
-- WHAT PROMPTED THIS. Three of the five sub-band rules shipped in the keyword
-- matcher were wrong — a gas leak filed as a burst pipe, a dripping tap filed
-- as "no water" because the bare "dhara" just means TAP, and every appliance
-- fault filed as a labour-only repair. They were caught and dropped before any
-- real booking existed, so nothing had to be cleaned up.
--
-- THE POINT IS THAT IF THERE HAD BEEN ROWS, THE CLEANUP WAS NOT WRITABLE. A
-- booking stored `band_slug` with no record of which path produced it, so
-- "clear the ones the bad rule touched" is not a query anybody can express:
-- `no-water` from the defective `dhara` match and `no-water` from the model
-- reading a whole sentence are the same three bytes. Provenance beside the
-- value is the rule everywhere else in this schema — `pricing_source`,
-- `duration_source`, `data source` badges — and this is the column that was
-- missing.
--
-- `triage_logs` NEEDS NO band_source COLUMN, and deliberately so. It already
-- records `source` — 'claude', 'cache' or 'fallback' — and a cache hit replays
-- a model answer, so the derivation is exact: fallback means the matcher named
-- it, anything else means the model did. A second column would be a second
-- thing to keep in step, and the two would eventually disagree.
--
-- `bookings` is different: it carries no triage path at all. `triage_log_id`
-- is nullable, and triage text is deleted on a retention schedule, so a join
-- is not a reliable answer months later. Hence a stored column here and a
-- derived one there.

alter table public.bookings
  add column if not exists band_source text
    check (band_source is null or band_source in ('model', 'matcher'));

alter table public.triage_logs
  add column if not exists band text;

-- A HINT FROM THE BROWSER, NOT A CLAIM, and it is worth being exact about
-- what that means. The value travels in the same query string as the band
-- itself, so somebody could set `band_source=model` on their own booking. What
-- that buys them is protection from a cleanup sweep on their own job's
-- duration. It moves no money, it is refused on every subsequent update by
-- `enforce_booking_immutability`, and `rebandBookings` can ignore the column
-- entirely and clear by category, product and date — which is why this is a
-- hint rather than a round trip on the booking path. The authoritative record
-- of what each path produced is `triage_logs`.
comment on column public.bookings.band_source is
  'Which path named this booking''s product: model or matcher. A browser-supplied hint, used to scope a cleanup when a matcher rule is later found wrong — never a security claim. triage_logs is the authoritative record; it derives the same fact from its own `source` column rather than storing it twice.';

comment on column public.triage_logs.band is
  'The sub-band the triage named, or null when it could not tell. Null is an ordinary answer. Read with `source` it gives the two rates separately — how often the model names a product, and how often the keyword matcher does — which is the only way to know whether duration is the normal path or the exception.';

create index if not exists triage_logs_band_idx
  on public.triage_logs (source, band);

-- ---------------------------------------------------------------------------
-- The browser may not write either of them
-- ---------------------------------------------------------------------------
--
-- REBUILT FROM THE LIVE DEFINITION read out of pg_proc, not from the migration
-- file above it. Doing it the other way once dropped every settlement check at
-- a stroke, and doing it from memory two migrations ago would have dropped the
-- provider_serves coverage guard. One column added to the block that already
-- refuses the duration columns.

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
     or new.estimated_working_minutes is distinct from old.estimated_working_minutes
     or new.estimated_elapsed_days is distinct from old.estimated_elapsed_days
     or new.provider_estimated_working_minutes is distinct from old.provider_estimated_working_minutes
     or new.provider_estimated_elapsed_days is distinct from old.provider_estimated_elapsed_days
     or new.actual_working_minutes is distinct from old.actual_working_minutes
     or new.duration_implausible_at is distinct from old.duration_implausible_at then
    raise exception 'How long a job takes is not a browser''s to set'
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
