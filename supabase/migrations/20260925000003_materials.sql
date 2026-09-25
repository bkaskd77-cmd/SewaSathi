-- REMOVES: enforce_claim_refund — two lines, both reshaped rather than
-- dropped, and no guard clause among them.
--
--   `bk.completed_at, bk.category_slug` becomes
--   `bk.materials_rupees, bk.completed_at, bk.category_slug`: the same select
--   list with one more column on it.
--
--   `if new.refund_rupees > b.final_amount then` becomes
--   `if new.refund_rupees > ceiling then`, where `ceiling` is initialised to
--   `b.final_amount` and only ever reduced. With no materials figure, or with
--   `parts_failed` unanswered or true, `ceiling` IS `b.final_amount` and the
--   comparison is character-for-character the old one. The cap it replaces is
--   not weakened in any case: it can only move down.
--
-- Nothing else is dropped — every other guard clause, policy, index and grant
-- that exists today is carried through unchanged, and
-- `enforce_booking_immutability` gains a line without losing one.
--
-- ===========================================================================
-- The parts are not the labour.
--
-- WHAT THIS IS FOR. The guarantee covers workmanship. A tap the professional
-- bought, fitted correctly and left in the wall is the customer's tap, and
-- refunding its cost as though it were labour charges somebody for a part that
-- never failed. Until now the product had no idea what any job's parts cost —
-- no column on `bookings`, `payments` or `provider_ledger`, no capture
-- anywhere — so every refund ceiling was the whole settled figure whether the
-- job was two hours of labour or a compressor with an hour of fitting.
--
-- TWO COLUMNS, IN TWO DIFFERENT HANDS, AND THAT SPLIT IS THE DESIGN.
--
--   `bookings.materials_rupees` is entered by the professional beside the
--   final amount, at settlement — before any claim exists and usually before
--   one ever will.
--
--   `guarantee_claims.parts_failed` is recorded by the ATTENDING professional
--   with the verdict, because they are the one who saw it. A compressor that
--   died and a compressor fitted badly are different claims and only somebody
--   standing in the room can tell them apart. It is deliberately not a box the
--   adjudicator ticks: they were not there.
--
-- BOTH ARE NULLABLE AND NULL MEANS NOBODY SAID — rule 6. A booking taken
-- before this migration has no materials figure, and that is not the same fact
-- as a job with no parts. A claim from before the question existed has no
-- answer about the parts, and that is not the same fact as "the parts were
-- fine". The deduction below therefore requires a POSITIVE `false`: an
-- unanswered question must not quietly cost a customer the price of the parts.
-- ===========================================================================

alter table public.bookings
  add column if not exists materials_rupees integer;

comment on column public.bookings.materials_rupees is
  'What the professional said the parts cost, entered beside the final amount. Null is "nobody said", never zero: a job with no parts records 0. Comes off a guarantee refund ceiling only when the attending professional records that the parts themselves did not fail.';

-- Bounded against the figure it is part of. Materials cannot be negative and
-- cannot exceed what was actually charged — a parts line larger than the bill
-- is an entry error, and it would drive the ceiling below zero.
alter table public.bookings
  drop constraint if exists bookings_materials_within_amount;
alter table public.bookings
  add constraint bookings_materials_within_amount check (
    materials_rupees is null
    or (
      materials_rupees >= 0
      and final_amount is not null
      and materials_rupees <= final_amount
    )
  );

alter table public.guarantee_claims
  add column if not exists parts_failed boolean;

comment on column public.guarantee_claims.parts_failed is
  'Did the parts themselves fail, rather than the workmanship? Recorded by the attending professional with the verdict. Null is "not asked or not answered" and is NOT the same as false: only an explicit false lets the parts cost come off the refund ceiling.';

