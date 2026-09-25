-- REMOVES: enforce_claim_refund — the `least(final_amount,
--   coalesce(customer_reported_amount, final_amount))` refund cap and its
--   comment. The cap is now `final_amount` alone, because the guarantee
--   ceiling follows the SETTLED figure and that is one number. The old clause
--   read the cash screen's "up to the amount you enter" as a ceiling; it is a
--   floor, and the confirmation screen says so in both languages. The one case
--   where `least` still narrowed was a RESOLVED mismatch, where it would have
--   re-imposed the customer's own mistyped figure as their cover after a
--   person had established what was really paid. The `select ... into b` also
--   gains `amount_mismatch_resolved_at`, which is what the dispute block now
--   reads — the lines it replaces are counted as removals too.

-- ---------------------------------------------------------------------------
-- A mismatch a person can actually settle.
--
-- WHAT WAS BROKEN. For cash the customer types what they handed over without
-- being shown the professional's figure. When the two disagree,
-- `flagAmountMismatch` stamps `amount_mismatch_at`, keeps both numbers and
-- tells both sides — and then nothing. `confirmCashPayment` refuses for ever
-- once that stamp is set, and NO code path anywhere clears it. So the booking
-- never settles, the professional is never paid, `enforce_claim_refund` blocks
-- any guarantee claim on it, and the customer reads "we are looking at it"
-- while nobody in the product can look. The promise was already on the screen;
-- this is the half that makes it true.
--
-- WHAT A RESOLUTION RECORDS. Four things, on the booking rather than only in
-- the audit log, because a figure somebody has to defend later should live
-- beside the money it decided:
--
--   `amount_settled_source`  which number won — the customer's, the
--                            professional's, or one a person arrived at
--   `amount_mismatch_note`   why, mandatory when the figure is neither party's
--   `..._resolved_at/_by`    when, and who
--
-- A DEFAULT IS NEVER A MEASUREMENT (standing rule 6). All four are nullable
-- with no default. `amount_settled_source` stays null until somebody decides,
-- and the agreeing path in `confirmCashPayment` writes 'customer' explicitly
-- rather than letting a default speak for a customer who did confirm — so the
-- column only ever holds something somebody actually stated, and "nobody has
-- decided" is distinguishable from "decided in the customer's favour".
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists amount_mismatch_resolved_at timestamptz,
  add column if not exists amount_mismatch_resolved_by uuid references public.profiles(id),
  add column if not exists amount_mismatch_note text,
  add column if not exists amount_settled_source text
    check (amount_settled_source in ('customer', 'provider', 'adjudicated'));

comment on column public.bookings.amount_settled_source is
  'Which figure the settlement used: customer (they agreed, or a person chose their number), provider, or adjudicated (a third figure a person arrived at). Null until somebody decides — never defaulted.';
comment on column public.bookings.amount_mismatch_note is
  'Why an adjudicated figure is what it is. Mandatory when the settled amount is neither party''s, and kept on the booking so the reason sits beside the money rather than only in the audit log.';
comment on column public.bookings.amount_mismatch_resolved_at is
  'When a person settled the disagreement. Null while it is still open — that pair with amount_mismatch_at is what the admin queue reads.';

-- The open set, which is what the queue reads and what the index is for. There
-- was no index on `amount_mismatch_at` at all, so the queue would have seq
-- scanned `bookings` — and a mismatch is rare by construction, which is
-- exactly the shape a partial index is for. Mirrors commission_appeals_open_idx.
create index if not exists bookings_open_mismatch_idx
  on public.bookings (amount_mismatch_at)
  where amount_mismatch_at is not null and amount_mismatch_resolved_at is null;

-- ---------------------------------------------------------------------------
-- The four new columns join the settlement block in the immutability trigger.
--
-- REBUILT FROM THE LIVE `pg_proc` TEXT, not from a migration file. A
-- `create or replace` takes the text it is given, and restoring an older copy
-- is how two guard clauses have been silently lost before. The body below is
-- the live one plus four `or new.… is distinct from old.…` lines; nothing else
-- moved.
--
-- `caller is null` returns early, which is how the service role writes these at
-- all — the resolution runs under it. A browser can no more set who resolved a
-- mismatch than it can set the amount.
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

