-- Did the question actually get asked, and did anybody answer it?
--
-- WHAT CANNOT BE ANSWERED TODAY. The triage card asks which product a job is
-- when it could not tell, and a customer may answer or say "I'm not sure".
-- Both of those, and never having been asked at all, leave `band_slug` and
-- `band_source` null. Three different things, one shape, and the corpus cannot
-- tell them apart either — it measures the RULES on twelve written phrasings,
-- which is a different question from what real customers do.
--
-- So: one dated column. `band_asked_at` is set when the card renders the
-- question, not when somebody answers it, because the interesting denominator
-- is how often we ask.
--
--   never asked   band_asked_at is null
--   answered      band_asked_at is not null and band_source = 'customer'
--   not sure      band_asked_at is not null and band_slug is null
--
-- RULE 6 APPLIES TO THE BACKFILL AND IT IS THE WHOLE REASON FOR THE CUTOFF.
-- Every booking that existed before this column would read as "never asked"
-- when the truth is UNMEASURED — the ask may well have happened, we simply were
-- not recording it. A default presented as a measurement is the mistake that
-- has cost this schema four times (`rating_avg 0`, `avg_response_minutes 120`,
-- `availability`, `completion_rate 100`), so the view refuses to count those
-- rows rather than averaging them in.

alter table public.bookings
  add column if not exists band_asked_at timestamptz;

comment on column public.bookings.band_asked_at is
  'When the triage card put its one product question to this customer — set on asking, not on answering, because how often we ask is the denominator. Null means never asked OR, on a booking older than 2026-09-22, never recorded. band_ask_signals refuses the second rather than counting it as the first.';

-- The browser may not write it either. It is a measurement about our own
-- screen, and a customer able to set it could quietly rewrite the denominator
-- of the only number that says whether the ask is worth its tap.
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

-- ---------------------------------------------------------------------------
-- What the ask is actually worth, on real bookings
-- ---------------------------------------------------------------------------
--
-- The corpus measures the RULES: twelve written phrasings through the keyword
-- matcher, 2/12 banded today and 12/12 if the customer answers. That is a
-- ceiling, and it assumes an answer. This measures the PRODUCT — how often the
-- question is put, and how often anybody bothers.
--
-- BY CATEGORY AND MONTH, NEVER BY PROFESSIONAL. The customer answers this
-- question, not them; a per-person cut would be a fact about whoever happens to
-- serve the wards where people tap "I'm not sure", which is the same reason
-- `payment_mix_signals` and `category_pricing_signals` are shaped this way.
--
-- THE CUTOFF IS RULE 6 AND IT IS NOT DECORATION. A booking made before
-- `band_asked_at` existed has `band_asked_at is null`, which reads exactly like
-- "we asked nobody" and is in fact "we were not recording". Averaging those in
-- would understate the ask rate for ever, and the mistake would be invisible
-- because the number would look plausible.

create or replace view public.band_ask_signals as
  select
    b.category_slug,
    date_trunc('month', b.created_at)::date as month,
    count(*) as bookings,
    count(*) filter (where b.band_asked_at is not null) as asked,
    count(*) filter (
      where b.band_asked_at is not null and b.band_source = 'customer'
    ) as answered,
    count(*) filter (
      where b.band_asked_at is not null and b.band_slug is null
    ) as not_sure,
    -- Banded by ANY path, which is the number the 10-13x category bands were
    -- always the argument about.
    count(*) filter (where b.band_slug is not null) as banded,
    round(
      100.0 * count(*) filter (where b.band_slug is not null)
        / nullif(count(*), 0)
    , 1) as banded_pct,
    -- Of the times we asked, how often somebody answered. The ask is worth its
    -- tap only if this is high; a low number means the question is wrong, not
    -- that customers are unhelpful.
    round(
      100.0 * count(*) filter (
        where b.band_asked_at is not null and b.band_source = 'customer'
      ) / nullif(count(*) filter (where b.band_asked_at is not null), 0)
    , 1) as answer_rate_pct
  from public.bookings b
  -- THE DATE THIS COLUMN WAS APPLIED, which is not the date in the filename:
  -- the migration names in this tree run ahead of the calendar. Getting that
  -- wrong is not a cosmetic slip — a cutoff in the future excludes every row
  -- and the view returns nothing, which is what the first version of this did.
  where b.created_at >= date '2026-09-18'
  group by b.category_slug, date_trunc('month', b.created_at);

comment on view public.band_ask_signals is
  'How often the triage card asks which product a job is, and how often a customer answers — by category and month, never by professional, because the customer answers this question. Bookings before 2026-09-18 are excluded rather than counted as never-asked: the column did not exist, so those rows are unmeasured, not measured-as-zero.';

-- Support's number, and meaningless unless it is everybody's: a view runs with
-- the caller's own policies, so a customer reading it would see their own two
-- rows and get an average of nothing.
revoke all on public.band_ask_signals from public, anon, authenticated;