-- ---------------------------------------------------------------------------
-- `materials_rupees` joins the settlement block in the immutability trigger.
--
-- RLS IS ROW-LEVEL, so "customers cancel their own open bookings" lets a
-- browser write every column on the row. A materials figure a customer could
-- set is a refund ceiling a customer could raise — type 0 and the deduction
-- disappears — and one a professional could set from a browser is a ceiling
-- they could lower to half. It belongs with the prices, written by the server
-- and by nobody else.
--
-- REBUILT FROM THE LIVE `pg_proc` TEXT, not from a migration file. A
-- `create or replace` takes the text it is given, and restoring an older copy
-- is how guard clauses have been silently lost before. The body below is the
-- live one plus one `or new.materials_rupees is distinct from
-- old.materials_rupees` line; nothing else moved.
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
-- The ceiling loses the parts, when somebody has said the parts were sound.
--
-- ONE RULE, TWO IMPLEMENTATIONS, AND THE LAST TIME THAT HAPPENED THEY
-- DIVERGED. `refundCeiling` in lib/payments/refund.ts computes exactly the
-- arithmetic below — same order, same cap, same integer truncation — and
-- `tests/db/guarantee-claims.test.ts` asserts the two agree on one fixture.
-- That comparison is the point: the previous divergence was green in both
-- halves for weeks because nothing ever put them side by side.
--
-- THE SHARE CAP IS THE ANTI-INFLATION GATE AND IT IS NEEDED NOW, not when the
-- commission question is decided. Nothing evidences `materials_rupees` — there
-- are no receipts in this product — and from today it reduces what a
-- professional can be asked to pay back. Uncapped, materials of 5,999 on a
-- 6,000 job turns a full refund into one rupee and every other guard here
-- waves it through, because each of them is about the total. Half bounds the
-- manipulation at halving the exposure rather than erasing it, and leaves the
-- genuinely material-heavy trades under the cap in the ordinary case.
--
-- `(b.final_amount * 5000) / 10000` is integer division and truncates. The
-- TypeScript half uses `Math.floor` for the same reason: two halves rounding
-- differently disagree by a rupee on every odd amount, which is exactly how a
-- ceiling drifts without anybody noticing.
--
-- NULL IS NOT A NO, AND THE REASON IS NOT THE SPELLING. A claim from before
-- this question existed — and one where the professional skipped it — keeps
-- the whole settled figure, because PL/pgSQL takes an IF whose condition is
-- NULL as false, and `parts_failed` null makes the whole condition null. That
-- is what is load-bearing; `is false` and `= false` branch identically inside
-- an IF, and a test written to tell them apart here passes under both.
--
-- `is false` is still the spelling, for two reasons that are not this one: it
-- says what is meant to somebody reading it, and it keeps behaving this way if
-- the condition is ever lifted into a WHERE clause or a compound boolean,
-- where a NULL from `= false` would propagate instead of collapsing. The
-- guarantee that an unanswered question costs the customer nothing is asserted
-- as BEHAVIOUR in tests/db/guarantee-claims.test.ts, not as a text match.
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
  ceiling integer;
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
         bk.materials_rupees, bk.completed_at, bk.category_slug
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
  ceiling := b.final_amount;

  /*
   * LESS THE PARTS, WHEN THE PARTS WERE SOUND. The guarantee is on the
   * workmanship; a tap that was bought, fitted correctly and is still in the
   * wall is the customer's tap. A null `parts_failed` — nobody asked, or
   * nobody answered — deducts nothing, because PL/pgSQL treats an IF with a
   * NULL condition as false. See the header: that, and not the `is false`
   * spelling, is what makes the unanswered case safe.
   *
   * The deduction itself is capped at half the settled figure. See the header:
   * the line is unevidenced and now reduces what a professional can be asked
   * to pay back, which makes it worth inflating.
   */
  if b.materials_rupees is not null and new.parts_failed is false then
    ceiling := b.final_amount
             - least(b.materials_rupees, (b.final_amount * 5000) / 10000);
  end if;

  if new.refund_rupees > ceiling then
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

-- Same posture as every other trigger function here: the caller never needs
-- `execute`, Postgres checks it when the trigger is created rather than when
-- it fires, and `tests/db/booking-rls.test.ts` asserts both halves.
revoke execute on function public.enforce_booking_immutability() from public, anon, authenticated;
revoke execute on function public.enforce_claim_refund() from public, anon, authenticated;