-- ---------------------------------------------------------------------------
-- The guarantee ceiling follows the settled figure. One number, not two.
--
-- WHAT CHANGED AND WHY IT IS NOT A JUDGEMENT CALL. The cap was
-- `least(final_amount, coalesce(customer_reported_amount, final_amount))`, and
-- its own comment said the cash screen's "up to the amount you enter" is "a
-- ceiling rather than a floor". That reading is now reversed: the typed amount
-- is a FLOOR, and the confirmation screen says so in both languages.
--
-- The `least` was also all but dead. The unresolved-mismatch block above
-- raises BEFORE this one, so by the time the cap runs the two figures either
-- agreed or the customer never typed one — and `least` returns `final_amount`
-- in both cases. The single case where it would have narrowed is a RESOLVED
-- mismatch, where `customer_reported_amount` still holds the customer's
-- original lower figure while `final_amount` holds the one a person settled
-- on. That is precisely the case the new rule forbids: it would quietly
-- re-impose the customer's own mistyped number as their cover, after somebody
-- had established what was really paid.
--
-- `customer_reported_amount` stays on the row. It is evidence, and a
-- professional whose figures are confirmed by hundreds of customers has a
-- record worth something when one of them is not. It is simply no longer a
-- ceiling.
--
-- Rebuilt from the live `pg_proc` text; only the cap clause and its comment
-- differ.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_claim_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  window_days integer;
begin
  -- Nothing to check until money is actually being paid back.
  if coalesce(new.refund_rupees, 0) = 0 then
    return new;
  end if;

  /*
   * A REFUND NOBODY SIGNED IS NOT THIS FUNCTION'S REFUSAL.
   *
   * `enforce_claim_transition` owns "money back needs a person" and it is the
   * more fundamental rule — the anti-farming design in one line. This trigger
   * sorts alphabetically BEFORE that one, so without this early return its
   * message would preempt it and somebody would be told the booking was
   * unsettled when the real fault was that no human had decided anything.
   *
   * Returning early is safe rather than a hole: the row is still refused, by
   * the trigger whose sentence actually describes what is wrong.
   */
  if new.refund_decided_by is null then
    return new;
  end if;

  /*
   * NO DOUBLE PAYOUT. Once a figure is on the claim it is the figure. A
   * second one is a support conversation, not a button, and an EDIT of the
   * first is the same event wearing different clothes.
   */
  if tg_op = 'UPDATE'
     and coalesce(old.refund_rupees, 0) > 0
     and new.refund_rupees is distinct from old.refund_rupees then
    raise exception 'This claim has already been refunded'
      using errcode = 'check_violation';
  end if;

  select bk.payment_status, bk.final_amount, bk.customer_reported_amount,
         bk.amount_mismatch_at, bk.amount_mismatch_resolved_at,
         bk.completed_at, bk.category_slug
    into b
    from public.bookings bk
   where bk.id = new.booking_id;

  if not found then
    raise exception 'A refund needs the booking it is refunding'
      using errcode = 'check_violation';
  end if;

  -- NOTHING ON AN UNSETTLED BOOKING. There is no money to give back.
  if b.payment_status is distinct from 'paid' or b.final_amount is null then
    raise exception 'That job has not been settled, so there is nothing to refund'
      using errcode = 'check_violation';
  end if;

  /*
   * AND NOTHING WHILE THE TWO FIGURES STILL DISAGREE. An OPEN
   * `amount_mismatch_at` means a person is deciding which number is true;
   * refunding against either would pick a side by accident, and pick it in
   * whichever direction happened to be written down.
   *
   * `resolved_at` is half of this condition and not decoration. Without it a
   * dispute somebody settled would go on blocking every claim on that booking
   * for ever — the same permanence the resolution exists to end, moved one
   * table along. A db test caught exactly that while this migration was being
   * written.
   */
  if b.amount_mismatch_at is not null
     and b.amount_mismatch_resolved_at is null then
    raise exception 'The amount for that job is still in dispute'
      using errcode = 'check_violation';
  end if;

  /*
   * NOTHING ABOVE THE SETTLED FIGURE, AND THAT IS ONE NUMBER.
   *
   * `final_amount` is what the job settled at — the figure both sides agreed,
   * or the one a person established when they did not. The customer's typed
   * amount is a floor on their cover, never a cap on it: somebody who really
   * paid 2,000 and mistyped 1,500 is covered for what was actually paid once
   * that has been established, not for their own slip.
   */
  if new.refund_rupees > b.final_amount then
    raise exception 'A refund cannot be more than the amount recorded for the job'
      using errcode = 'check_violation';
  end if;

  /*
   * NOTHING OUTSIDE THE WINDOW. `claimIsAllowed` checked this when the claim
   * was filed, but a refund is decided later — sometimes much later — and a
   * claim that sat open past its window must not become payable by waiting.
   * The windows mirror GUARANTEE_WINDOWS in lib/config/guarantee.ts; the
   * default is the ordinary repair window, so a trade added later is covered
   * rather than unguarded.
   */
  window_days := case b.category_slug
    when 'painting' then 90
    when 'home-cleaning' then 2
    when 'movers-packers' then 2
    else 30
  end;

  if b.completed_at is null
     or b.completed_at + (window_days || ' days')::interval < now() then
    raise exception 'That job''s guarantee window has closed'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
