-- APPLIED VIA: the atomic path — one `DO $$ … END $$;` block through `apply_migration`,
--   one statement to the transport and one implicit transaction. No deviation: no
--   statement here has `DROP` as its first keyword.
--
--   THE FUNCTION BODY IS DOLLAR-QUOTED WITH `$fn$` RATHER THAN `$$`, because the whole
--   migration goes through the transport inside a `DO $mig$ … $mig$` block and a nested
--   `$$` would close the wrong one. The file carries the same spelling so the text the
--   db suite runs is the text that was applied.
--
-- ADDS: one guard clause to public.enforce_claim_refund.
-- REMOVES: nothing. The body below is the LAST definition — `20260925000003_materials.sql`,
--   not the original in `20260921000008_refund_guards.sql` — with one `select count(*)`
--   and one `if` added and one variable declared. Every other guard clause is
--   character-for-character what was there. `create or replace` takes the text it is
--   given, and rebuilding from an older copy is how guard clauses have been silently lost
--   three times in this schema; `npm run check:migrations` compares the line counts.

-- ===========================================================================
-- A doubtful photograph cannot be what a refund rests on.
--
-- WHAT THIS CLOSES. `20261008000002` stores three measured doubts about a claim
-- photograph and shows them to the adjudicator. Showing is not gating: the screen that
-- offers the button already reads only `resolved` claims with a `sameFault` verdict, but
-- `issueRefund` is a server action and a public POST and checked neither the status nor
-- the verdict, and neither did this trigger. So the queue was stricter than the rule for
-- the whole life of the feature, and nothing but the queue's own `where` clause stood
-- between a claim id and a refund decided on paperwork.
--
-- THE REMEDY IS THE ONE THE GUARANTEE ALREADY PROMISES. Somebody attends, and what they
-- find decides who pays. `lib/photos/evidence.ts`'s `inspectionRequired` is the same rule
-- in TypeScript so the caller gets a sentence rather than an exception, and
-- `tests/db/claim-evidence.test.ts` runs one fixture through both.
--
-- IT READS THE CLAIM'S OWN PHOTOGRAPHS AND NOT A CACHED VERDICT, so a doubt recorded
-- after a refund was proposed still stops it, and a photograph removed from the claim
-- stops counting against it. There is no column to go stale.
-- ===========================================================================

create or replace function public.enforce_claim_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  b record;
  window_days integer;
  ceiling integer;
  doubted integer;
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
   * AND NOTHING ON A DOUBTFUL PHOTOGRAPH UNTIL SOMEBODY HAS BEEN TO LOOK.
   *
   * THE LIST IS `doubtsOnRow` IN SQL and the two are compared on one fixture by
   * `tests/db/claim-evidence.test.ts`, because a money rule implemented twice is the
   * fault `refundCeiling` was last rebuilt for. Stale, a near-duplicate of a photograph
   * we hold, and the booking's own photograph: three measured doubts, and nothing else.
   * `not-compared` and `no-reference` are deliberately absent — a comparison we could
   * not make is our failure, and gating on it would cost the customer a visit for our
   * read.
   *
   * CONDITIONAL ON THE DOUBT, WHICH IS WHAT KEEPS THIS NARROW. A claim with no
   * photograph, or with sound ones, is judged exactly as it was before this existed.
   * `/admin/guarantee-claims` has always been stricter — its queue reads only resolved
   * same-fault claims — but `issueRefund` is a server action and a public POST and
   * checked neither, so the queue was stricter than the rule for the whole life of the
   * feature. The unconditional version is deliberately NOT taken here: it would
   * foreclose a case the product may need later, where nobody will attend and support
   * decides to pay back anyway.
   */
  select count(*) into doubted
    from public.guarantee_claim_photos p
   where p.claim_id = new.id
     and (
       p.freshness_verdict = 'stale'
       or p.duplicate_verdict = 'flag'
       or p.booking_photo_match = 'same-picture'
     );

  if doubted > 0
     and (new.status is distinct from 'resolved'
          or new.verdict is distinct from 'sameFault') then
    raise exception 'That claim needs the visit before money goes back: a photograph on it raised a doubt'
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
$fn$;

-- Same posture as every other trigger function here: the caller never needs `execute`,
-- Postgres checks it when the trigger is created rather than when it fires, and
-- `tests/db/booking-rls.test.ts` asserts both halves.
revoke execute on function public.enforce_claim_refund() from public, anon, authenticated;
